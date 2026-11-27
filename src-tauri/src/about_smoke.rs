//! Closed ordinary-only About proof; browser actions require an explicitly presented app.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::mpsc, time::Duration};
use tauri::Manager;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Open,
    Observe,
    Capture,
    Close,
    Escape,
    Repository,
    Licence,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observation {
    ready: bool,
    metadata_matches: bool,
    close_focused: bool,
    links_match: bool,
    link_opened: bool,
}

#[cfg(any(target_os = "macos", test))]
fn browser_allowed(action: &Action, activation_policy: isize) -> bool {
    !matches!(action, Action::Repository | Action::Licence) || activation_policy == 0
}

#[cfg(target_os = "macos")]
fn evaluate(window: &tauri::WebviewWindow, action: &Action) -> Result<Observation, String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    let expected = serde_json::to_string(&crate::about::bundle_metadata(window.app_handle())?)
        .map_err(|_| "Metadata encoding")?;
    let links = serde_json::to_string(&json!({
        "repository": crate::system_open::project_url("repository").map_err(|_| "Repository unavailable")?,
        "licence": crate::system_open::project_url("licence").map_err(|_| "Licence unavailable")?,
    })).map_err(|_| "Links encoding")?;
    let activates_browser = matches!(action, Action::Repository | Action::Licence);
    let mutation = match action {
        Action::Close => "document.getElementById('close').click();",
        Action::Escape => {
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));"
        }
        Action::Repository => "document.querySelector('[data-destination=repository]').click();",
        Action::Licence => "document.querySelector('[data-destination=licence]').click();",
        _ => "",
    };
    let script = std::ffi::CString::new(format!(
        "(()=>{{const expected={expected},links={links};const ready=!!document.getElementById('close');if(!ready)return JSON.stringify({{ready:false,metadataMatches:false,closeFocused:false,linksMatch:false,linkOpened:false}});const metadataMatches=expected.build!=='Unavailable'&&document.getElementById('app-name').textContent===expected.name&&document.getElementById('version').textContent===expected.version&&document.getElementById('build').textContent===expected.build;const closeFocused=document.activeElement.id==='close';const linksMatch=['repository','licence'].every(key=>document.querySelector('[data-destination='+key+']').href===links[key]);const linkOpened=document.getElementById('status').textContent==='Opened in your browser.';{mutation}return JSON.stringify({{ready,metadataMatches,closeFocused,linksMatch,linkOpened}});}})()"
    )).map_err(|_| "Script encoding")?;
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            // SAFETY: AppKit policy is read on the WebView's main thread.
            // Only the existing operator-authorized presentNaming route makes
            // an isolated ordinary process Regular (0); quiet runs are Accessory.
            let policy = crate::about::activation_policy();
            if activates_browser && !browser_allowed(&Action::Repository, policy) {
                let _ = tx.try_send(Err(
                    "Browser activation requires an operator-presented app".into()
                ));
                return;
            }
            let completion =
                block2::RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                    // SAFETY: fixed script returns only the bounded closed boolean DTO.
                    let value = unsafe {
                        if !error.is_null() || result.is_null() {
                            Err("About evaluation unavailable".into())
                        } else {
                            let bytes: *const std::ffi::c_char = msg_send![result, UTF8String];
                            if bytes.is_null() {
                                Err("About result unavailable".into())
                            } else {
                                let bytes = std::ffi::CStr::from_ptr(bytes).to_bytes();
                                if bytes.len() > 512 {
                                    Err("About result bound".into())
                                } else {
                                    serde_json::from_slice::<Observation>(bytes)
                                        .map_err(|_| "About result schema".into())
                                }
                            }
                        }
                    };
                    let _ = tx.try_send(value);
                });
            // SAFETY: admitted local WKWebView on its native main thread.
            unsafe {
                let view = webview.inner().cast::<AnyObject>();
                let text: *mut AnyObject =
                    msg_send![class!(NSString), stringWithUTF8String:script.as_ptr()];
                let _: () =
                    msg_send![view, evaluateJavaScript:text, completionHandler:&*completion];
            }
        })
        .map_err(|_| "About WebView unavailable")?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "About deadline: effect unknown; no mutation retry")?
}
#[cfg(not(target_os = "macos"))]
fn evaluate(_: &tauri::WebviewWindow, _: &Action) -> Result<Observation, String> {
    Err("macOS required".into())
}

pub fn execute(app: &tauri::AppHandle, action: Action, request: &str) -> Result<Value, String> {
    let run = app
        .try_state::<std::sync::Arc<crate::isolated_run::Admission>>()
        .ok_or("Ordinary admission required")?;
    run.verify()?;
    if matches!(action, Action::Open) {
        let has_entry = app
            .menu()
            .and_then(|menu| menu.items().ok())
            .map(|items| {
                items.iter().any(|item| {
                    let Some(submenu) = item.as_submenu() else {
                        return false;
                    };
                    let about = submenu
                        .get("about")
                        .and_then(|item| item.as_menuitem().and_then(|item| item.text().ok()));
                    let settings = submenu
                        .get("configuration")
                        .and_then(|item| item.as_menuitem().and_then(|item| item.text().ok()));
                    let quit = submenu
                        .items()
                        .map(|items| {
                            items.iter().any(|item| {
                                item.as_predefined_menuitem()
                                    .and_then(|item| item.text().ok())
                                    .as_deref()
                                    == Some("Quit")
                            })
                        })
                        .unwrap_or(false);
                    about.as_deref() == Some("About")
                        && settings.as_deref() == Some("Settings…")
                        && quit
                })
            })
            .unwrap_or(false);
        if !has_entry {
            return Err("About app-menu entry missing".into());
        }
        let (tx, rx) = mpsc::sync_channel(1);
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let _ = tx.send(crate::about::show(&handle).is_ok());
        })
        .map_err(|_| "About dispatch unavailable")?;
        return match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(true) => Ok(json!({"ok":true})),
            _ => Err("About open incomplete; effect unknown".into()),
        };
    }
    let Some(window) = app.get_webview_window("about") else {
        return if matches!(action, Action::Observe) {
            Ok(json!({"ok":true,"visible":false,"ready":false}))
        } else {
            Err("About window unavailable".into())
        };
    };
    // The manager can briefly retain a handle while native destruction settles.
    // Read-only observation reports unknown as still present, never as closed.
    let pending = || Ok(json!({"ok":true,"visible":true,"ready":false,"unavailable":true}));
    let url = match window.url() {
        Ok(url) => url,
        Err(_) if matches!(action, Action::Observe) => return pending(),
        Err(_) => return Err("About URL unavailable".into()),
    };
    if !crate::about::document(&url) {
        return if matches!(action, Action::Observe) {
            pending()
        } else {
            Err("Wrong About document".into())
        };
    }
    // Snapshot before dispatch: Close/Escape may destroy the native window
    // before the WebKit completion returns. Later Observe proves settlement.
    let visible = match window.is_visible() {
        Ok(visible) => visible,
        Err(_) if matches!(action, Action::Observe) => return pending(),
        Err(_) => return Err("About visibility unavailable".into()),
    };
    let observation = match evaluate(&window, &action) {
        Ok(observation) => observation,
        Err(_) if matches!(action, Action::Observe) => return pending(),
        Err(error) => return Err(error),
    };
    let ready = observation.ready && observation.metadata_matches && observation.links_match;
    let mut result = serde_json::to_value(observation).map_err(|_| "Observation encoding")?;
    result["ok"] = json!(true);
    result["visible"] = json!(visible);
    result["ready"] = json!(ready);
    if matches!(action, Action::Capture) {
        if !ready {
            return Err("About metadata not rendered".into());
        }
        let bytes = crate::dev_bridge::capture::png(&window)?;
        result["capture"] = json!(crate::dev_bridge::capture::publish(
            &run.descriptor.root.join("screenshots"),
            request,
            &bytes
        )?);
        result["boundary"] = json!("public local About WebView; no OS chrome or trusted input");
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quiet_or_unknown_policy_never_activates_the_browser() {
        for action in [Action::Repository, Action::Licence] {
            assert!(browser_allowed(&action, 0));
            assert!(!browser_allowed(&action, 1));
            assert!(!browser_allowed(&action, 2));
            assert!(!browser_allowed(&action, -1));
        }
        assert!(browser_allowed(&Action::Observe, 1));
    }
    #[test]
    fn closed_observation_rejects_text_and_extra_fields() {
        assert!(serde_json::from_value::<Observation>(
            json!({"ready":true,"metadataMatches":true,"closeFocused":true,"linksMatch":true,"linkOpened":false})
        )
        .is_ok());
        assert!(serde_json::from_value::<Observation>(json!({"ready":true,"metadataMatches":true,"closeFocused":true,"linksMatch":true,"linkOpened":false,"private":"secret"})).is_err());
        assert!(serde_json::from_value::<Observation>(
            json!({"ready":"text","metadataMatches":true,"closeFocused":true,"linksMatch":true,"linkOpened":false})
        )
        .is_err());
    }
}
