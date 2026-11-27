//! Read-only local About surface, independent of Settings and backend state.
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Metadata {
    name: String,
    version: String,
    build: String,
}

fn local(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "about" {
        Ok(())
    } else {
        Err("Local About window only.".into())
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn bundle_metadata() -> Result<Metadata, String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    use std::ffi::CStr;
    // SAFETY: NSBundle owns these autoreleased strings. Copy UTF-8 while the
    // bundle/value is alive; fixed Info.plist keys only, never caller input.
    unsafe fn value(bundle: *mut AnyObject, key: &std::ffi::CStr) -> Result<String, String> {
        let key: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: key.as_ptr()];
        let value: *mut AnyObject = msg_send![bundle, objectForInfoDictionaryKey: key];
        if value.is_null() {
            return Err("App bundle metadata unavailable.".into());
        }
        let text: *const std::ffi::c_char = msg_send![value, UTF8String];
        if text.is_null() {
            return Err("App bundle metadata unavailable.".into());
        }
        CStr::from_ptr(text)
            .to_str()
            .map(str::to_owned)
            .map_err(|_| "App bundle metadata unavailable.".into())
    }
    unsafe {
        let bundle: *mut AnyObject = msg_send![class!(NSBundle), mainBundle];
        Ok(Metadata {
            name: value(bundle, c"CFBundleName")?,
            version: value(bundle, c"CFBundleShortVersionString")?,
            build: value(bundle, c"CFBundleVersion")?,
        })
    }
}
#[cfg(not(target_os = "macos"))]
pub(crate) fn bundle_metadata() -> Result<Metadata, String> {
    Err("About is available on macOS.".into())
}

pub(crate) fn document(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && url.path() == "/about.html"
        && url.query().is_none()
        && url.fragment().is_none()
}

pub fn show(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    let isolated = app
        .try_state::<std::sync::Arc<crate::isolated_run::Admission>>()
        .is_some();
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    let isolated = isolated || app.try_state::<crate::smoke_config::Config>().is_some();
    if let Some(window) = app.get_webview_window("about") {
        window.show()?;
        if !isolated {
            window.set_focus()?;
        }
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "about", WebviewUrl::App("about.html".into()))
        .title("About AI Trainer for Garmin Connect")
        .inner_size(420.0, 330.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(!isolated)
        .incognito(true)
        .on_navigation(document)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()?;
    Ok(())
}

#[tauri::command]
pub fn about_metadata(window: tauri::WebviewWindow) -> Result<Metadata, String> {
    local(&window)?;
    bundle_metadata()
}

#[tauri::command]
pub fn about_link(window: tauri::WebviewWindow, destination: String) -> Result<(), String> {
    local(&window)?;
    // Quiet isolated smoke must never launch/focus the operator's browser.
    let app = window.app_handle();
    if app
        .try_state::<std::sync::Arc<crate::isolated_run::Admission>>()
        .is_some()
    {
        return Err("Browser links require an ordinary interactive session.".into());
    }
    #[cfg(any(debug_assertions, feature = "release-probe"))]
    if app.try_state::<crate::smoke_config::Config>().is_some() {
        return Err("Browser links require an ordinary interactive session.".into());
    }
    system_link(&destination)
}

fn system_link(destination: &str) -> Result<(), String> {
    crate::system_open::project_page(destination)
        .map_err(|_| "Project link could not open in your browser.".into())
}

#[tauri::command]
pub fn about_close(window: tauri::WebviewWindow) -> Result<(), String> {
    local(&window)?;
    window.close().map_err(|_| "About could not close.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn about_document_never_navigates_to_settings_or_remote_content() {
        assert!(document(
            &tauri::Url::parse("tauri://localhost/about.html").unwrap()
        ));
        for value in [
            "tauri://localhost/index.html",
            "https://github.com/eye1/ai-garmin-trainer",
            "tauri://localhost/about.html?input=1",
            "tauri://localhost/about.html#fragment",
            "tauri://other/about.html",
        ] {
            assert!(!document(&tauri::Url::parse(value).unwrap()));
        }
    }
}
