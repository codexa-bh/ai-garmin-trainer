//! Closed keyless Settings evidence for an already admitted debug run only.
//! Native WebKit completion, not a new renderer IPC/result grant or auth bridge.
use crate::smoke_config::Config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Open,
    Observe,
    Connect,
    Later,
    Save,
    Cancel,
    Capture,
    CaptureWide,
    CaptureNarrow,
    CaptureIntro,
    Catalog,
    CatalogEmpty,
    CaptureCatalog,
    CaptureCatalogNarrow,
    Close,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Failure {
    None,
    NotReady,
    CatalogState,
    CatalogHidden,
    CatalogText,
    PrivacyMask,
    Viewport,
    Action,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    ok: bool,
    ready: bool,
    form_visible: bool,
    manual_controls_absent: bool,
    not_connected: bool,
    saved_for_next_launch: bool,
    catalog_without_defaults: bool,
    synthetic_catalog: bool,
    empty_catalog: bool,
    failure: Failure,
}
struct Document {
    loaded: Arc<AtomicBool>,
}
fn app_document(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && matches!(url.path(), "" | "/" | "/index.html")
        && url.query().is_none()
        && url.fragment().is_none()
}
fn local(window: &WebviewWindow) -> bool {
    window.label() == "setup"
        && window
            .app_handle()
            .try_state::<Document>()
            .map(|state| state.loaded.load(Ordering::SeqCst))
            .unwrap_or(false)
}
#[cfg(target_os = "macos")]
fn evaluate(window: &WebviewWindow, action: &Action) -> Result<Observation, String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    if !local(window) {
        return Err("Wrong isolated Settings document".into());
    }
    let (tx, rx) = mpsc::sync_channel(1);
    let script = format!("JSON.stringify(window.__trainerSetupSmoke ? window.__trainerSetupSmoke({}) : {{ok:true,ready:false,formVisible:false,manualControlsAbsent:false,notConnected:false,savedForNextLaunch:false,catalogWithoutDefaults:false,syntheticCatalog:false,emptyCatalog:false,failure:'none'}})", serde_json::to_string(action).map_err(|_| "Action encoding")?);
    let script = std::ffi::CString::new(script).map_err(|_| "Action encoding")?;
    window
        .with_webview(move |webview| {
            let completion =
                block2::RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                    // SAFETY: fixed native script returns a bounded JSON NSString of booleans.
                    // No caller-provided code, selector, value or private text is evaluated/read back.
                    let value = unsafe {
                        if !error.is_null() || result.is_null() {
                            Err("Settings evaluation failed".into())
                        } else {
                            let bytes: *const std::ffi::c_char = msg_send![result, UTF8String];
                            if bytes.is_null() {
                                Err("Settings result missing".into())
                            } else {
                                let bytes = std::ffi::CStr::from_ptr(bytes).to_bytes();
                                if bytes.len() > 1024 {
                                    Err("Settings result bound".into())
                                } else {
                                    serde_json::from_slice::<Observation>(bytes)
                                        .map_err(|_| "Settings result schema".into())
                                }
                            }
                        }
                    };
                    let _ = tx.try_send(value);
                });
            // SAFETY: Tauri's own local WKWebView on the main thread; no screen/input API.
            unsafe {
                let view = webview.inner().cast::<AnyObject>();
                let text: *mut AnyObject =
                    msg_send![class!(NSString), stringWithUTF8String:script.as_ptr()];
                let _: () =
                    msg_send![view, evaluateJavaScript:text, completionHandler:&*completion];
            }
        })
        .map_err(|_| "Settings WebView unavailable")?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Settings deadline: effect unknown; no mutation retry")?
}
#[cfg(not(target_os = "macos"))]
fn evaluate(_window: &WebviewWindow, _action: &Action) -> Result<Observation, String> {
    Err("macOS required".into())
}

pub fn execute(app: &tauri::AppHandle, config: &Config, action: Action) -> Result<Value, String> {
    let admitted = app.try_state::<Config>().ok_or("No admitted debug run")?;
    if admitted.run_id != config.run_id || admitted.root != config.root {
        return Err("Wrong debug run".into());
    }
    if matches!(action, Action::Open) {
        config.validate()?;
        if let Some(window) = app.get_webview_window("setup") {
            if !local(&window) {
                return Err("Foreign Settings window".into());
            }
            window.show().map_err(|_| "Settings unavailable")?;
        } else {
            let loaded = Arc::new(AtomicBool::new(false));
            app.manage(Document {
                loaded: loaded.clone(),
            });
            let navigating = loaded.clone();
            WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                .title("Garmin Trainer — isolated debug Settings")
                .inner_size(900.0, 820.0)
                .focused(false)
                .incognito(true)
                .data_directory(config.root.join("profile"))
                .initialization_script(include_str!("../debug/setup-smoke.js"))
                .on_navigation(move |url| {
                    navigating.store(false, Ordering::SeqCst);
                    app_document(url)
                })
                .on_page_load(move |_, payload| {
                    loaded.store(
                        payload.event() == tauri::webview::PageLoadEvent::Finished
                            && app_document(payload.url()),
                        Ordering::SeqCst,
                    );
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()
                .map_err(|_| "Isolated Settings creation refused")?;
        }
        return Ok(json!({"ok":true}));
    }
    let window = app
        .get_webview_window("setup")
        .ok_or("Settings unavailable")?;
    if !local(&window) {
        if matches!(action, Action::Observe) {
            return Ok(json!({"ok":true,"ready":false}));
        }
        return Err("Foreign or not-yet-loaded Settings document".into());
    }
    if matches!(action, Action::Close) {
        window.close().map_err(|_| "Settings close refused")?;
        return Ok(json!({"ok":true}));
    }
    if matches!(action, Action::Save) {
        config.validate()?;
    }
    if matches!(
        action,
        Action::Capture
            | Action::CaptureWide
            | Action::CaptureNarrow
            | Action::CaptureIntro
            | Action::CaptureCatalog
            | Action::CaptureCatalogNarrow
    ) {
        let boundary = if matches!(
            action,
            Action::CaptureCatalog | Action::CaptureCatalogNarrow
        ) {
            "sanitized actual fixed synthetic catalog subtree; debug wide/narrow, repositioned not full-window or trusted input"
        } else if matches!(action, Action::CaptureIntro) {
            "geometry-preserving masked actual static Settings introduction; debug only, not ordinary or trusted input"
        } else {
            "geometry-preserving masked consolidated Garmin section at fixed debug viewport; scrolled, inputs hidden, not full-window, ordinary or trusted input"
        };
        let original_size = window
            .inner_size()
            .map_err(|_| "Settings viewport unavailable")?;
        if matches!(
            action,
            Action::CaptureWide
                | Action::CaptureNarrow
                | Action::CaptureCatalog
                | Action::CaptureCatalogNarrow
        ) {
            let catalog = matches!(
                action,
                Action::CaptureCatalog | Action::CaptureCatalogNarrow
            );
            let width = if matches!(action, Action::CaptureNarrow | Action::CaptureCatalogNarrow) {
                420.0
            } else if catalog {
                900.0
            } else {
                1000.0
            };
            // Include the real single-row form and visible compatibility notice;
            // this is a bounded subtree capture, not a normal-window fit claim.
            let height = if catalog { 1200.0 } else { 1000.0 };
            window
                .set_size(tauri::LogicalSize::new(width, height))
                .map_err(|_| "Settings viewport refused")?;
            std::thread::sleep(Duration::from_millis(150));
        }
        let result = (|| {
            let prepared = evaluate(&window, &action)?;
            if !prepared.ok {
                return Err(format!(
                    "Settings sanitizer refused: {:?}",
                    prepared.failure
                ));
            }
            std::thread::sleep(Duration::from_millis(150));
            let bytes = crate::dev_bridge::capture::png(&window)?;
            let path = crate::dev_bridge::capture::publish(
                &config.root.join("screenshots"),
                &uuid::Uuid::new_v4().to_string(),
                &bytes,
            )?;
            Ok(json!({"ok":true,"capture":path,"boundary":boundary}))
        })();
        let _ =
            window.eval("window.__trainerSetupSmokeRestore && window.__trainerSetupSmokeRestore()");
        window
            .set_size(original_size)
            .map_err(|_| "Settings viewport restoration refused")?;
        return result;
    }
    let mut value = serde_json::to_value(evaluate(&window, &action)?)
        .map_err(|_| "Settings result encoding")?;
    value["privateActionsDenied"] = json!(crate::private_setup_only(&window).is_err());
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_fixed_local_entry_routes_are_admitted() {
        for text in [
            "tauri://localhost",
            "tauri://localhost/",
            "tauri://localhost/index.html",
        ] {
            assert!(app_document(&text.parse().unwrap()));
        }
        for text in [
            "about:blank",
            "https://localhost/index.html",
            "tauri://foreign/index.html",
            "tauri://localhost/private",
            "tauri://localhost/?input=private",
            "tauri://localhost/#private",
        ] {
            assert!(!app_document(&text.parse().unwrap()));
        }
    }
    #[test]
    fn actions_and_observations_exclude_private_controls_and_text() {
        for name in [
            "catalog",
            "catalogEmpty",
            "captureCatalog",
            "captureCatalogNarrow",
        ] {
            let action: Action = serde_json::from_value(json!(name)).unwrap();
            assert_eq!(serde_json::to_value(action).unwrap(), json!(name));
            assert!(
                serde_json::from_value::<Action>(json!({"action":name,"value":"private"})).is_err()
            );
        }
        let observed = json!({"ok":true,"ready":true,"formVisible":false,"manualControlsAbsent":true,"notConnected":true,"savedForNextLaunch":false,"catalogWithoutDefaults":true,"syntheticCatalog":true,"emptyCatalog":false,"failure":"none"});
        assert!(serde_json::from_value::<Observation>(observed.clone()).is_ok());
        let mut extra = observed.clone();
        extra["modelId"] = json!("private");
        assert!(serde_json::from_value::<Observation>(extra).is_err());
        let mut text = observed;
        text["syntheticCatalog"] = json!("private");
        assert!(serde_json::from_value::<Observation>(text).is_err());
        assert!(matches!(
            serde_json::from_value::<Action>(json!("captureIntro")).unwrap(),
            Action::CaptureIntro
        ));
        for text in ["captureWide", "captureNarrow"] {
            assert!(serde_json::from_value::<Action>(json!(text)).is_ok());
        }
        for value in [
            json!({"action":"captureWide","width":500}),
            json!({"action":"captureIntro","selector":"body"}),
            json!("captureSecret"),
            json!("capture-intro"),
        ] {
            assert!(serde_json::from_value::<Action>(value).is_err());
        }
        for action in [
            "auth", "email", "password", "mfa", "picker", "finish", "eval", "input",
        ] {
            assert!(serde_json::from_value::<Action>(json!(action)).is_err());
        }
        assert!(serde_json::from_value::<Observation>(json!({"ok":true,"ready":true,"formVisible":true,"manualControlsAbsent":true,"notConnected":true,"savedForNextLaunch":false,"password":"secret"})).is_err());
    }
}
