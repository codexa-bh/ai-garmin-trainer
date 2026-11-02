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
    CapturePrivacy,
    CaptureFooterWide,
    CaptureFooterNarrow,
    LiveCatalog,
    LiveRotate,
    LiveClear,
    LiveEmpty,
    CaptureLive,
    RestartChange,
    RestartRestore,
    RestartDismiss,
    RestartEscape,
    RestartTab,
    CaptureRestartWide,
    CaptureRestartNarrow,
    StopBackend,
    CatalogExercise,
    CatalogEmpty,
    KeysExercise,
    CatalogWide,
    CatalogNarrow,
    CaptureOpenai,
    CaptureDeepseek,
    CaptureOllama,
    CaptureOpenrouter,
    Close,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    ok: bool,
    ready: bool,
    form_visible: bool,
    manual_controls_absent: bool,
    not_connected: bool,
    saved: bool,
    live_applied: bool,
    live_unknown: bool,
    saved_unapplied: bool,
    pending_restart: bool,
    restart_visible: bool,
    restart_focused: bool,
    save_focused: bool,
    edits_cancelled: bool,
    #[serde(default)]
    capture_feedback_rejected: bool,
    #[serde(default)]
    capture_mask_rejected: bool,
    catalog_ready: bool,
    catalog_exercised: bool,
    catalog_without_defaults: bool,
    empty_catalog: bool,
    keys_ready: bool,
    keys_edited: bool,
    keys_rejected: bool,
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
    let script = format!("JSON.stringify(window.__trainerSetupSmoke ? window.__trainerSetupSmoke({}) : {{ok:true,ready:false,formVisible:false,manualControlsAbsent:false,notConnected:false,saved:false,liveApplied:false,liveUnknown:false,savedUnapplied:false,pendingRestart:false,restartVisible:false,restartFocused:false,saveFocused:false,editsCancelled:false,catalogReady:false,catalogExercised:false,catalogWithoutDefaults:false,emptyCatalog:false,keysReady:false,keysEdited:false,keysRejected:false}})", serde_json::to_string(action).map_err(|_| "Action encoding")?);
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
    if matches!(action, Action::StopBackend) {
        config.validate()?;
        let runtime = app.state::<crate::Runtime>();
        runtime
            .service
            .try_lock()
            .map_err(|_| "Owned backend busy")?
            .take();
        return Ok(json!({"ok":true}));
    }
    if matches!(action, Action::Close) {
        window.close().map_err(|_| "Settings close refused")?;
        return Ok(json!({"ok":true}));
    }
    if !matches!(action, Action::Observe) {
        config.validate()?;
    }
    if matches!(action, Action::CatalogWide | Action::CatalogNarrow) {
        let width = if matches!(action, Action::CatalogWide) {
            1000.0
        } else {
            420.0
        };
        window
            .set_size(tauri::LogicalSize::new(width, 850.0))
            .map_err(|_| "Settings resize refused")?;
        // Non-key WKWebViews can return from resize before their first compositor
        // frame. Settle that transition before applying a scrolled privacy mask.
        std::thread::sleep(Duration::from_millis(250));
        return Ok(json!({"ok":true}));
    }
    if matches!(
        action,
        Action::Capture
            | Action::CaptureWide
            | Action::CaptureNarrow
            | Action::CaptureIntro
            | Action::CapturePrivacy
            | Action::CaptureFooterWide
            | Action::CaptureFooterNarrow
            | Action::CaptureOpenai
            | Action::CaptureDeepseek
            | Action::CaptureOllama
            | Action::CaptureOpenrouter
            | Action::CaptureLive
            | Action::CaptureRestartWide
            | Action::CaptureRestartNarrow
    ) {
        let boundary = if matches!(
            action,
            Action::CaptureRestartWide | Action::CaptureRestartNarrow
        ) {
            "geometry-preserving masked actual restart dialog, fixed wide/narrow debug viewport; synthetic DOM/focus only, no settings values or ordinary/trusted input"
        } else if matches!(action, Action::CaptureLive) {
            "masked fixed safe Settings live-application feedback only; no form/keys/paths; debug synthetic DOM evidence"
        } else if matches!(
            action,
            Action::CaptureOpenai
                | Action::CaptureDeepseek
                | Action::CaptureOllama
                | Action::CaptureOpenrouter
        ) {
            "geometry-preserving masked authored synthetic provider section; debug Settings, synthetic DOM input, not ordinary/default/trusted input"
        } else if matches!(
            action,
            Action::CaptureFooterWide | Action::CaptureFooterNarrow
        ) {
            "geometry-preserving masked Settings footer with blanket notice absent; debug only, no form/keys/paths or trusted input"
        } else if matches!(action, Action::CapturePrivacy) {
            "geometry-preserving masked expanded static Garmin disclosure at fixed wide debug viewport; restored after capture, no input values or ordinary/trusted-input certification"
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
                | Action::CaptureFooterWide
                | Action::CaptureFooterNarrow
                | Action::CaptureRestartWide
                | Action::CaptureRestartNarrow
                | Action::CaptureLive
                | Action::CapturePrivacy
        ) {
            let width = if matches!(
                action,
                Action::CaptureNarrow | Action::CaptureFooterNarrow | Action::CaptureRestartNarrow
            ) {
                420.0
            } else {
                1000.0
            };
            window
                .set_size(tauri::LogicalSize::new(width, 1000.0))
                .map_err(|_| "Settings viewport refused")?;
            std::thread::sleep(Duration::from_millis(150));
        }
        let result = (|| {
            let prepared = evaluate(&window, &action)?;
            if !prepared.ok {
                return Err(if prepared.capture_feedback_rejected {
                    "Settings sanitizer refused unreviewed live feedback"
                } else if prepared.capture_mask_rejected {
                    "Settings sanitizer refused ineffective live mask"
                } else {
                    "Settings sanitizer refused"
                }
                .into());
            }
            // Non-key WebKit can snapshot the prior scroll/status frame even
            // after layout reports the new geometry. Keep this finite feedback
            // compositor settle inside the five-second privacy-mask deadline.
            std::thread::sleep(Duration::from_millis(
                if matches!(action, Action::CaptureLive) {
                    600
                } else {
                    150
                },
            ));
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
        assert!(serde_json::from_value::<Action>(json!("catalogEmpty")).is_ok());
        assert!(serde_json::from_value::<Action>(
            json!({"action":"catalogEmpty","value":"private"})
        )
        .is_err());
        let current = json!({"ok":true,"ready":true,"formVisible":false,"manualControlsAbsent":true,"notConnected":true,"saved":false,"liveApplied":false,"liveUnknown":false,"savedUnapplied":false,"pendingRestart":false,"restartVisible":false,"restartFocused":false,"saveFocused":false,"editsCancelled":false,"catalogReady":false,"catalogExercised":true,"catalogWithoutDefaults":true,"emptyCatalog":true,"keysReady":false,"keysEdited":false,"keysRejected":false});
        assert!(serde_json::from_value::<Observation>(current.clone()).is_ok());
        let mut invalid = current;
        invalid["emptyCatalog"] = json!("private");
        assert!(serde_json::from_value::<Observation>(invalid).is_err());
        assert!(matches!(
            serde_json::from_value::<Action>(json!("captureIntro")).unwrap(),
            Action::CaptureIntro
        ));
        for text in [
            "capturePrivacy",
            "captureWide",
            "captureNarrow",
            "captureFooterWide",
            "captureFooterNarrow",
        ] {
            assert!(serde_json::from_value::<Action>(json!(text)).is_ok());
        }
        for value in [
            json!({"action":"captureWide","width":500}),
            json!({"action":"captureIntro","selector":"body"}),
            json!({"action":"capturePrivacy","selector":"body"}),
            json!("captureSecret"),
            json!("capture-intro"),
        ] {
            assert!(serde_json::from_value::<Action>(value).is_err());
        }
        for action in [
            "catalogExercise",
            "keysExercise",
            "catalogWide",
            "catalogNarrow",
            "captureOpenai",
            "captureDeepseek",
            "captureOllama",
            "captureOpenrouter",
            "liveCatalog",
            "liveRotate",
            "liveClear",
            "liveEmpty",
            "captureLive",
            "restartChange",
            "restartRestore",
            "restartDismiss",
            "restartEscape",
            "restartTab",
            "captureRestartWide",
            "captureRestartNarrow",
            "stopBackend",
        ] {
            assert!(serde_json::from_value::<Action>(json!(action)).is_ok());
            assert!(
                serde_json::from_value::<Action>(json!({"action":action,"value":"private"}))
                    .is_err()
            );
        }
        let observation = json!({"ok":true,"ready":true,"formVisible":false,"manualControlsAbsent":true,"notConnected":true,"saved":true,"liveApplied":true,"liveUnknown":false,"savedUnapplied":false,"pendingRestart":false,"restartVisible":false,"restartFocused":false,"saveFocused":false,"editsCancelled":false,"catalogReady":true,"catalogExercised":true,"catalogWithoutDefaults":true,"emptyCatalog":false,"keysReady":false,"keysEdited":false,"keysRejected":false});
        assert!(serde_json::from_value::<Observation>(observation.clone()).is_ok());
        let mut private = observation;
        private["password"] = json!("private-sentinel");
        assert!(serde_json::from_value::<Observation>(private).is_err());
        assert!(serde_json::from_value::<Observation>(json!({"ok":true,"ready":true,"formVisible":false,"manualControlsAbsent":true,"notConnected":true,"savedForNextLaunch":false,"catalogReady":true,"catalogExercised":true})).is_err());
        for action in [
            "auth", "email", "password", "mfa", "picker", "finish", "eval", "input",
        ] {
            assert!(serde_json::from_value::<Action>(json!(action)).is_err());
        }
        assert!(serde_json::from_value::<Observation>(json!({"ok":true,"ready":true,"formVisible":true,"manualControlsAbsent":true,"notConnected":true,"savedForNextLaunch":false,"password":"secret"})).is_err());
    }
}
