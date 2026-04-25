#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ── Error reporting ───────────────────────────────────────────────────────────

#[cfg(windows)]
fn show_error_dialog(title: &str, message: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    let title_w: Vec<u16> = OsStr::new(title).encode_wide().chain(Some(0)).collect();
    let msg_w: Vec<u16> = OsStr::new(message).encode_wide().chain(Some(0)).collect();
    unsafe {
        MessageBoxW(
            HWND::default(),
            windows::core::PCWSTR(msg_w.as_ptr()),
            windows::core::PCWSTR(title_w.as_ptr()),
            MB_ICONERROR | MB_OK,
        );
    }
}

#[cfg(not(windows))]
fn show_error_dialog(_title: &str, message: &str) {
    eprintln!("{message}");
}

fn log_path() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("Agentistics").join("agentistics.log")
}

fn log_error(msg: &str) {
    let path = log_path();
    if let Some(p) = path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let line = format!("[{}] {}\n", chrono_now(), msg);
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{secs}")
}

fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("Agentistics crashed: {info}");
        log_error(&msg);
        let log = log_path();
        show_error_dialog(
            "Agentistics — Fatal Error",
            &format!("{msg}\n\nDetails written to:\n{}", log.display()),
        );
    }));
}

const HEALTH_URL: &str = "http://127.0.0.1:47291/api/health";
const DASHBOARD_URL: &str = "http://127.0.0.1:47291";

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Config {
    claude_dir: String,
}

fn config_path() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("Agentistics").join("config.json")
}

fn read_config(path: &Path) -> Option<Config> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write_config(path: &Path, config: &Config) -> Result<(), String> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string_pretty(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

// ── Source detection ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
struct ClaudeSource {
    label: String,
    path: String,
    kind: String, // "windows" | "wsl"
}

fn detect_sources() -> Vec<ClaudeSource> {
    let mut sources = Vec::new();

    // Windows native
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let claude = PathBuf::from(&userprofile).join(".claude");
        if claude.exists() {
            sources.push(ClaudeSource {
                label: format!("Windows — {}", claude.display()),
                path: claude.to_string_lossy().into_owned(),
                kind: "windows".to_string(),
            });
        }
    }

    // WSL distros — wsl.exe outputs UTF-16LE
    if let Ok(out) = std::process::Command::new("wsl")
        .args(["--list", "--quiet"])
        .output()
    {
        let text = decode_wsl_output(&out.stdout);
        for line in text.lines() {
            let distro = line.trim().trim_end_matches(" (Default)").trim();
            if distro.is_empty() {
                continue;
            }

            // Check each user home inside the distro
            let home_base = format!("\\\\wsl.localhost\\{}\\home", distro);
            if let Ok(entries) = std::fs::read_dir(&home_base) {
                for entry in entries.flatten() {
                    let claude = entry.path().join(".claude");
                    if claude.exists() {
                        sources.push(ClaudeSource {
                            label: format!(
                                "WSL {} / {} — {}",
                                distro,
                                entry.file_name().to_string_lossy(),
                                claude.display()
                            ),
                            path: claude.to_string_lossy().into_owned(),
                            kind: "wsl".to_string(),
                        });
                    }
                }
            }

            // root home
            let root_claude = format!("\\\\wsl.localhost\\{}\\root\\.claude", distro);
            if Path::new(&root_claude).exists() {
                sources.push(ClaudeSource {
                    label: format!("WSL {} / root — {}", distro, root_claude),
                    path: root_claude,
                    kind: "wsl".to_string(),
                });
            }
        }
    }

    sources
}

fn decode_wsl_output(bytes: &[u8]) -> String {
    // wsl --list outputs UTF-16LE (sometimes with BOM)
    let start = if bytes.starts_with(&[0xFF, 0xFE]) { 2 } else { 0 };
    let slice = &bytes[start..];
    if slice.len() % 2 == 0 && slice.len() >= 2 {
        let utf16: Vec<u16> = slice
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let decoded = String::from_utf16_lossy(&utf16).to_string();
        // Sanity check: if it contains printable ASCII it decoded correctly
        if decoded.chars().any(|c| c.is_ascii_alphabetic()) {
            return decoded;
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

// ── Server health ─────────────────────────────────────────────────────────────

async fn wait_for_server() -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
    else {
        return false;
    };
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while std::time::Instant::now() < deadline {
        if client
            .get(HEALTH_URL)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    false
}

// ── Sidecar ───────────────────────────────────────────────────────────────────

fn spawn_sidecar(
    app: &AppHandle,
    child_handle: &Arc<Mutex<Option<CommandChild>>>,
    claude_dir: &str,
) {
    let cmd = match app.shell().sidecar("binaries/agentop") {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("sidecar binary not found: {e}");
            log_error(&msg);
            show_error_dialog("Agentistics — Sidecar Error", &msg);
            return;
        }
    };
    match cmd.args(["server"]).env("CLAUDE_DIR", claude_dir).spawn() {
        Ok((_rx, child)) => *child_handle.lock().unwrap() = Some(child),
        Err(e) => {
            let msg = format!("failed to spawn server: {e}");
            log_error(&msg);
            show_error_dialog("Agentistics — Launch Error", &msg);
        }
    }
}

fn navigate_after_ready(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let ready = wait_for_server().await;
        if let Some(win) = app.get_webview_window("main") {
            if ready {
                let _ = win.navigate(DASHBOARD_URL.parse().unwrap());
            } else {
                let _ = win.eval(
                    "document.getElementById('status').textContent = \
                     'Server failed to start. Please restart the app.'",
                );
            }
        }
    });
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct SetupState {
    configured: bool,
    claude_dir: Option<String>,
    sources: Vec<ClaudeSource>,
}

struct AppState {
    child_handle: Arc<Mutex<Option<CommandChild>>>,
    config_path: PathBuf,
}

#[tauri::command]
fn get_setup_state(state: State<AppState>) -> SetupState {
    let config = read_config(&state.config_path);
    let configured = config.is_some();
    SetupState {
        claude_dir: config.as_ref().map(|c| c.claude_dir.clone()),
        sources: if configured { vec![] } else { detect_sources() },
        configured,
    }
}

#[tauri::command]
async fn launch_with_config(
    claude_dir: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    write_config(&state.config_path, &Config { claude_dir: claude_dir.clone() })?;
    spawn_sidecar(&app, &state.child_handle, &claude_dir);
    navigate_after_ready(app);
    Ok(())
}

#[tauri::command]
fn reset_config(state: State<AppState>) -> Result<(), String> {
    if state.config_path.exists() {
        std::fs::remove_file(&state.config_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    install_panic_hook();

    let child_handle: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
    let child_exit = child_handle.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            child_handle: child_handle.clone(),
            config_path: config_path(),
        })
        .invoke_handler(tauri::generate_handler![
            get_setup_state,
            launch_with_config,
            reset_config,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            // If already configured, start the sidecar right away.
            if let Some(config) = read_config(&config_path()) {
                spawn_sidecar(&handle, &child_handle, &config.claude_dir);
                navigate_after_ready(handle);
            }
            // Otherwise the JS onboarding calls launch_with_config.
            Ok(())
        })
        .on_window_event(move |_win, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(child) = child_exit.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            let msg = format!("Agentistics failed to start: {e}");
            log_error(&msg);
            show_error_dialog("Agentistics — Fatal Error", &msg);
        });
}
