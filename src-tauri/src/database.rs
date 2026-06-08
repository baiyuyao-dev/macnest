use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Result};
use serde::{Deserialize, Serialize};

pub struct Database {
    pool: Pool<SqliteConnectionManager>,
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
    pub start_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub group_id: Option<i64>,
    pub icon: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub id: i64,
    pub theme: String,
    pub auto_refresh_interval: i64,
    pub show_menu_bar: bool,
    pub auto_sync_bookmarks_interval: i64,
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
    pub group_type: String,
    pub start_directory: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SshConnection {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub auth_data: String,
    pub group_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RdpConnection {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub domain: String,
    pub screen_width: i32,
    pub screen_height: i32,
    pub color_depth: i32,
    pub group_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TmuxSessionRecord {
    pub id: i64,
    pub tmux_name: String,
    pub display_name: String,
    pub start_directory: String,
    pub command: String,
    pub group_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Notification {
    pub id: i64,
    pub name: String,
    pub notify_type: String,
    pub content: String,
    pub trigger_condition: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationLog {
    pub id: i64,
    pub notification_id: i64,
    pub title: String,
    pub body: String,
    pub triggered_at: String,
    pub trigger_value: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MysqlConnection {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MysqlBackupTask {
    pub id: i64,
    pub connection_id: i64,
    pub database_name: String,
    pub cron_expression: String,
    pub backup_path: String,
    pub is_enabled: bool,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let manager = SqliteConnectionManager::file(path);
        let pool = Pool::builder()
            .max_size(10)
            .build(manager)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        Ok(Database { pool })
    }

    pub fn conn(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>> {
        self.pool.get().map_err(|_| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Null,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "database connection pool exhausted",
                )),
            )
        })
    }

    pub fn init(&self) -> Result<()> {
        self.conn()?.execute_batch(
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
                group_id INTEGER,
                icon TEXT DEFAULT 'link',
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
                auto_sync_bookmarks_interval INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            INSERT OR IGNORE INTO settings (id) VALUES (1);

            CREATE INDEX IF NOT EXISTS idx_service_logs_service_id ON service_logs(service_id);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_group_id ON bookmarks(group_id);

            UPDATE settings SET theme = 'dark' WHERE id = 1 AND theme IS NULL;

            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parent_id INTEGER,
                sort_order INTEGER DEFAULT 0,
                group_type TEXT DEFAULT 'bookmark',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(name, parent_id, group_type)
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

            CREATE TABLE IF NOT EXISTS ssh_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 22,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL,
                auth_data TEXT NOT NULL,
                group_name TEXT DEFAULT '默认',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS tmux_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tmux_name TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                start_directory TEXT DEFAULT '',
                command TEXT DEFAULT '',
                group_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS rdp_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 3389,
                username TEXT DEFAULT '',
                password TEXT DEFAULT '',
                domain TEXT DEFAULT '',
                screen_width INTEGER DEFAULT 1920,
                screen_height INTEGER DEFAULT 1080,
                color_depth INTEGER DEFAULT 32,
                group_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                notify_type TEXT NOT NULL,
                content TEXT NOT NULL,
                trigger_condition TEXT NOT NULL,
                enabled BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS notification_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                notification_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                trigger_value REAL
            );

            CREATE INDEX IF NOT EXISTS idx_notification_logs_notification_id ON notification_logs(notification_id);
            CREATE INDEX IF NOT EXISTS idx_notification_logs_triggered_at ON notification_logs(triggered_at);

            CREATE TABLE IF NOT EXISTS mysql_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                host TEXT NOT NULL DEFAULT 'localhost',
                port INTEGER NOT NULL DEFAULT 3306,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                database TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS mysql_backup_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id INTEGER NOT NULL,
                database_name TEXT NOT NULL,
                cron_expression TEXT NOT NULL,
                backup_path TEXT NOT NULL,
                is_enabled BOOLEAN DEFAULT 1,
                last_run_at DATETIME,
                last_status TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (connection_id) REFERENCES mysql_connections(id) ON DELETE CASCADE
            );
            "
        )?;

        // Add columns if they don't exist (ignore errors for duplicate columns)
        let conn = self.conn()?;
        let _ = conn.execute("ALTER TABLE services ADD COLUMN cpu_percent REAL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE services ADD COLUMN memory_mb REAL DEFAULT 0", []);

        // Migration: add group_id to bookmarks
        let _ = conn.execute("ALTER TABLE bookmarks ADD COLUMN group_id INTEGER", []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_bookmarks_group_id ON bookmarks(group_id)", []);

        // Migration: add group_id to ssh_connections
        let _ = conn.execute("ALTER TABLE ssh_connections ADD COLUMN group_id INTEGER", []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_ssh_connections_group_id ON ssh_connections(group_id)", []);

        // Migration: add group_type to groups
        let _ = conn.execute("ALTER TABLE groups ADD COLUMN group_type TEXT DEFAULT 'bookmark'", []);

        // Migration: add start_count to services
        let _ = conn.execute("ALTER TABLE services ADD COLUMN start_count INTEGER DEFAULT 0", []);

        // Migration: add auto_sync_bookmarks_interval to settings
        let _ = conn.execute("ALTER TABLE settings ADD COLUMN auto_sync_bookmarks_interval INTEGER DEFAULT 0", []);

        // Migration: add start_directory to groups
        let _ = conn.execute("ALTER TABLE groups ADD COLUMN start_directory TEXT DEFAULT ''", []);

        // Migration: add group_id to tmux_sessions
        let _ = conn.execute("ALTER TABLE tmux_sessions ADD COLUMN group_id INTEGER", []);

        // Migration: prune redundant columns from bookmarks (rebuild table)
        let bookmarks_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookmarks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if bookmarks_sql.contains("description")
            || bookmarks_sql.contains("service_id")
            || bookmarks_sql.contains("health_check_url")
            || bookmarks_sql.contains("is_online")
            || bookmarks_sql.contains("click_count")
        {
            let _ = conn.execute_batch(
                "BEGIN;
                CREATE TABLE bookmarks_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    group_id INTEGER,
                    icon TEXT DEFAULT 'link',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO bookmarks_new (id, name, url, group_id, icon, created_at, updated_at)
                SELECT id, name, url, group_id, icon, created_at, updated_at FROM bookmarks;
                DROP TABLE bookmarks;
                ALTER TABLE bookmarks_new RENAME TO bookmarks;
                COMMIT;"
            );
        }

        // Migration: fix groups unique constraint to include group_type.
        // SQLite autoindexes from column-level UNIQUE have sql=NULL, so we
        // inspect the CREATE TABLE statement directly.
        let groups_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'groups'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        let has_old_unique = groups_sql.contains("UNIQUE")
            && !groups_sql.contains("UNIQUE(name, parent_id, group_type)");
        if has_old_unique {
            let _ = conn.execute_batch(
                "BEGIN;
                CREATE TABLE groups_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    parent_id INTEGER,
                    sort_order INTEGER DEFAULT 0,
                    group_type TEXT DEFAULT 'bookmark',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(name, parent_id, group_type)
                );
                INSERT INTO groups_new (id, name, parent_id, sort_order, group_type, created_at, updated_at)
                SELECT id, name, parent_id, sort_order, group_type, created_at, updated_at FROM groups;
                DROP TABLE groups;
                ALTER TABLE groups_new RENAME TO groups;
                COMMIT;"
            );
        }

        // Migration: migrate ssh_connections group_name to group_id
        {
            let mut stmt = match conn.prepare("SELECT DISTINCT group_name FROM ssh_connections WHERE group_name IS NOT NULL AND group_name != ''") {
                Ok(s) => s,
                Err(_) => return Ok(()),
            };
            let group_names = match stmt.query_map([], |row| {
                let name: String = row.get(0)?;
                Ok(name)
            }) {
                Ok(iter) => iter.collect::<Result<Vec<_>>>().unwrap_or_default(),
                Err(_) => vec![],
            };
            drop(stmt);

            for name in group_names {
                let exists: Result<i64> = conn.query_row(
                    "SELECT id FROM groups WHERE name = ?1",
                    params![&name],
                    |row| row.get(0),
                );
                let group_id = match exists {
                    Ok(id) => id,
                    Err(_) => {
                        let _ = conn.execute(
                            "INSERT INTO groups (name, sort_order) VALUES (?1, 0)",
                            params![&name],
                        );
                        conn.last_insert_rowid()
                    }
                };
                let _ = conn.execute(
                    "UPDATE ssh_connections SET group_id = ?1 WHERE group_name = ?2 AND (group_id IS NULL OR group_id = 0)",
                    params![group_id, &name],
                );
            }
        }

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
        let conn = self.conn()?;
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
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, command, cwd, env_vars, auto_start, restart_policy, max_restarts, port_auto_detect, status, pid, ports, cpu_percent, memory_mb, start_count, created_at, updated_at FROM services ORDER BY id ASC"
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
                    start_count: row.get(15)?,
                    created_at: row.get(16)?,
                    updated_at: row.get(17)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(services)
    }

    pub fn get_service(&self, id: i64) -> Result<Service> {
        let conn = self.conn()?;
        let service = conn.query_row(
            "SELECT id, name, description, command, cwd, env_vars, auto_start, restart_policy, max_restarts, port_auto_detect, status, pid, ports, cpu_percent, memory_mb, start_count, created_at, updated_at FROM services WHERE id = ?1",
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
                    start_count: row.get(15)?,
                    created_at: row.get(16)?,
                    updated_at: row.get(17)?,
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
        self.conn()?.execute(
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
        self.conn()?.execute(
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
        self.conn()?.execute(
            "UPDATE services SET cpu_percent = ?1, memory_mb = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
            params![cpu_percent, memory_mb, id],
        )?;
        Ok(())
    }

    pub fn increment_service_start_count(&self, id: i64) -> Result<()> {
        self.conn()?.execute(
            "UPDATE services SET start_count = start_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn delete_service(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM service_logs WHERE service_id = ?1", params![id])?;
        conn.execute("DELETE FROM services WHERE id = ?1", params![id])?;
        Ok(())
    }

    // === Group CRUD ===

    pub fn list_groups(&self, group_type: &str) -> Result<Vec<Group>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, parent_id, sort_order, group_type, start_directory, created_at, updated_at FROM groups WHERE group_type = ?1 ORDER BY sort_order, name"
        )?;
        let groups = stmt
            .query_map(params![group_type], |row| {
                Ok(Group {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    sort_order: row.get(3)?,
                    group_type: row.get(4)?,
                    start_directory: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(groups)
    }

    pub fn create_group(&self, name: &str, parent_id: Option<i64>, sort_order: i64, group_type: &str, start_directory: &str) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO groups (name, parent_id, sort_order, group_type, start_directory) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, parent_id, sort_order, group_type, start_directory],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_group(&self, id: i64, name: &str, parent_id: Option<i64>, sort_order: i64, group_type: &str, start_directory: &str) -> Result<()> {
        self.conn()?.execute(
            "UPDATE groups SET name = ?1, parent_id = ?2, sort_order = ?3, group_type = ?4, start_directory = ?5, updated_at = CURRENT_TIMESTAMP WHERE id = ?6",
            params![name, parent_id, sort_order, group_type, start_directory, id],
        )?;
        Ok(())
    }

    pub fn delete_group(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
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
        // Set group_id to NULL for ssh_connections in this group
        conn.execute(
            "UPDATE ssh_connections SET group_id = NULL WHERE group_id = ?1",
            params![id],
        )?;
        // Set group_id to NULL for rdp_connections in this group
        conn.execute(
            "UPDATE rdp_connections SET group_id = NULL WHERE group_id = ?1",
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
        group_id: Option<i64>,
        icon: &str,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO bookmarks (name, url, group_id, icon) VALUES (?1, ?2, ?3, ?4)",
            params![name, url, group_id, icon],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_bookmarks(&self, group_id: Option<i64>) -> Result<Vec<Bookmark>> {
        let conn = self.conn()?;
        let query = if let Some(_gid) = group_id {
            "SELECT id, name, url, group_id, icon, created_at, updated_at FROM bookmarks WHERE group_id = ?1 ORDER BY created_at DESC"
        } else {
            "SELECT id, name, url, group_id, icon, created_at, updated_at FROM bookmarks ORDER BY created_at DESC"
        };
        let mut stmt = conn.prepare(query)?;
        let bookmarks = if let Some(gid) = group_id {
            stmt
                .query_map(params![gid], |row| {
                    Ok(Bookmark {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        url: row.get(2)?,
                        group_id: row.get(3)?,
                        icon: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
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
                        group_id: row.get(3)?,
                        icon: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
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
        group_id: Option<i64>,
        icon: &str,
    ) -> Result<()> {
        self.conn()?.execute(
            "UPDATE bookmarks SET name = ?1, url = ?2, group_id = ?3, icon = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5",
            params![name, url, group_id, icon, id],
        )?;
        Ok(())
    }

    pub fn delete_bookmark(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_all_bookmarks(&self) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM bookmarks", [])?;
        Ok(())
    }

    pub fn clear_bookmark_groups(&self) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM groups WHERE group_type = 'bookmark'", [])?;
        Ok(())
    }

    // === Service Logs ===

    pub fn add_service_log(&self, service_id: i64, content: &str, level: &str) -> Result<()> {
        // Keep only last 5000 logs per service
        let conn = self.conn()?;
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
        let conn = self.conn()?;
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
        let conn = self.conn()?;
        let settings = conn.query_row(
            "SELECT id, theme, auto_refresh_interval, show_menu_bar, auto_sync_bookmarks_interval, created_at, updated_at FROM settings WHERE id = 1",
            [],
            |row| {
                Ok(AppSettings {
                    id: row.get(0)?,
                    theme: row.get(1)?,
                    auto_refresh_interval: row.get(2)?,
                    show_menu_bar: row.get(3)?,
                    auto_sync_bookmarks_interval: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
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
        auto_sync_bookmarks_interval: i64,
    ) -> Result<()> {
        self.conn()?.execute(
            "UPDATE settings SET theme = ?1, auto_refresh_interval = ?2, show_menu_bar = ?3, auto_sync_bookmarks_interval = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            params![theme, auto_refresh_interval, show_menu_bar, auto_sync_bookmarks_interval],
        )?;
        Ok(())
    }

    // === SSH Connection CRUD ===

    pub fn create_ssh_connection(
        &self,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        auth_type: &str,
        auth_data: &str,
        group_id: Option<i64>,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO ssh_connections (name, host, port, username, auth_type, auth_data, group_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![name, host, port, username, auth_type, auth_data, group_id],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_ssh_connections(&self) -> Result<Vec<SshConnection>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, host, port, username, auth_type, auth_data, group_id, created_at, updated_at
             FROM ssh_connections ORDER BY created_at DESC"
        )?;
        let connections = stmt
            .query_map([], |row| {
                Ok(SshConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    auth_type: row.get(5)?,
                    auth_data: row.get(6)?,
                    group_id: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(connections)
    }

    pub fn get_ssh_connection(&self, id: i64) -> Result<SshConnection> {
        let conn = self.conn()?;
        let connection = conn.query_row(
            "SELECT id, name, host, port, username, auth_type, auth_data, group_id, created_at, updated_at
             FROM ssh_connections WHERE id = ?1",
            params![id],
            |row| {
                Ok(SshConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    auth_type: row.get(5)?,
                    auth_data: row.get(6)?,
                    group_id: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )?;
        Ok(connection)
    }

    pub fn update_ssh_connection(
        &self,
        id: i64,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        auth_type: &str,
        auth_data: &str,
        group_id: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE ssh_connections
             SET name = ?1, host = ?2, port = ?3, username = ?4,
                 auth_type = ?5, auth_data = ?6, group_id = ?7, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?8",
            params![name, host, port, username, auth_type, auth_data, group_id, id],
        )?;
        Ok(())
    }

    pub fn delete_ssh_connection(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM ssh_connections WHERE id = ?1", params![id])?;
        Ok(())
    }

    // === Tmux Session Mappings ===

    pub fn create_tmux_session(&self, tmux_name: &str, display_name: &str, start_directory: &str, command: &str, group_id: Option<i64>) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO tmux_sessions (tmux_name, display_name, start_directory, command, group_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![tmux_name, display_name, start_directory, command, group_id],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_tmux_session_by_tmux_name(&self, tmux_name: &str) -> Result<Option<TmuxSessionRecord>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, tmux_name, display_name, start_directory, command, group_id, created_at, updated_at FROM tmux_sessions WHERE tmux_name = ?1"
        )?;
        let mut rows = stmt.query(params![tmux_name])?;
        if let Some(row) = rows.next()? {
            Ok(Some(TmuxSessionRecord {
                id: row.get(0)?,
                tmux_name: row.get(1)?,
                display_name: row.get(2)?,
                start_directory: row.get(3)?,
                command: row.get(4)?,
                group_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_tmux_session_by_display_name(&self, display_name: &str) -> Result<Option<TmuxSessionRecord>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, tmux_name, display_name, start_directory, command, group_id, created_at, updated_at FROM tmux_sessions WHERE display_name = ?1 ORDER BY id DESC LIMIT 1"
        )?;
        let mut rows = stmt.query(params![display_name])?;
        if let Some(row) = rows.next()? {
            Ok(Some(TmuxSessionRecord {
                id: row.get(0)?,
                tmux_name: row.get(1)?,
                display_name: row.get(2)?,
                start_directory: row.get(3)?,
                command: row.get(4)?,
                group_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_tmux_sessions(&self) -> Result<Vec<TmuxSessionRecord>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, tmux_name, display_name, start_directory, command, group_id, created_at, updated_at FROM tmux_sessions ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TmuxSessionRecord {
                id: row.get(0)?,
                tmux_name: row.get(1)?,
                display_name: row.get(2)?,
                start_directory: row.get(3)?,
                command: row.get(4)?,
                group_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn update_tmux_session_display_name(&self, tmux_name: &str, display_name: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE tmux_sessions SET display_name = ?1, updated_at = CURRENT_TIMESTAMP WHERE tmux_name = ?2",
            params![display_name, tmux_name],
        )?;
        Ok(())
    }

    pub fn update_tmux_session_start_directory(&self, tmux_name: &str, start_directory: &str) -> Result<()> {
        let conn = self.conn()?;
        let affected = conn.execute(
            "UPDATE tmux_sessions SET start_directory = ?1, updated_at = CURRENT_TIMESTAMP WHERE tmux_name = ?2",
            params![start_directory, tmux_name],
        )?;
        if affected == 0 {
            return Err(rusqlite::Error::InvalidParameterName(
                format!("未找到 tmux 会话 '{}' 的数据库记录", tmux_name)
            ));
        }
        Ok(())
    }

    pub fn update_tmux_session_group_id(&self, tmux_name: &str, group_id: Option<i64>) -> Result<()> {
        let conn = self.conn()?;
        let affected = conn.execute(
            "UPDATE tmux_sessions SET group_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE tmux_name = ?2",
            params![group_id, tmux_name],
        )?;
        if affected == 0 {
            return Err(rusqlite::Error::InvalidParameterName(
                format!("未找到 tmux 会话 '{}' 的数据库记录", tmux_name)
            ));
        }
        Ok(())
    }

    pub fn delete_tmux_session_by_tmux_name(&self, tmux_name: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM tmux_sessions WHERE tmux_name = ?1", params![tmux_name])?;
        Ok(())
    }

    // === RDP Connection CRUD ===

    pub fn create_rdp_connection(
        &self,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        domain: &str,
        screen_width: i32,
        screen_height: i32,
        color_depth: i32,
        group_id: Option<i64>,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO rdp_connections (name, host, port, username, password, domain, screen_width, screen_height, color_depth, group_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![name, host, port, username, password, domain, screen_width, screen_height, color_depth, group_id],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_rdp_connections(&self) -> Result<Vec<RdpConnection>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, host, port, username, password, domain, screen_width, screen_height, color_depth, group_id, created_at, updated_at
             FROM rdp_connections ORDER BY created_at DESC"
        )?;
        let connections = stmt
            .query_map([], |row| {
                Ok(RdpConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    password: row.get(5)?,
                    domain: row.get(6)?,
                    screen_width: row.get(7)?,
                    screen_height: row.get(8)?,
                    color_depth: row.get(9)?,
                    group_id: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(connections)
    }

    pub fn get_rdp_connection(&self, id: i64) -> Result<RdpConnection> {
        let conn = self.conn()?;
        let connection = conn.query_row(
            "SELECT id, name, host, port, username, password, domain, screen_width, screen_height, color_depth, group_id, created_at, updated_at
             FROM rdp_connections WHERE id = ?1",
            params![id],
            |row| {
                Ok(RdpConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    password: row.get(5)?,
                    domain: row.get(6)?,
                    screen_width: row.get(7)?,
                    screen_height: row.get(8)?,
                    color_depth: row.get(9)?,
                    group_id: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        )?;
        Ok(connection)
    }

    pub fn update_rdp_connection(
        &self,
        id: i64,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        domain: &str,
        screen_width: i32,
        screen_height: i32,
        color_depth: i32,
        group_id: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE rdp_connections
             SET name = ?1, host = ?2, port = ?3, username = ?4, password = ?5, domain = ?6,
                 screen_width = ?7, screen_height = ?8, color_depth = ?9, group_id = ?10,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?11",
            params![name, host, port, username, password, domain, screen_width, screen_height, color_depth, group_id, id],
        )?;
        Ok(())
    }

    pub fn delete_rdp_connection(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM rdp_connections WHERE id = ?1", params![id])?;
        Ok(())
    }

    // === Notification CRUD ===

    pub fn create_notification(
        &self,
        name: &str,
        notify_type: &str,
        content: &str,
        trigger_condition: &str,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO notifications (name, notify_type, content, trigger_condition, enabled)
             VALUES (?1, ?2, ?3, ?4, 1)",
            params![name, notify_type, content, trigger_condition],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_notifications(&self) -> Result<Vec<Notification>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, notify_type, content, trigger_condition, enabled, created_at, updated_at
             FROM notifications ORDER BY created_at DESC"
        )?;
        let notifications = stmt
            .query_map([], |row| {
                Ok(Notification {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    notify_type: row.get(2)?,
                    content: row.get(3)?,
                    trigger_condition: row.get(4)?,
                    enabled: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(notifications)
    }

    pub fn get_notification(&self, id: i64) -> Result<Notification> {
        let conn = self.conn()?;
        let notification = conn.query_row(
            "SELECT id, name, notify_type, content, trigger_condition, enabled, created_at, updated_at
             FROM notifications WHERE id = ?1",
            params![id],
            |row| {
                Ok(Notification {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    notify_type: row.get(2)?,
                    content: row.get(3)?,
                    trigger_condition: row.get(4)?,
                    enabled: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )?;
        Ok(notification)
    }

    pub fn update_notification(
        &self,
        id: i64,
        name: &str,
        notify_type: &str,
        content: &str,
        trigger_condition: &str,
        enabled: bool,
    ) -> Result<()> {
        self.conn()?.execute(
            "UPDATE notifications
             SET name = ?1, notify_type = ?2, content = ?3, trigger_condition = ?4,
                 enabled = ?5, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?6",
            params![name, notify_type, content, trigger_condition, enabled, id],
        )?;
        Ok(())
    }

    pub fn toggle_notification(&self, id: i64, enabled: bool) -> Result<()> {
        self.conn()?.execute(
            "UPDATE notifications SET enabled = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![enabled, id],
        )?;
        Ok(())
    }

    pub fn delete_notification(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM notification_logs WHERE notification_id = ?1", params![id])?;
        conn.execute("DELETE FROM notifications WHERE id = ?1", params![id])?;
        Ok(())
    }

    // === Notification Logs ===

    pub fn add_notification_log(
        &self,
        notification_id: i64,
        title: &str,
        body: &str,
        trigger_value: Option<f64>,
    ) -> Result<()> {
        let conn = self.conn()?;

        // Keep only last 50 logs per notification
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notification_logs WHERE notification_id = ?1",
            params![notification_id],
            |row| row.get(0),
        )?;

        if count >= 50 {
            conn.execute(
                "DELETE FROM notification_logs WHERE notification_id = ?1 AND id IN (
                    SELECT id FROM notification_logs WHERE notification_id = ?1 ORDER BY triggered_at ASC LIMIT 1
                )",
                params![notification_id],
            )?;
        }

        conn.execute(
            "INSERT INTO notification_logs (notification_id, title, body, trigger_value)
             VALUES (?1, ?2, ?3, ?4)",
            params![notification_id, title, body, trigger_value],
        )?;
        Ok(())
    }

    pub fn list_notification_logs(&self, notification_id: i64) -> Result<Vec<NotificationLog>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, notification_id, title, body, triggered_at, trigger_value
             FROM notification_logs WHERE notification_id = ?1 ORDER BY triggered_at DESC LIMIT 50"
        )?;
        let logs = stmt
            .query_map(params![notification_id], |row| {
                Ok(NotificationLog {
                    id: row.get(0)?,
                    notification_id: row.get(1)?,
                    title: row.get(2)?,
                    body: row.get(3)?,
                    triggered_at: row.get(4)?,
                    trigger_value: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(logs)
    }

    // === MySQL Connection CRUD ===

    pub fn create_mysql_connection(
        &self,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: &str,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO mysql_connections (name, host, port, username, password, database)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![name, host, port, username, password, database],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_mysql_connections(&self) -> Result<Vec<MysqlConnection>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, host, port, username, password, database, created_at, updated_at
             FROM mysql_connections ORDER BY created_at DESC"
        )?;
        let connections = stmt
            .query_map([], |row| {
                Ok(MysqlConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    password: row.get(5)?,
                    database: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(connections)
    }

    pub fn get_mysql_connection(&self, id: i64) -> Result<MysqlConnection> {
        let conn = self.conn()?;
        let connection = conn.query_row(
            "SELECT id, name, host, port, username, password, database, created_at, updated_at
             FROM mysql_connections WHERE id = ?1",
            params![id],
            |row| {
                Ok(MysqlConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    password: row.get(5)?,
                    database: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )?;
        Ok(connection)
    }

    pub fn update_mysql_connection(
        &self,
        id: i64,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        database: &str,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE mysql_connections
             SET name = ?1, host = ?2, port = ?3, username = ?4, password = ?5,
                 database = ?6, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?7",
            params![name, host, port, username, password, database, id],
        )?;
        Ok(())
    }

    pub fn delete_mysql_connection(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM mysql_backup_tasks WHERE connection_id = ?1", params![id])?;
        conn.execute("DELETE FROM mysql_connections WHERE id = ?1", params![id])?;
        Ok(())
    }

    // === MySQL Backup Task CRUD ===

    pub fn create_mysql_backup_task(
        &self,
        connection_id: i64,
        database_name: &str,
        cron_expression: &str,
        backup_path: &str,
    ) -> Result<i64> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO mysql_backup_tasks (connection_id, database_name, cron_expression, backup_path)
             VALUES (?1, ?2, ?3, ?4)",
            params![connection_id, database_name, cron_expression, backup_path],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_mysql_backup_tasks(&self) -> Result<Vec<MysqlBackupTask>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, connection_id, database_name, cron_expression, backup_path,
                    is_enabled, last_run_at, last_status, created_at, updated_at
             FROM mysql_backup_tasks ORDER BY created_at DESC"
        )?;
        let tasks = stmt
            .query_map([], |row| {
                Ok(MysqlBackupTask {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    database_name: row.get(2)?,
                    cron_expression: row.get(3)?,
                    backup_path: row.get(4)?,
                    is_enabled: row.get(5)?,
                    last_run_at: row.get(6)?,
                    last_status: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(tasks)
    }

    pub fn update_mysql_backup_task_enabled(&self, id: i64, is_enabled: bool) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE mysql_backup_tasks SET is_enabled = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![is_enabled, id],
        )?;
        Ok(())
    }

    pub fn update_mysql_backup_task_status(
        &self,
        id: i64,
        last_status: &str,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE mysql_backup_tasks SET last_run_at = CURRENT_TIMESTAMP, last_status = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![last_status, id],
        )?;
        Ok(())
    }

    pub fn delete_mysql_backup_task(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM mysql_backup_tasks WHERE id = ?1", params![id])?;
        Ok(())
    }
}
