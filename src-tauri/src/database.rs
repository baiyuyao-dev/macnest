use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Service {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub command: String,
    pub cwd: String,
    pub env_vars: String,
    pub auto_start: bool,
    pub restart_policy: String,
    pub max_restarts: i64,
    pub port_auto_detect: bool,
    pub status: String,
    pub pid: Option<i64>,
    pub ports: String,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub description: String,
    pub group_id: Option<i64>,
    pub icon: String,
    pub service_id: Option<i64>,
    pub health_check_url: String,
    pub is_online: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub id: i64,
    pub theme: String,
    pub auto_refresh_interval: i64,
    pub show_menu_bar: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceLog {
    pub id: i64,
    pub service_id: i64,
    pub content: String,
    pub level: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        Ok(Database { conn: Mutex::new(conn) })
    }

    pub fn init(&self) -> Result<()> {
        self.conn.lock().unwrap().execute_batch(
            "CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                command TEXT NOT NULL,
                cwd TEXT DEFAULT '',
                env_vars TEXT DEFAULT '{}',
                auto_start BOOLEAN DEFAULT 0,
                restart_policy TEXT DEFAULT 'on-failure',
                max_restarts INTEGER DEFAULT 5,
                port_auto_detect BOOLEAN DEFAULT 1,
                status TEXT DEFAULT 'stopped',
                pid INTEGER,
                ports TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                description TEXT DEFAULT '',
                category TEXT DEFAULT 'default',
                icon TEXT DEFAULT 'link',
                service_id INTEGER,
                health_check_url TEXT DEFAULT '',
                is_online BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS service_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                level TEXT DEFAULT 'info',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                theme TEXT DEFAULT 'dark',
                auto_refresh_interval INTEGER DEFAULT 5,
                show_menu_bar BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            INSERT OR IGNORE INTO settings (id) VALUES (1);

            CREATE INDEX IF NOT EXISTS idx_service_logs_service_id ON service_logs(service_id);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category);

            UPDATE settings SET theme = 'dark' WHERE id = 1 AND theme IS NULL;

            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parent_id INTEGER,
                sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(name, parent_id)
            );

            CREATE TABLE IF NOT EXISTS docker_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                container_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                image TEXT NOT NULL,
                compose_project TEXT DEFAULT '',
                status TEXT DEFAULT '',
                state TEXT DEFAULT '',
                ports TEXT DEFAULT '',
                cpu_percent TEXT DEFAULT '',
                memory_usage TEXT DEFAULT '',
                created TEXT DEFAULT '',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS resource_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                cpu_percent REAL DEFAULT 0,
                memory_percent REAL DEFAULT 0,
                memory_used_mb REAL DEFAULT 0,
                memory_total_mb REAL DEFAULT 0,
                disk_percent REAL DEFAULT 0,
                network_rx_mb REAL DEFAULT 0,
            network_tx_mb REAL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_resource_snapshots_timestamp ON resource_snapshots(timestamp);
            "
        )?;

        // Add columns if they don't exist (ignore errors for duplicate columns)
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("ALTER TABLE services ADD COLUMN cpu_percent REAL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE services ADD COLUMN memory_mb REAL DEFAULT 0", []);

        // Migration: add group_id to bookmarks
        let _ = conn.execute("ALTER TABLE bookmarks ADD COLUMN group_id INTEGER", []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_bookmarks_group_id ON bookmarks(group_id)", []);

        // Migration: migrate categories to groups
        let mut stmt = match conn.prepare("SELECT DISTINCT category FROM bookmarks WHERE category IS NOT NULL AND category != '' AND category != 'default'") {
            Ok(s) => s,
            Err(_) => {
                return Ok(());
            }
        };
        let categories = match stmt.query_map([], |row| {
            let cat: String = row.get(0)?;
            Ok(cat)
        }) {
            Ok(iter) => iter.collect::<Result<Vec<_>>>().unwrap_or_default(),
            Err(_) => vec![],
        };
        drop(stmt);

        for category in categories {
            // Check if group already exists
            let exists: Result<i64> = conn.query_row(
                "SELECT id FROM groups WHERE name = ?1",
                params![&category],
                |row| row.get(0),
            );
            let group_id = match exists {
                Ok(id) => id,
                Err(_) => {
                    let _ = conn.execute(
                        "INSERT INTO groups (name, sort_order) VALUES (?1, 0)",
                        params![&category],
                    );
                    conn.last_insert_rowid()
                }
            };
            // Update bookmarks with this category to point to the group
            let _ = conn.execute(
                "UPDATE bookmarks SET group_id = ?1 WHERE category = ?2 AND (group_id IS NULL OR group_id = 0)",
                params![group_id, &category],
            );
        }

        Ok(())
    }

    // === Service CRUD ===

    pub fn create_service(
        &self,
        name: &str,
        description: &str,
        command: &str,
        cwd: &str,
        env_vars: &str,
        auto_start: bool,
        restart_policy: &str,
        max_restarts: i64,
        port_auto_detect: bool,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO services (name, description, command, cwd, env_vars, auto_start, restart_policy, max_restarts, port_auto_detect)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                name,
                description,
                command,
                cwd,
                env_vars,
                auto_start,
                restart_policy,
                max_restarts,
                port_auto_detect
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_services(&self) -> Result<Vec<Service>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, command, cwd, env_vars, auto_start, restart_policy, max_restarts, port_auto_detect, status, pid, ports, cpu_percent, memory_mb, created_at, updated_at FROM services ORDER BY created_at DESC"
        )?;
        let services = stmt
            .query_map([], |row| {
                Ok(Service {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    command: row.get(3)?,
                    cwd: row.get(4)?,
                    env_vars: row.get(5)?,
                    auto_start: row.get(6)?,
                    restart_policy: row.get(7)?,
                    max_restarts: row.get(8)?,
                    port_auto_detect: row.get(9)?,
                    status: row.get(10)?,
                    pid: row.get(11)?,
                    ports: row.get(12)?,
                    cpu_percent: row.get(13)?,
                    memory_mb: row.get(14)?,
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(services)
    }

    pub fn get_service(&self, id: i64) -> Result<Service> {
        let conn = self.conn.lock().unwrap();
        let service = conn.query_row(
            "SELECT id, name, description, command, cwd, env_vars, auto_start, restart_policy, max_restarts, port_auto_detect, status, pid, ports, cpu_percent, memory_mb, created_at, updated_at FROM services WHERE id = ?1",
            params![id],
            |row| {
                Ok(Service {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    command: row.get(3)?,
                    cwd: row.get(4)?,
                    env_vars: row.get(5)?,
                    auto_start: row.get(6)?,
                    restart_policy: row.get(7)?,
                    max_restarts: row.get(8)?,
                    port_auto_detect: row.get(9)?,
                    status: row.get(10)?,
                    pid: row.get(11)?,
                    ports: row.get(12)?,
                    cpu_percent: row.get(13)?,
                    memory_mb: row.get(14)?,
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                })
            },
        )?;
        Ok(service)
    }

    pub fn update_service(
        &self,
        id: i64,
        name: &str,
        description: &str,
        command: &str,
        cwd: &str,
        env_vars: &str,
        auto_start: bool,
        restart_policy: &str,
        max_restarts: i64,
        port_auto_detect: bool,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE services SET name = ?1, description = ?2, command = ?3, cwd = ?4, env_vars = ?5, auto_start = ?6, restart_policy = ?7, max_restarts = ?8, port_auto_detect = ?9, updated_at = CURRENT_TIMESTAMP WHERE id = ?10",
            params![
                name, description, command, cwd, env_vars, auto_start,
                restart_policy, max_restarts, port_auto_detect, id
            ],
        )?;
        Ok(())
    }

    pub fn update_service_status(
        &self,
        id: i64,
        status: &str,
        pid: Option<i64>,
        ports: &str,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE services SET status = ?1, pid = ?2, ports = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
            params![status, pid, ports, id],
        )?;
        Ok(())
    }

    pub fn update_service_metrics(
        &self,
        id: i64,
        cpu_percent: f64,
        memory_mb: f64,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE services SET cpu_percent = ?1, memory_mb = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
            params![cpu_percent, memory_mb, id],
        )?;
        Ok(())
    }

    pub fn delete_service(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM service_logs WHERE service_id = ?1", params![id])?;
        conn.execute("DELETE FROM services WHERE id = ?1", params![id])?;
        Ok(())
    }

    // === Group CRUD ===

    pub fn list_groups(&self) -> Result<Vec<Group>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM groups ORDER BY sort_order, name"
        )?;
        let groups = stmt
            .query_map([], |row| {
                Ok(Group {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(groups)
    }

    pub fn create_group(&self, name: &str, parent_id: Option<i64>, sort_order: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO groups (name, parent_id, sort_order) VALUES (?1, ?2, ?3)",
            params![name, parent_id, sort_order],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_group(&self, id: i64, name: &str, parent_id: Option<i64>, sort_order: i64) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE groups SET name = ?1, parent_id = ?2, sort_order = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
            params![name, parent_id, sort_order, id],
        )?;
        Ok(())
    }

    pub fn delete_group(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        // Promote child groups to top-level
        conn.execute(
            "UPDATE groups SET parent_id = NULL WHERE parent_id = ?1",
            params![id],
        )?;
        // Set group_id to NULL for bookmarks in this group
        conn.execute(
            "UPDATE bookmarks SET group_id = NULL WHERE group_id = ?1",
            params![id],
        )?;
        conn.execute(
            "DELETE FROM groups WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    // === Bookmark CRUD ===

    pub fn create_bookmark(
        &self,
        name: &str,
        url: &str,
        description: &str,
        group_id: Option<i64>,
        icon: &str,
        service_id: Option<i64>,
        health_check_url: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO bookmarks (name, url, description, group_id, icon, service_id, health_check_url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![name, url, description, group_id, icon, service_id, health_check_url],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_bookmarks(&self, group_id: Option<i64>) -> Result<Vec<Bookmark>> {
        let conn = self.conn.lock().unwrap();
        let query = if let Some(_gid) = group_id {
            "SELECT id, name, url, description, group_id, icon, service_id, health_check_url, is_online, created_at, updated_at FROM bookmarks WHERE group_id = ?1 ORDER BY created_at DESC"
        } else {
            "SELECT id, name, url, description, group_id, icon, service_id, health_check_url, is_online, created_at, updated_at FROM bookmarks ORDER BY created_at DESC"
        };
        let mut stmt = conn.prepare(query)?;
        let bookmarks = if let Some(gid) = group_id {
            stmt
                .query_map(params![gid], |row| {
                    Ok(Bookmark {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        url: row.get(2)?,
                        description: row.get(3)?,
                        group_id: row.get(4)?,
                        icon: row.get(5)?,
                        service_id: row.get(6)?,
                        health_check_url: row.get(7)?,
                        is_online: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                })?
                .collect::<Result<Vec<_>>>()?
        } else {
            stmt
                .query_map([], |row| {
                    Ok(Bookmark {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        url: row.get(2)?,
                        description: row.get(3)?,
                        group_id: row.get(4)?,
                        icon: row.get(5)?,
                        service_id: row.get(6)?,
                        health_check_url: row.get(7)?,
                        is_online: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                })?
                .collect::<Result<Vec<_>>>()?
        };
        Ok(bookmarks)
    }

    pub fn update_bookmark(
        &self,
        id: i64,
        name: &str,
        url: &str,
        description: &str,
        group_id: Option<i64>,
        icon: &str,
        health_check_url: &str,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE bookmarks SET name = ?1, url = ?2, description = ?3, group_id = ?4, icon = ?5, health_check_url = ?6, updated_at = CURRENT_TIMESTAMP WHERE id = ?7",
            params![name, url, description, group_id, icon, health_check_url, id],
        )?;
        Ok(())
    }

    pub fn delete_bookmark(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
        Ok(())
    }

    // === Service Logs ===

    pub fn add_service_log(&self, service_id: i64, content: &str, level: &str) -> Result<()> {
        // Keep only last 5000 logs per service
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM service_logs WHERE service_id = ?1",
            params![service_id],
            |row| row.get(0),
        )?;

        if count >= 5000 {
            conn.execute(
                "DELETE FROM service_logs WHERE service_id = ?1 AND id IN (
                    SELECT id FROM service_logs WHERE service_id = ?1 ORDER BY created_at ASC LIMIT 100
                )",
                params![service_id],
            )?;
        }

        conn.execute(
            "INSERT INTO service_logs (service_id, content, level) VALUES (?1, ?2, ?3)",
            params![service_id, content, level],
        )?;
        Ok(())
    }

    pub fn get_service_logs(&self, service_id: i64, limit: i64) -> Result<Vec<ServiceLog>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, service_id, content, level, created_at FROM service_logs WHERE service_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        )?;
        let logs = stmt
            .query_map(params![service_id, limit], |row| {
                Ok(ServiceLog {
                    id: row.get(0)?,
                    service_id: row.get(1)?,
                    content: row.get(2)?,
                    level: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(logs)
    }

    // === Settings ===

    pub fn get_settings(&self) -> Result<AppSettings> {
        let conn = self.conn.lock().unwrap();
        let settings = conn.query_row(
            "SELECT id, theme, auto_refresh_interval, show_menu_bar, created_at, updated_at FROM settings WHERE id = 1",
            [],
            |row| {
                Ok(AppSettings {
                    id: row.get(0)?,
                    theme: row.get(1)?,
                    auto_refresh_interval: row.get(2)?,
                    show_menu_bar: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )?;
        Ok(settings)
    }

    pub fn update_settings(
        &self,
        theme: &str,
        auto_refresh_interval: i64,
        show_menu_bar: bool,
    ) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE settings SET theme = ?1, auto_refresh_interval = ?2, show_menu_bar = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            params![theme, auto_refresh_interval, show_menu_bar],
        )?;
        Ok(())
    }
}
