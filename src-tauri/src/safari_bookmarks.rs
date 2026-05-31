use std::collections::HashMap;
use std::path::PathBuf;

use crate::database::Database;

/// A parsed Safari bookmark or folder
#[derive(Debug)]
struct SafariNode {
    title: String,
    url: Option<String>,
    children: Vec<SafariNode>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportResult {
    pub groups_imported: usize,
    pub bookmarks_imported: usize,
    pub skipped: usize,
}

/// Sync Safari Bookmarks.plist into the MacNest database.
/// All existing bookmarks and bookmark groups are deleted first,
/// then everything is imported fresh from Safari.
pub fn import_safari_bookmarks(db: &Database) -> Result<ImportResult, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let plist_path = PathBuf::from(&home).join("Library/Safari/Bookmarks.plist");

    if !plist_path.exists() {
        return Err("Safari 书签文件未找到".to_string());
    }

    // Log plist file modification time for debugging
    let metadata = std::fs::metadata(&plist_path)
        .map_err(|e| format!("无法读取书签文件元数据: {}", e))?;
    let modified = metadata.modified()
        .map_err(|e| format!("无法获取修改时间: {}", e))?;
    let elapsed = modified.elapsed().unwrap_or_default();
    eprintln!(
        "[macnest] Safari Bookmarks.plist modified {} seconds ago",
        elapsed.as_secs()
    );

    let value = match plist::Value::from_file(&plist_path) {
        Ok(v) => v,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("Permission") || msg.contains("permission") {
                return Err(
                    "无法读取 Safari 书签：请前往 系统设置 → 隐私与安全性 → 完全磁盘访问权限，将 MacNest 添加进去后重试。".to_string()
                );
            }
            return Err(format!("解析 plist 失败: {}", e));
        }
    };

    let root = parse_safari_plist(&value)?;

    // Count Safari bookmarks before clearing
    fn count_bookmarks(node: &SafariNode) -> usize {
        if !node.children.is_empty() {
            node.children.iter().map(count_bookmarks).sum()
        } else if node.url.is_some() {
            1
        } else {
            0
        }
    }
    let safari_bookmark_count: usize = root.children.iter().map(count_bookmarks).sum();
    eprintln!("[macnest] Safari plist contains {} bookmarks", safari_bookmark_count);

    // Get a single connection and run everything in a transaction
    let mut conn = db.conn().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // === Clear existing data ===
    tx.execute("DELETE FROM bookmarks", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM groups WHERE group_type = 'bookmark'", [])
        .map_err(|e| e.to_string())?;

    // Collect all nodes into flat lists: folders (groups) and bookmarks
    let mut folders: Vec<(Vec<usize>, String)> = Vec::new(); // (path indices, name)
    let mut bookmarks: Vec<(Vec<usize>, String, String)> = Vec::new(); // (path indices, name, url)

    fn collect(
        node: &SafariNode,
        path: &mut Vec<usize>,
        folders: &mut Vec<(Vec<usize>, String)>,
        bookmarks: &mut Vec<(Vec<usize>, String, String)>,
    ) {
        if !node.children.is_empty() {
            // This is a folder
            let folder_path = path.clone();
            folders.push((folder_path, node.title.clone()));
            for (i, child) in node.children.iter().enumerate() {
                path.push(i);
                collect(child, path, folders, bookmarks);
                path.pop();
            }
        } else if let Some(ref url) = node.url {
            // This is a bookmark leaf
            bookmarks.push((path.clone(), node.title.clone(), url.clone()));
        }
    }

    let mut path = Vec::new();
    for (i, child) in root.children.iter().enumerate() {
        path.push(i);
        collect(child, &mut path, &mut folders, &mut bookmarks);
        path.pop();
    }

    // Map folder path -> new group_id
    let mut group_id_map: HashMap<Vec<usize>, i64> = HashMap::new();
    let mut groups_imported = 0usize;
    let mut bookmarks_imported = 0usize;
    let mut skipped = 0usize;

    // Import folders (groups) - order by path depth so parents are created first
    let mut sorted_folders = folders;
    sorted_folders.sort_by_key(|(path, _)| path.len());

    for (folder_path, name) in sorted_folders {
        let parent_id = if folder_path.is_empty() {
            None
        } else {
            let parent_path = &folder_path[..folder_path.len() - 1];
            group_id_map.get(parent_path).copied()
        };

        tx.execute(
            "INSERT INTO groups (name, parent_id, sort_order, group_type) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![name, parent_id, groups_imported as i64, "bookmark"],
        ).map_err(|e| e.to_string())?;
        let group_id = tx.last_insert_rowid();
        group_id_map.insert(folder_path, group_id);
        groups_imported += 1;
    }

    // Import bookmarks
    for (bookmark_path, name, url) in bookmarks {
        let group_id = if bookmark_path.is_empty() {
            None
        } else {
            let folder_path = &bookmark_path[..bookmark_path.len() - 1];
            group_id_map.get(folder_path).copied()
        };

        let result = tx.execute(
            "INSERT INTO bookmarks (name, url, group_id, icon) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![name, url, group_id, "link"],
        );
        match result {
            Ok(_) => bookmarks_imported += 1,
            Err(_) => skipped += 1,
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ImportResult {
        groups_imported,
        bookmarks_imported,
        skipped,
    })
}

/// Parse a Safari Bookmarks.plist `Value` into a tree of `SafariNode`s.
fn parse_safari_plist(value: &plist::Value) -> Result<SafariNode, String> {
    let dict = value
        .as_dictionary()
        .ok_or("根节点不是字典")?;

    let children = dict
        .get("Children")
        .and_then(|v| v.as_array())
        .ok_or("找不到 Children 数组")?;

    let mut nodes: Vec<SafariNode> = Vec::new();
    for child in children.iter() {
        if let Some(node) = parse_safari_node(child) {
            // Skip Safari's container folders and flatten their children
            if node.title == "BookmarksBar" || node.title == "BookmarksMenu" {
                nodes.extend(node.children);
            } else {
                nodes.push(node);
            }
        }
    }

    Ok(SafariNode {
        title: "Safari Bookmarks".to_string(),
        url: None,
        children: nodes,
    })
}

/// Recursively parse a single Safari plist node.
fn parse_safari_node(value: &plist::Value) -> Option<SafariNode> {
    let dict = value.as_dictionary()?;
    let bookmark_type = dict
        .get("WebBookmarkType")
        .and_then(|v| v.as_string())?;

    match bookmark_type {
        "WebBookmarkTypeList" => {
            let title = dict
                .get("Title")
                .and_then(|v| v.as_string())
                .unwrap_or("未命名文件夹")
                .to_string();

            let children = dict
                .get("Children")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(parse_safari_node)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            Some(SafariNode {
                title,
                url: None,
                children,
            })
        }
        "WebBookmarkTypeLeaf" => {
            let url = dict
                .get("URLString")
                .and_then(|v| v.as_string())
                .map(|s| s.to_string())?;

            let title = dict
                .get("URIDictionary")
                .and_then(|v| v.as_dictionary())
                .and_then(|d| d.get("title"))
                .and_then(|v| v.as_string())
                .unwrap_or("未命名书签")
                .to_string();

            Some(SafariNode {
                title,
                url: Some(url),
                children: Vec::new(),
            })
        }
        _ => None,
    }
}

/// Generate a unique group name by appending `(1)`, `(2)` etc.
fn make_unique_group_name(
    db: &Database,
    name: &str,
    parent_id: Option<i64>,
) -> Result<String, String> {
    let existing = db.list_groups("bookmark").map_err(|e| e.to_string())?;

    if !existing.iter().any(|g| {
        g.name == name && g.parent_id == parent_id
    }) {
        return Ok(name.to_string());
    }

    for i in 1.. {
        let candidate = format!("{} ({})", name, i);
        if !existing.iter().any(|g| {
            g.name == candidate && g.parent_id == parent_id
        }) {
            return Ok(candidate);
        }
    }

    unreachable!()
}

/// Generate a unique bookmark name by appending `(1)`, `(2)` etc.
fn make_unique_bookmark_name(
    db: &Database,
    name: &str,
    group_id: Option<i64>,
) -> Result<String, String> {
    let existing = db.list_bookmarks(group_id).map_err(|e| e.to_string())?;

    if !existing.iter().any(|b| b.name == name) {
        return Ok(name.to_string());
    }

    for i in 1.. {
        let candidate = format!("{} ({})", name, i);
        if !existing.iter().any(|b| b.name == candidate) {
            return Ok(candidate);
        }
    }

    unreachable!()
}
