#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod pointer;
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
}

fn pointer_path(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "Private app config directory unavailable.")?
        .join("configuration-v1.json"))
}

fn stop_runtime(app: &tauri::AppHandle) {
    let runtime = app.state::<Runtime>();
    runtime.quitting.store(true, Ordering::SeqCst);
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

fn launch(app: &tauri::AppHandle, config: PathBuf) -> Result<String, &'static str> {
    pointer::validate_file(&config)?;
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
    let resources = if cfg!(debug_assertions) {
        // desktop:dev consumes the same explicit assembly output without a bundle.
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    } else {
        app.path()
            .resource_dir()
            .map_err(|_| "Bundle resources unavailable.")?
            .join("resources")
    };
    let service = supervisor::Service::start(&resources, &config, &runtime.quitting)?;
    let origin = format!("http://127.0.0.1:{}", service.port);
    let url = origin.parse().map_err(|_| "Owned origin invalid.")?;
    let expected = origin.clone();
    let title = if service.tooling_available {
        "Garmin Trainer"
    } else {
        "Garmin Trainer — connector tooling/config unavailable"
    };
    pointer::save(&pointer_path(app)?, config)?;
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
async fn select_configuration(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    if window.label() != "setup" {
        return Err("Setup window only.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Select existing private trainer configuration (writes its configured DB)")
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok("Selection cancelled. No configuration changed.".into());
        };
        let path = selected
            .into_path()
            .map_err(|_| "Select a local file, not a URL.".to_string())?;
        pointer::validate_file(&path).map_err(str::to_owned)?;
        let runtime = app.state::<Runtime>();
        let running = runtime.service.lock().map_err(|_| "Runtime ownership unavailable.".to_string())?.is_some();
        if running {
            pointer::save(&pointer_path(&app).map_err(str::to_owned)?, path).map_err(str::to_owned)?;
            return Ok("Reference saved for next launch. Quit and reopen to adopt it; the running backend is unchanged.".into());
        }
        launch(&app, path).map_err(str::to_owned)
    })
    .await
    .map_err(|_| "Native setup interrupted.".to_string())?
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
        .invoke_handler(tauri::generate_handler![select_configuration, setup_status])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if window.label() == "setup" {
                    api.prevent_close();
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
                .text("configuration", "Configuration…").separator().quit().build()?;
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
                // Only this app-owned pointer is consulted, never home/config discovery.
                if let Ok(path) = pointer_path(&handle) {
                    if path.exists() {
                        match pointer::load(&path).and_then(|config| launch(&handle, config)) {
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
