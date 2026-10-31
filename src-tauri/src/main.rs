#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod auth;
mod keychain;
mod settings;
mod supervisor;

use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Runtime {
    service: Mutex<Option<supervisor::Service>>,
    quitting: AtomicBool,
    status: Mutex<String>,
    settings_write: Mutex<()>,
    auth: Mutex<auth::Auth>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "Private app config directory unavailable.")?
        .join("settings-v1.json"))
}

fn resources(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    if cfg!(debug_assertions) {
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"))
    } else {
        Ok(app
            .path()
            .resource_dir()
            .map_err(|_| "Bundle resources unavailable.")?
            .join("resources"))
    }
}
fn setup_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "setup" {
        Ok(())
    } else {
        Err("Local settings window only.".into())
    }
}

fn stop_runtime(app: &tauri::AppHandle) {
    let runtime = app.state::<Runtime>();
    runtime.quitting.store(true, Ordering::SeqCst);
    if let Ok(mut auth) = runtime.auth.lock() {
        auth.stop();
    }
    if let Ok(mut guard) = runtime.service.lock() {
        if guard.is_some() {
            eprintln!("desktop: stopping owned backend");
        }
        guard.take();
    };
}

fn status(app: &tauri::AppHandle, message: &str) {
    if let Ok(mut saved) = app.state::<Runtime>().status.lock() {
        *saved = message.to_owned();
    }
    let _ = app.emit_to("setup", "desktop-status", message);
}

fn launch(app: &tauri::AppHandle) -> Result<String, &'static str> {
    let runtime = app.state::<Runtime>();
    let mut guard = runtime
        .service
        .lock()
        .map_err(|_| "Runtime ownership unavailable.")?;
    if runtime.quitting.load(Ordering::SeqCst) {
        return Err("App is quitting.");
    }
    if guard.is_some() {
        return Ok("Runtime already started; quit before changing its configuration.".into());
    }
    status(
        app,
        "Starting owned local backend; checking configuration, database and resources…",
    );
    let _write = runtime
        .settings_write
        .lock()
        .map_err(|_| "Settings ownership unavailable.")?;
    let mut snapshot = settings::activation(&settings_path(app)?, &keychain::Keychain)?;
    drop(_write); // Saves remain available during backend startup; activation is immutable.
    let result = supervisor::Service::start(&resources(app)?, &mut snapshot, &runtime.quitting);
    snapshot.fill(0);
    let service = result?;
    let origin = format!("http://127.0.0.1:{}", service.port);
    let url = origin.parse().map_err(|_| "Owned origin invalid.")?;
    let expected = origin.clone();
    let title = if service.tooling_available {
        "Garmin Trainer"
    } else {
        "Garmin Trainer — connector tooling/config unavailable"
    };
    WebviewWindowBuilder::new(app, "trainer", WebviewUrl::External(url))
        .title(title)
        .inner_size(1280.0, 850.0)
        .on_navigation(move |url| url.origin().ascii_serialization() == expected)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|_| "Cannot create desktop window.")?;
    *guard = Some(service);
    if let Some(setup) = app.get_webview_window("setup") {
        let _ = setup.hide();
    }
    Ok("Ready. Runtime owns its loopback backend; originals were not relocated.".into())
}

#[tauri::command]
fn setup_status(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<String, String> {
    if window.label() != "setup" {
        return Err("Setup window only.".into());
    }
    let runtime = app.state::<Runtime>();
    let saved = runtime
        .status
        .lock()
        .map_err(|_| "Status unavailable.".to_string())?;
    Ok(saved.clone())
}

#[tauri::command]
async fn read_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<settings::Snapshot, String> {
    setup_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let running = runtime
            .service
            .try_lock()
            .map(|guard| guard.is_some())
            .unwrap_or(true);
        let _write = runtime
            .settings_write
            .lock()
            .map_err(|_| "Settings ownership unavailable.")?;
        settings::snapshot(&settings_path(&app)?, &keychain::Keychain, running)
    })
    .await
    .map_err(|_| "Settings read interrupted.".to_string())?
    .map_err(str::to_owned)
}
#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: settings::SaveInput,
) -> Result<String, String> {
    setup_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let _write = runtime
            .settings_write
            .lock()
            .map_err(|_| "Settings ownership unavailable.")?;
        if runtime.quitting.load(Ordering::SeqCst) {
            return Err("App is quitting.");
        }
        let fields = settings::validate(&resources(&app)?, &input.fields)?;
        let updates = input.keys;
        settings::save(&settings_path(&app)?, fields, updates, &keychain::Keychain)
    })
    .await
    .map_err(|_| "Settings save interrupted.".to_string())?
    .map_err(str::to_owned)
}
#[tauri::command]
async fn choose_path(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    kind: String,
) -> Result<Option<String>, String> {
    setup_only(&window)?;
    if !["path", "directory"].contains(&kind.as_str()) {
        return Err("Unsupported selection.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let picker = app
            .dialog()
            .file()
            .set_title("Select existing local state; originals are not moved");
        let selected = if kind == "directory" {
            picker.blocking_pick_folder()
        } else {
            picker.blocking_pick_file()
        };
        selected
            .map(|file| {
                file.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|_| "Select a local path, not a URL.".to_string())
            })
            .transpose()
    })
    .await
    .map_err(|_| "Selection interrupted.".to_string())?
}
#[tauri::command]
async fn start_auth(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    destination: String,
    email: String,
    password: String,
) -> Result<auth::Status, String> {
    setup_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        if runtime.quitting.load(Ordering::SeqCst) {
            return Err("App is quitting.");
        }
        // Only a saved validated FIT/uv override or the fixed GUI search is used.
        let configured = settings_path(&app)
            .ok()
            .filter(|path| path.exists())
            .map(|path| settings::load(&path))
            .transpose()?
            .and_then(|saved| saved.fields.get("GARMIN_FIT_BASELINE_COMMAND").cloned());
        let executable = if let Some(path) = configured.filter(|path| path != "uv") {
            PathBuf::from(path)
        } else {
            ["/opt/homebrew/bin/uv", "/usr/local/bin/uv", "/usr/bin/uv"]
                .iter()
                .map(PathBuf::from)
                .find(|path| path.is_file())
                .ok_or("uv tooling unavailable. Install/manage it separately.")?
        };
        let result = runtime
            .auth
            .lock()
            .map_err(|_| "Auth ownership unavailable.")?
            .start(
                &resources(&app)?,
                &executable,
                PathBuf::from(destination),
                email,
                password,
            );
        result
    })
    .await
    .map_err(|_| "Auth start interrupted.".to_string())?
    .map_err(str::to_owned)
}
#[tauri::command]
fn auth_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<auth::Status>, String> {
    setup_only(&window)?;
    let runtime = app.state::<Runtime>();
    let result = runtime
        .auth
        .lock()
        .map_err(|_| "Auth status unavailable.".to_string())?
        .status();
    Ok(result)
}
#[tauri::command]
fn submit_mfa(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    code: String,
) -> Result<auth::Status, String> {
    setup_only(&window)?;
    let runtime = app.state::<Runtime>();
    let result = runtime
        .auth
        .lock()
        .map_err(|_| "Auth ownership unavailable.".to_string())?
        .mfa(&id, code);
    result.map_err(str::to_owned)
}
#[tauri::command]
fn cancel_auth(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<auth::Status, String> {
    setup_only(&window)?;
    let runtime = app.state::<Runtime>();
    let result = runtime
        .auth
        .lock()
        .map_err(|_| "Auth ownership unavailable.".to_string())?
        .cancel(&id);
    result.map_err(str::to_owned)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            // Never consume second-instance arguments as configuration consent.
            let window = app.get_webview_window("trainer").or_else(|| app.get_webview_window("setup"));
            if let Some(window) = window { let _ = window.show(); let _ = window.set_focus(); }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Runtime::default())
        .invoke_handler(tauri::generate_handler![setup_status, read_settings, save_settings, choose_path, start_auth, auth_status, submit_mfa, cancel_auth])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if window.label() == "setup" {
                    api.prevent_close();
                    if let Ok(mut auth)=app.state::<Runtime>().auth.lock(){auth.stop();}
                    let _=app.emit_to("setup","desktop-settings-closed",());
                    if app.get_webview_window("trainer").is_some() { let _ = window.hide(); }
                    else { app.exit(0); }
                } else if window.label() == "trainer" {
                    let runtime = app.state::<Runtime>();
                    let running = runtime.service.try_lock().map(|guard| guard.is_some()).unwrap_or(true);
                    if running { api.prevent_close(); app.exit(0); }
                }
            }
        })
        .setup(|app| {
            let app_menu = tauri::menu::SubmenuBuilder::new(app, "Garmin Trainer")
                .text("configuration", "Desktop Settings…").separator().quit().build()?;
            let menu = tauri::menu::MenuBuilder::new(app).item(&app_menu).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "configuration" {
                    if let Some(setup) = app.get_webview_window("setup") { let _ = setup.show(); let _ = setup.set_focus(); }
                }
            });
            let signal_handle = app.handle().clone();
            ctrlc::set_handler(move || { stop_runtime(&signal_handle); signal_handle.exit(0); })?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                // Only versioned app-owned settings are consulted. Old env
                // pointers/files remain untouched and are never imported.
                if let Ok(path) = settings_path(&handle) {
                    if path.exists() {
                        match launch(&handle) {
                            Ok(message) => status(&handle, &message),
                            Err(message) => status(&handle, message),
                        }
                    }
                }
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                let runtime = handle.state::<Runtime>();
                if runtime.quitting.load(Ordering::SeqCst) { break; }
                if let Ok(mut auth)=runtime.auth.try_lock(){auth.tick();}
                if let Ok(mut guard) = runtime.service.try_lock() {
                    if guard.as_mut().map(|service| service.exited()).unwrap_or(false) {
                        guard.take(); // Drop terminates any owned connector descendants.
                        drop(guard);
                        if let Some(window) = handle.get_webview_window("trainer") { let _ = window.close(); }
                        if let Some(window) = handle.get_webview_window("setup") { let _ = window.show(); }
                        status(&handle, "Local backend exited. Work may be interrupted; saved turns/checkpoints remain. Inspect ownership and reopen explicitly; no automatic retry.");
                    }
                };
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Native desktop initialization failed");
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            let runtime = handle.state::<Runtime>();
            if !runtime.quitting.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                stop_runtime(handle);
                handle.exit(0);
            }
        } else if let tauri::RunEvent::Exit = event {
            stop_runtime(handle);
        }
    });
}
