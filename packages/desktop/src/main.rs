#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const HEALTH_URL: &str = "http://127.0.0.1:47291/api/health";
const DASHBOARD_URL: &str = "http://127.0.0.1:47291";
const POLL_INTERVAL_MS: u64 = 250;
const MAX_WAIT_SECS: u64 = 30;

type ChildHandle = Arc<Mutex<Option<CommandChild>>>;

async fn wait_for_server() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    let deadline = std::time::Instant::now() + Duration::from_secs(MAX_WAIT_SECS);
    while std::time::Instant::now() < deadline {
        let ok = client
            .get(HEALTH_URL)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if ok {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
    }
    false
}

fn main() {
    let child_handle: ChildHandle = Arc::new(Mutex::new(None));
    let child_handle_exit = child_handle.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let handle = app.handle().clone();

            // Spawn agentop server as a sidecar process.
            match handle
                .shell()
                .sidecar("agentop")
                .expect("agentop sidecar not found — check tauri.conf.json externalBin")
                .args(["server"])
                .spawn()
            {
                Ok((_rx, child)) => {
                    *child_handle.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("[agentistics] Failed to spawn sidecar: {e}");
                }
            }

            // Background task: wait for the server to be ready, then navigate.
            let handle2 = handle.clone();
            tauri::async_runtime::spawn(async move {
                let ready = wait_for_server().await;
                if let Some(win) = handle2.get_webview_window("main") {
                    if ready {
                        let _ = win.navigate(DASHBOARD_URL.parse().unwrap());
                    } else {
                        let _ = win.eval(
                            "document.getElementById('status').textContent = \
                             'Server failed to start. Please restart the app.';",
                        );
                    }
                }
            });

            Ok(())
        })
        .on_window_event(move |_window, event| {
            // Kill the sidecar when the main window is closed.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(child) = child_handle_exit.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Agentistics desktop");
}
