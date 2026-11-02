//! Finite keyless history-setup controls in an explicitly scoped ordinary run.
//! Local WebKit completion only; never a trainer settings/auth grant.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::mpsc, time::Duration};
use tauri::{Manager, WebviewWindow};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Open,
    Observe,
    CreateNew,
    UseExisting,
    Next,
    Finish,
    Save,
    Automatic,
    LegacyLimit,
    Capture,
    Close,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    ok: bool,
    ready: bool,
    form_valid: bool,
    first_run: bool,
    data_step: bool,
    review_step: bool,
    automatic_history: bool,
    legacy_limit: bool,
    saved_for_next_launch: bool,
    save_submitted: bool,
    save_requested: bool,
    history_validation_blocked: bool,
    history_bad_input: bool,
    history_value_missing: bool,
    other_validation_blocked: bool,
    document_visible: bool,
    form_connected: bool,
    save_rejected: bool,
    settings_unavailable: bool,
    command_permission_denied: bool,
    command_arguments_invalid: bool,
    private_controls_absent: bool,
}
pub fn document(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && matches!(url.path(), "" | "/" | "/index.html")
        && url.query().is_none()
        && url.fragment().is_none()
}
#[cfg(target_os = "macos")]
fn evaluate(window: &WebviewWindow, action: &Action) -> Result<Observation, String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    let (tx, rx) = mpsc::sync_channel(1);
    let script = format!("JSON.stringify(window.__trainerHistorySetup ? window.__trainerHistorySetup({}) : {{ok:true,ready:false,formValid:false,firstRun:false,dataStep:false,reviewStep:false,automaticHistory:false,legacyLimit:false,savedForNextLaunch:false,saveSubmitted:false,saveRequested:false,historyValidationBlocked:false,historyBadInput:false,historyValueMissing:false,otherValidationBlocked:false,documentVisible:false,formConnected:false,saveRejected:false,settingsUnavailable:false,commandPermissionDenied:false,commandArgumentsInvalid:false,privateControlsAbsent:false}})", serde_json::to_string(action).map_err(|_| "Action encoding")?);
    let script = std::ffi::CString::new(script).map_err(|_| "Action encoding")?;
    window
        .with_webview(move |webview| {
            let completion =
                block2::RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                    // SAFETY: fixed native script returns a bounded JSON NSString of booleans only.
                    let value = unsafe {
                        if !error.is_null() || result.is_null() {
                            Err("History setup evaluation refused".into())
                        } else {
                            let bytes: *const std::ffi::c_char = msg_send![result, UTF8String];
                            if bytes.is_null() {
                                Err("History setup result missing".into())
                            } else {
                                let bytes = std::ffi::CStr::from_ptr(bytes).to_bytes();
                                if bytes.len() > 1024 {
                                    Err("History setup result bound".into())
                                } else {
                                    serde_json::from_slice::<Observation>(bytes)
                                        .map_err(|_| "History setup result schema".into())
                                }
                            }
                        }
                    };
                    let _ = tx.try_send(value);
                });
            // SAFETY: the admitted app-owned local WKWebView, on its main thread.
            unsafe {
                let view = webview.inner().cast::<AnyObject>();
                let text: *mut AnyObject =
                    msg_send![class!(NSString), stringWithUTF8String:script.as_ptr()];
                let _: () =
                    msg_send![view, evaluateJavaScript:text, completionHandler:&*completion];
            }
        })
        .map_err(|_| "History setup WebView unavailable")?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "History setup deadline: effect unknown; no mutation retry")?
}
#[cfg(not(target_os = "macos"))]
fn evaluate(_: &WebviewWindow, _: &Action) -> Result<Observation, String> {
    Err("macOS required".into())
}

fn pending_document() -> Result<Value, String> {
    let mut value = serde_json::to_value(Observation {
        ok: true,
        ..Default::default()
    })
    .map_err(|_| "Readiness encoding")?;
    value["windowReady"] = json!(false);
    value["windowVisible"] = json!(false);
    value["setupFailure"] = Value::Null;
    Ok(value)
}

pub fn execute(app: &tauri::AppHandle, action: Action) -> Result<Value, String> {
    let run = app
        .try_state::<std::sync::Arc<crate::isolated_run::Admission>>()
        .ok_or("No ordinary admission")?;
    if run.descriptor.history_setup.is_none() {
        return Err("History setup scope required".into());
    }
    run.verify()?;
    let Some(window) = app.get_webview_window("setup") else {
        return if matches!(action, Action::Observe) {
            pending_document()
        } else {
            Err("Owned Settings unavailable".into())
        };
    };
    let url = window.url().map_err(|_| "Settings document unavailable")?;
    if matches!(action, Action::Observe) && url.as_str() == "about:blank" {
        return pending_document();
    }
    if window.label() != "setup" || !document(&url) {
        return Err("Wrong history setup document".into());
    }
    if matches!(action, Action::Open) {
        window.show().map_err(|_| "Settings unavailable")?;
        return Ok(json!({"ok":true}));
    }
    if matches!(action, Action::Close) {
        window.hide().map_err(|_| "Settings hide refused")?;
        return Ok(json!({"ok":true}));
    }
    let visible = window
        .is_visible()
        .map_err(|_| "Settings visibility unavailable")?;
    if !matches!(action, Action::Observe) && !visible {
        return Err("Owned Settings window is not visible; no mutation dispatched".into());
    }
    if matches!(action, Action::CreateNew)
        && !matches!(
            run.descriptor.history_setup,
            Some(crate::isolated_run::HistorySetup::CreateNew)
        )
        || matches!(action, Action::UseExisting)
            && !matches!(
                run.descriptor.history_setup,
                Some(crate::isolated_run::HistorySetup::UseExisting)
            )
    {
        return Err("Wrong first-run selection scope".into());
    }
    if matches!(action, Action::Capture) {
        let result = (|| {
            if !evaluate(&window, &action)?.ok {
                return Err("History setup sanitizer refused".into());
            }
            std::thread::sleep(Duration::from_millis(150));
            let bytes = crate::dev_bridge::capture::png(&window)?;
            let path = crate::dev_bridge::capture::publish(
                &run.descriptor.root.join("screenshots"),
                &uuid::Uuid::new_v4().to_string(),
                &bytes,
            )?;
            Ok(
                json!({"ok":true,"capture":path,"boundary":"geometry-preserving redacted ordinary history setup; synthetic DOM input, private fields hidden"}),
            )
        })();
        let _ = window.eval("window.__trainerHistoryRestore && window.__trainerHistoryRestore()");
        return result;
    }
    let mut value = serde_json::to_value(evaluate(&window, &action)?)
        .map_err(|_| "History setup encoding".to_owned())?;
    // Native-owned compile-time error text only; never renderer/vendor payloads.
    let runtime = app.state::<crate::Runtime>();
    let failure = *runtime
        .setup_failure
        .lock()
        .map_err(|_| "Setup outcome unavailable")?;
    value["setupFailure"] = json!(failure.filter(|message| message.len() <= 512));
    value["windowReady"] = json!(true);
    value["windowVisible"] = json!(visible);
    value["ready"] = json!(value["ready"] == true && visible);
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_readiness_is_not_mutation_or_foreign_document_authority() {
        let pending = pending_document().unwrap();
        assert_eq!(pending["ok"], true);
        assert_eq!(pending["ready"], false);
        assert_eq!(pending["windowReady"], false);
        assert!(pending["setupFailure"].is_null());
        assert!(!document(&"about:blank".parse().unwrap()));
    }
    #[test]
    fn actions_results_and_local_document_are_closed() {
        for action in ["input", "auth", "mfa", "adopt", "picker", "eval"] {
            assert!(serde_json::from_value::<Action>(json!(action)).is_err());
        }
        assert!(document(&"tauri://localhost/index.html".parse().unwrap()));
        for path in [
            "tauri://localhost/private",
            "tauri://localhost/?input=x",
            "https://localhost/",
        ] {
            assert!(!document(&path.parse().unwrap()));
        }
        assert!(
            serde_json::from_value::<Observation>(json!({"ok":true,"private":"copied text"}))
                .is_err()
        );
    }
}
