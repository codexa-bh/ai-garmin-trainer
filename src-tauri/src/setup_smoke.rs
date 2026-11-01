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
    saved_for_next_launch: bool,
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
    let script = format!("JSON.stringify(window.__trainerSetupSmoke ? window.__trainerSetupSmoke({}) : {{ok:true,ready:false,formVisible:false,manualControlsAbsent:false,notConnected:false,savedForNextLaunch:false}})", serde_json::to_string(action).map_err(|_| "Action encoding")?);
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
    if matches!(action, Action::Capture) {
        let result = (|| {
            let prepared = evaluate(&window, &action)?;
            if !prepared.ok {
                return Err("Settings sanitizer refused".into());
            }
            std::thread::sleep(Duration::from_millis(150));
            let bytes = crate::dev_bridge::capture::png(&window)?;
            let path = crate::dev_bridge::capture::publish(
                &config.root.join("screenshots"),
                &uuid::Uuid::new_v4().to_string(),
                &bytes,
            )?;
            Ok(
                json!({"ok":true,"capture":path,"boundary":"sanitized actual Garmin Settings subtrees; not full-window layout or trusted input"}),
            )
        })();
        let _ =
            window.eval("window.__trainerSetupSmokeRestore && window.__trainerSetupSmokeRestore()");
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
        for action in [
            "auth", "email", "password", "mfa", "picker", "finish", "eval", "input",
        ] {
            assert!(serde_json::from_value::<Action>(json!(action)).is_err());
        }
        assert!(serde_json::from_value::<Observation>(json!({"ok":true,"ready":true,"formVisible":true,"manualControlsAbsent":true,"notConnected":true,"savedForNextLaunch":false,"password":"secret"})).is_err());
    }
}
