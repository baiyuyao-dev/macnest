use chrono::{DateTime, Duration, Local};
use cron::Schedule;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::database::{Database, Notification};
use crate::system;

/// Tracks the last trigger time for each notification to prevent duplicate triggers
struct TriggerTracker {
    last_triggered: HashMap<i64, DateTime<Local>>,
    /// Cooldown period for monitor notifications (5 minutes)
    monitor_cooldown: Duration,
}

impl TriggerTracker {
    fn new() -> Self {
        Self {
            last_triggered: HashMap::new(),
            monitor_cooldown: Duration::minutes(5),
        }
    }

    fn can_trigger(&self, notification_id: i64, now: DateTime<Local>, is_monitor: bool) -> bool {
        match self.last_triggered.get(&notification_id) {
            Some(last) => {
                if is_monitor {
                    // Monitor notifications: respect cooldown
                    now.signed_duration_since(*last) >= self.monitor_cooldown
                } else {
                    // Scheduled notifications: don't re-trigger within the same minute
                    let last_minute = last.timestamp() / 60;
                    let now_minute = now.timestamp() / 60;
                    last_minute != now_minute
                }
            }
            None => true,
        }
    }

    fn record_trigger(&mut self, notification_id: i64, now: DateTime<Local>) {
        self.last_triggered.insert(notification_id, now);
    }
}

/// Truncate datetime to minute boundary
fn truncate_to_minute(dt: DateTime<Local>) -> DateTime<Local> {
    let ts = dt.timestamp();
    let minute_ts = ts - (ts % 60);
    chrono::DateTime::from_timestamp(minute_ts, 0)
        .map(|utc| utc.with_timezone(&Local))
        .unwrap()
}

/// Check if a cron expression should trigger at the given time (within the current minute)
fn should_trigger_cron(cron_expr: &str, now: DateTime<Local>) -> bool {
    let schedule = match Schedule::from_str(cron_expr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[scheduler] Invalid cron expression '{}': {}", cron_expr, e);
            return false;
        }
    };

    let this_minute = truncate_to_minute(now);
    let next_minute = this_minute + Duration::minutes(1);

    // Find the next trigger time after just before this minute started
    let just_before = this_minute - Duration::milliseconds(1);

    for next_trigger in schedule.after(&just_before).take(1) {
        return next_trigger >= this_minute && next_trigger < next_minute;
    }

    false
}

/// Parse monitor trigger condition JSON and check if threshold is exceeded
/// Returns (should_trigger, current_value, threshold)
fn check_monitor_threshold(
    trigger_condition: &str,
    resource_usage: &system::ResourceUsage,
    cpu_detailed: &system::CpuDetailedUsage,
) -> (bool, f64, f64) {
    // trigger_condition format: {"metric":"cpu_temp","threshold":80.0}
    let condition: serde_json::Value = match serde_json::from_str(trigger_condition) {
        Ok(v) => v,
        Err(_) => return (false, 0.0, 0.0),
    };

    let metric = condition["metric"].as_str().unwrap_or("");
    let threshold = condition["threshold"].as_f64().unwrap_or(0.0);

    let (current, should_trigger) = match metric {
        "cpu_temp" => {
            let temp = cpu_detailed.thermal.temperature_celsius;
            // Only trigger if temperature is actually available (> 0)
            if temp > 0.0 {
                (temp, temp >= threshold)
            } else {
                (0.0, false)
            }
        }
        "cpu_pressure" => {
            let pressure = cpu_detailed.pressure.total_pressure;
            (pressure, pressure >= threshold)
        }
        "memory_usage" => {
            let mem = resource_usage.memory_percent;
            (mem, mem >= threshold)
        }
        _ => (0.0, false),
    };

    (should_trigger, current, threshold)
}

/// Send a notification via the app handle
fn send_notification(app_handle: &AppHandle, title: &str, body: &str) {
    // Emit an event that the frontend can listen to, and also send OS notification
    let _ = app_handle.emit("notification:triggered", serde_json::json!({
        "title": title,
        "body": body,
    }));

    // Send via osascript as fallback/reliable method
    let script = format!(
        r#"display notification "{}" with title "{}""#,
        body.replace('"', "\\\""),
        title.replace('"', "\\\"")
    );
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();
}

/// Main scheduler loop
pub fn start_scheduler(db_path: String, app_handle: AppHandle) {
    std::thread::spawn(move || {
        let db = match Database::new(&db_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[scheduler] Failed to open DB: {}", e);
                return;
            }
        };

        let tracker_arc = Arc::new(Mutex::new(TriggerTracker::new()));

        // Sleep until the start of the next minute for cleaner timing
        let now = Local::now();
        let next_minute = truncate_to_minute(now) + Duration::minutes(1);
        let sleep_ms = next_minute.signed_duration_since(now).num_milliseconds();
        if sleep_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(sleep_ms as u64));
        }

        loop {
            let now = Local::now();

            // Load all enabled notifications
            let notifications = match db.list_notifications() {
                Ok(list) => list.into_iter().filter(|n| n.enabled).collect::<Vec<_>>(),
                Err(e) => {
                    eprintln!("[scheduler] Failed to load notifications: {}", e);
                    vec![]
                }
            };

            // Get system metrics once per cycle (for monitor notifications)
            let (resource_usage, cpu_detailed) = {
                let has_monitor = notifications.iter().any(|n| n.notify_type == "monitor");
                if has_monitor {
                    let res = system::get_resource_usage().ok();
                    let cpu = system::get_cpu_detailed_usage().ok();
                    (res, cpu)
                } else {
                    (None, None)
                }
            };

            for notification in notifications {
                let mut guard = tracker_arc.lock().unwrap();

                match notification.notify_type.as_str() {
                    "scheduled" => {
                        if guard.can_trigger(notification.id, now, false)
                            && should_trigger_cron(&notification.trigger_condition, now)
                        {
                            drop(guard); // release lock before I/O

                            send_notification(
                                &app_handle,
                                &notification.name,
                                &notification.content,
                            );

                            // Log the trigger
                            let _ = db.add_notification_log(
                                notification.id,
                                &notification.name,
                                &notification.content,
                                None,
                            );

                            tracker_arc.lock().unwrap().record_trigger(notification.id, now);
                        }
                    }
                    "monitor" => {
                        if let (Some(ref res), Some(ref cpu)) = (&resource_usage, &cpu_detailed) {
                            let (should_trigger, current_value, threshold) =
                                check_monitor_threshold(&notification.trigger_condition, res, cpu);

                            if should_trigger
                                && guard.can_trigger(notification.id, now, true)
                            {
                                drop(guard);

                                let body = if notification.content.is_empty() {
                                    format!(
                                        "{} 当前值: {:.1}%, 阈值: {:.1}%",
                                        notification.name, current_value, threshold
                                    )
                                } else {
                                    notification.content.clone()
                                };

                                send_notification(&app_handle, &notification.name, &body);

                                let _ = db.add_notification_log(
                                    notification.id,
                                    &notification.name,
                                    &body,
                                    Some(current_value),
                                );

                                tracker_arc.lock().unwrap().record_trigger(notification.id, now);
                            }
                        }
                    }
                    _ => {}
                }
            }

            // Sleep until next minute
            let now = Local::now();
            let next_minute = truncate_to_minute(now) + Duration::minutes(1);
            let sleep_ms = next_minute.signed_duration_since(now).num_milliseconds();
            if sleep_ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(sleep_ms as u64));
            }
        }
    });
}
