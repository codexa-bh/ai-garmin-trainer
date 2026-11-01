#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod auth;
#[cfg(any(debug_assertions, not(feature = "release-probe")))]
mod dev_bridge;
mod isolated_run;
mod keychain;
mod memory_status;
mod onboarding;
mod private_store;
mod settings;
#[cfg(debug_assertions)]
mod setup_smoke;
#[cfg(any(debug_assertions, feature = "release-probe"))]
mod smoke_config;
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
    onboarding: Mutex<Option<onboarding::State>>,
    onboarding_id: Mutex<String>,
    onboarding_cancel: AtomicBool,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    if let Some(run) = app.try_state::<std::sync::Arc<isolated_run::Admission>>() {
        run.verify()?;
        return Ok(run.settings());
    }
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    if let Some(config) = app.try_state::<smoke_config::Config>() {
        return Ok(config.settings());
    }
    Ok(settings::selected(&app.path().app_config_dir().map_err(
        |_| "Private app config directory unavailable.",
    )?))
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

fn private_setup_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    setup_only(window)?;
    if window
        .app_handle()
        .try_state::<std::sync::Arc<isolated_run::Admission>>()
        .is_some()
    {
        return Err("Private authentication, adoption, dialogs and first-run mutation are unavailable in isolated ordinary runs.".into());
    }
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    if window
        .app_handle()
        .try_state::<smoke_config::Config>()
        .is_some()
    {
        return Err("Private authentication, adoption, dialogs and first-run mutation are unavailable in admitted smoke.".into());
    }
    Ok(())
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
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    if app.try_state::<smoke_config::Config>().is_some() {
        eprintln!("isolated startup: {message}");
    }
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
    if let Some(run) = app.try_state::<std::sync::Arc<isolated_run::Admission>>() {
        run.verify_settings()?;
    }
    let mut snapshot = settings::activation(&settings_path(app)?)?;
    drop(_write); // Saves remain available during backend startup; activation is immutable.
    let result = supervisor::Service::start(
        &resources(app)?,
        &mut snapshot,
        &runtime.quitting,
        &runtime.onboarding_cancel,
    );
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
    #[allow(unused_mut)]
    let mut window = WebviewWindowBuilder::new(app, "trainer", WebviewUrl::External(url));
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    if let Some(config) = app.try_state::<smoke_config::Config>() {
        window = window
            .focused(false)
            .incognito(true)
            .data_directory(config.root.join("profile"));
    }
    if let Some(run) = app.try_state::<std::sync::Arc<isolated_run::Admission>>() {
        run.verify()?;
        window = window
            .focused(false)
            .incognito(true)
            .data_directory(run.descriptor.root.join("profile"));
    }
    #[cfg(any(debug_assertions, not(feature = "release-probe")))]
    if let Some(bridge) = app.try_state::<std::sync::Arc<dev_bridge::Bridge>>() {
        *bridge
            .origin
            .lock()
            .map_err(|_| "Smoke origin unavailable")? = Some(origin.clone());
        let (identifier, permission) = if bridge.config.ordinary.is_some() {
            ("isolated-ordinary-result", "allow-isolated-result")
        } else {
            #[cfg(debug_assertions)]
            {
                ("isolated-debug-result", "allow-smoke-result")
            }
            #[cfg(not(debug_assertions))]
            {
                return Err("Ordinary controller requires native isolated admission");
            }
        };
        app.add_capability(serde_json::json!({"identifier":identifier, "windows":["trainer"], "local":false, "remote":{"urls":[format!("{origin}/*")]}, "permissions":[permission]}).to_string()).map_err(|_| "Isolated result capability unavailable")?;
        if bridge.config.ordinary.is_some() {
            window = window.initialization_script(format!(
                "globalThis.__trainerOrdinaryIsolated = {{runId:{}}};",
                serde_json::to_string(&bridge.config.run_id)
                    .map_err(|_| "Run identity unavailable")?
            ));
        }
        window = window.initialization_script(include_str!("../debug/smoke.js"));
    }
    #[cfg(all(feature = "release-probe", not(debug_assertions)))]
    let probe_app = app.clone();
    window
        .title(title)
        .inner_size(1280.0, 850.0)
        .on_navigation(move |url| {
            #[cfg(all(feature = "release-probe", not(debug_assertions)))]
            if url.scheme() == "trainer-release-probe" {
                if let Some(config) = probe_app.try_state::<smoke_config::Config>() {
                    let denied = matches!(url.host_str(), Some("not-found" | "permission-refused"));
                    let report = serde_json::json!({"runId":config.run_id,"releaseMode":true,"debugCommandDenied":denied,"denialKind":url.host_str(),"instrumentation":"launch-only; not ordinary artifact launch"});
                    use std::os::unix::fs::OpenOptionsExt;
                    use std::io::Write;
                    if let Ok(mut file) = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(config.root.join("release-denial.json")) {
                        let _=file.write_all(report.to_string().as_bytes());
                    }
                    probe_app.exit(if denied{0}else{1});
                }
                return false;
            }
            url.origin().ascii_serialization() == expected
        })
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
        settings::snapshot(&settings_path(&app)?, running)
    })
    .await
    .map_err(|_| "Settings read interrupted.".to_string())?
    .map_err(str::to_owned)
}
#[tauri::command]
async fn read_memory_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<memory_status::Status, String> {
    setup_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let mut guard = runtime
            .service
            .try_lock()
            .map_err(|_| "Owned runtime busy; status unknown.")?;
        guard
            .as_mut()
            .ok_or("Owned backend not running.")?
            .memory_status()
    })
    .await
    .map_err(|_| "Status read interrupted.".to_string())?
    .map_err(str::to_owned)
}
#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: settings::SaveInput,
) -> Result<String, String> {
    setup_only(&window)?;
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    if let Some(config) = app.try_state::<smoke_config::Config>() {
        if !config.accepts_save(&input) {
            return Err(
                "Smoke Save permits only exact keyless run-local settings and catalog defaults."
                    .into(),
            );
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let onboarding = runtime
            .onboarding
            .try_lock()
            .map_err(|_| "Onboarding is busy. Wait or cancel the current operation.")?;
        if onboarding
            .as_ref()
            .map(|state| state.eligible)
            .unwrap_or(false)
        {
            return Err(
                "Use Finish for this first-run session. Ordinary saves never launch a backend.",
            );
        }
        let _write = runtime
            .settings_write
            .lock()
            .map_err(|_| "Settings ownership unavailable.")?;
        if runtime.quitting.load(Ordering::SeqCst) {
            return Err("App is quitting.");
        }
        let fields = settings::validate(&resources(&app)?, &input.fields)?;
        if let Some(run) = app.try_state::<std::sync::Arc<isolated_run::Admission>>() {
            run.confine(&fields)?;
        }
        let updates = input.keys;
        settings::save(&settings_path(&app)?, fields, updates)
    })
    .await
    .map_err(|_| "Settings save interrupted.".to_string())?
    .map_err(str::to_owned)
}
// Explicit local action only: never called by startup, refresh, Save or Finish.
#[tauri::command]
async fn adopt_provider_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: settings::SaveInput,
    read_legacy: bool,
) -> Result<String, String> {
    private_setup_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let _setup = runtime
            .onboarding
            .try_lock()
            .map_err(|_| "Setup operation active.")?;
        let _write = runtime
            .settings_write
            .try_lock()
            .map_err(|_| "Settings operation active.")?;
        if runtime.quitting.load(Ordering::SeqCst) {
            return Err("App is quitting.");
        }
        let path = settings_path(&app)?;
        let fields = settings::validate(&resources(&app)?, &input.fields)?;
        let (next, original) = settings::adoption(
            &path,
            settings::SaveInput {
                fields,
                keys: input.keys,
            },
            read_legacy,
            &keychain::Keychain,
        )?;
        let mut frame = settings::adoption_frame(&next)?;
        let result = onboarding::bundled(
            &resources(&app)?,
            "--validate-existing-activation",
            &mut frame,
            128 * 1024,
            &runtime.onboarding_cancel,
            &runtime.quitting,
        );
        frame.fill(0);
        result?;
        if runtime.quitting.load(Ordering::SeqCst) {
            return Err("Adoption cancelled before commit; originals unchanged.");
        }
        settings::commit_adoption(&path, &next, &original)
    })
    .await
    .map_err(|_| "Adoption outcome unknown; reload saved state before retry.".to_owned())?
    .map_err(str::to_owned)
}
#[tauri::command]
fn read_onboarding(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<onboarding::Snapshot, String> {
    setup_only(&window)?;
    let runtime = app.state::<Runtime>();
    let state = runtime
        .onboarding
        .try_lock()
        .map_err(|_| "Setup operation is still active; do not retry.")?;
    Ok(state.as_ref().ok_or("Setup state unavailable.")?.snapshot())
}
#[tauri::command]
fn cancel_onboarding(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    setup_only(&window)?;
    let runtime = app.state::<Runtime>();
    if *runtime
        .onboarding_id
        .lock()
        .map_err(|_| "Setup identity unavailable.")?
        != id
    {
        return Err("Stale setup operation.".into());
    }
    runtime.onboarding_cancel.store(true, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
async fn finish_onboarding(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: onboarding::FinishInput,
) -> Result<String, String> {
    private_setup_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let mut guard = runtime.onboarding.try_lock().map_err(|_| "Setup operation already active; do not retry until it settles.".to_owned())?;
        let state = guard.as_mut().ok_or("Setup state unavailable.")?;
        if !state.eligible || state.id != input.id || runtime.quitting.load(Ordering::SeqCst) { return Err("First-run eligibility refused; existing installations are never overwritten.".into()); }
        if runtime.service.try_lock().map(|service| service.is_some()).unwrap_or(true) { return Err("Runtime already started or starting; no live configuration switch.".into()); }
        runtime.onboarding_cancel.store(false, Ordering::SeqCst);
        if runtime.auth.lock().map_err(|_| "Auth state unavailable.")?.status().map(|status| ["authenticating", "needs-mfa", "submitting-mfa", "verifying"].contains(&status.state.as_str())).unwrap_or(false) {
            return Err("Finish after optional Garmin sign-in settles, or cancel that exact sign-in first.".into());
        }
        let result = (|| -> Result<String, &'static str> {
            let write = runtime.settings_write.try_lock().map_err(|_| "Settings operation already active.")?;
            let path = settings_path(&app)?;
            let mut message = String::new();
            if !state.settings_committed {
                if !matches!(std::fs::symlink_metadata(&path), Err(e) if e.kind() == std::io::ErrorKind::NotFound) { return Err("Settings appeared during onboarding. Preserve them and reopen explicitly; no overwrite."); }
                let fresh = matches!(input.selection, onboarding::Selection::CreateNew);
                let mut frame = settings::preview(&input.settings)?;
                let validated = onboarding::bundled(&resources(&app)?, if fresh {"--validate-new-activation"} else {"--validate-existing-activation"}, &mut frame, 128 * 1024, &runtime.onboarding_cancel, &runtime.quitting)?;
                #[derive(serde::Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Validated { ok: bool, fields: std::collections::BTreeMap<String, String> }
                let validated: Validated = serde_json::from_slice(&validated).map_err(|_| "Setup validation protocol refused.")?;
                if !validated.ok { return Err("Setup validation refused."); }
                let target = PathBuf::from(validated.fields.get("DATABASE_PATH").ok_or("Select a database.")?);
                if let Some(db) = &state.database { db.verify(&target)?; }
                if fresh { onboarding::initialize(&resources(&app)?, &target, &state.root, &mut state.database, &runtime.onboarding_cancel, &runtime.quitting)?; }
                if runtime.onboarding_cancel.load(Ordering::SeqCst) || runtime.quitting.load(Ordering::SeqCst) { return Err("Setup cancelled; committed outputs remain available for explicit retry."); }
                let fields = onboarding::validate(&resources(&app)?, &validated.fields, &runtime.onboarding_cancel, &runtime.quitting)?;
                message = settings::save_new(&path, fields, input.settings.keys)?;
                state.settings_committed = true;
                state.saved_settings = Some(onboarding::OwnedSettings::capture(&path)?);
            }
            state.saved_settings.as_ref().ok_or("Settings committed but identity unavailable. Preserve state and reopen explicitly.")?.verify(&path)?;
            drop(write);
            if runtime.onboarding_cancel.load(Ordering::SeqCst) { return Err("Setup cancelled after settings commit. Retry opens only the saved configuration."); }
            let ready = launch(&app)?;
            state.eligible = false;
            Ok(format!("{ready} {message}"))
        })();
        result.map_err(|error| format!("{error} Database committed: {}. Settings committed: {}. Independent successful Garmin tokens are retained. Retry reconciles saved state; no automatic recreation or rollback.", state.database.is_some(), state.settings_committed))
    }).await.map_err(|_| "Setup result interrupted; inspect commit state before retry.".to_owned())?
}

#[tauri::command]
async fn choose_path(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    kind: String,
) -> Result<Option<String>, String> {
    private_setup_only(&window)?;
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
    email: String,
    password: String,
) -> Result<auth::Status, String> {
    private_setup_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let _setup = runtime
            .onboarding
            .try_lock()
            .map_err(|_| "Setup is active; wait before starting optional sign-in.")?;
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
            .start_managed(
                &resources(&app)?,
                &executable,
                &app.path()
                    .app_data_dir()
                    .map_err(|_| "Private app storage unavailable.")?
                    .join("private"),
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
    private_setup_only(&window)?;
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
    let intent = isolated_run::intent(&std::env::args_os().skip(1).collect::<Vec<_>>());
    let ordinary = match intent.and_then(|path| {
        path.map(|path| isolated_run::Admission::load(&path).map(std::sync::Arc::new))
            .transpose()
    }) {
        Ok(run) => run,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    };
    if let Some(run) = &ordinary {
        unsafe {
            libc::umask(0o077);
        }
        std::env::set_var("TMPDIR", run.descriptor.root.join("tmp"));
    }
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[allow(unused_mut)]
    let mut isolated = ordinary.is_some();
    if let Some(run) = &ordinary {
        context.config_mut().identifier = run.identifier();
        context.config_mut().app.windows.clear();
    }
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    let smoke = match smoke_config::Config::load() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("Smoke admission refused: {error}");
            std::process::exit(1);
        }
    };
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    if let Some(config) = &smoke {
        if Some(config.source.as_str()) != option_env!("TRAINER_BUILD_SOURCE") {
            eprintln!("Smoke build/source mismatch");
            std::process::exit(1);
        }
        isolated = true;
        context.config_mut().identifier = config.identifier();
        context.config_mut().app.windows.clear();
    }
    #[cfg(all(feature = "release-probe", not(debug_assertions)))]
    if !isolated {
        eprintln!("Release probe requires explicit isolated config");
        std::process::exit(1);
    }
    let mut builder = tauri::Builder::default();
    #[cfg(all(feature = "release-probe", not(debug_assertions)))]
    {
        builder = builder.on_page_load(|webview, payload| {
        if payload.event()==tauri::webview::PageLoadEvent::Finished && webview.label()=="trainer" {
            let _=webview.eval("window.__TAURI_INTERNALS__.invoke('smoke_result',{}).then(()=>{location.href='trainer-release-probe://unexpected'}).catch(error=>{location.href=String(error).includes('not found')?'trainer-release-probe://not-found':String(error).includes('not allowed')?'trainer-release-probe://permission-refused':'trainer-release-probe://unexpected'})");
        }
    });
    }
    #[cfg(target_os = "macos")]
    if isolated {
        builder = builder.activate_ignoring_other_apps(false);
    }
    if !isolated {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            // Never consume second-instance arguments as configuration consent.
            let window = app
                .get_webview_window("trainer")
                .or_else(|| app.get_webview_window("setup"));
            if let Some(window) = window {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .manage(Runtime::default());
    #[cfg(any(debug_assertions, not(feature = "release-probe")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        setup_status,
        read_onboarding,
        finish_onboarding,
        cancel_onboarding,
        read_settings,
        save_settings,
        choose_path,
        start_auth,
        auth_status,
        submit_mfa,
        cancel_auth,
        adopt_provider_settings,
        read_memory_status,
        dev_bridge::smoke_result
    ]);
    #[cfg(all(not(debug_assertions), feature = "release-probe"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        setup_status,
        read_onboarding,
        finish_onboarding,
        cancel_onboarding,
        read_settings,
        save_settings,
        choose_path,
        start_auth,
        auth_status,
        submit_mfa,
        cancel_auth,
        adopt_provider_settings,
        read_memory_status
    ]);
    let app = builder.on_window_event(|window, event| {
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
        .setup(move |app| {
            #[cfg(any(debug_assertions, feature = "release-probe"))]
            if let Some(config) = smoke {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                #[cfg(debug_assertions)]
                dev_bridge::start(app.handle(), config.clone().into())?;
                app.manage(config);
            }
            if let Some(run) = ordinary {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                #[cfg(not(feature = "release-probe"))]
                dev_bridge::start(app.handle(), dev_bridge::Config {
                    run_id: run.descriptor.run_id.clone(), token: run.descriptor.capability.clone(), root: run.descriptor.root.clone(),
                    source: run.descriptor.source_fingerprint.clone(), port: run.descriptor.control_port, ordinary: Some(run.clone()),
                })?;
                app.manage(run.clone());
                WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                    .title("Garmin Trainer — isolated Settings").inner_size(900.0, 820.0)
                    .visible(false).focused(false).incognito(true).data_directory(run.descriptor.root.join("setup-profile"))
                    .on_navigation(|url| (url.scheme() == "tauri" && url.host_str() == Some("localhost")) || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost")))
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny).build()?;
            }
            let settings = settings_path(app.handle()).map_err(std::io::Error::other)?;
            let root = if let Some(run) = app.try_state::<std::sync::Arc<isolated_run::Admission>>() {
                run.descriptor.root.join("app-data")
            } else { app.path().app_data_dir()?.join("private") };
            let state = onboarding::State::new(&settings, root);
            let launch_saved = !state.eligible;
            *app.state::<Runtime>().onboarding_id.lock().map_err(|_| std::io::Error::other("Setup identity unavailable"))? = state.id.clone();
            *app.state::<Runtime>().onboarding.lock().map_err(|_| std::io::Error::other("Setup state unavailable"))? = Some(state);
            let app_menu = tauri::menu::SubmenuBuilder::new(app, "Garmin Trainer")
                .text("configuration", "Settings…").separator().quit().build()?;
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
                    if launch_saved && path.exists() {
                        match launch(&handle) {
                            Ok(message) => status(&handle, &message),
                            Err(message) => {
                                status(&handle, message);
                                if handle.try_state::<std::sync::Arc<isolated_run::Admission>>().is_some() { stop_runtime(&handle); handle.exit(1); }
                            }
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
        .build(context)
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
