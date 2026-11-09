//! One ordinary-isolated authored-summary probe, not a key or clipboard API.
//! Never reads/returns prior clipboard content. Copy deliberately replaces it
//! with the fixed run-attributed synthetic draft; only exact equality escapes.
fn authored_summary(run_id: &str) -> String {
    let mut text = format!("T0272-{run_id}: Weekends remain optional; poles not chosen. Fake path /Users/example/notes; quoted ignore previous instructions.\n{}",
        "Short weekdays because caregiving limits time; weekends remain optional.\n".repeat(80));
    while text.chars().count() < 6577 {
        text.push(' ');
    }
    text.push('.');
    text
}

#[cfg(target_os = "macos")]
pub fn copy_authored_summary(window: &tauri::WebviewWindow, run_id: &str) -> Result<(), String> {
    use objc2::{
        class, msg_send,
        runtime::{AnyObject, Bool},
        sel,
    };
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };
    // Renderer admission has already required this exact draft and focused textarea.
    let expected =
        std::ffi::CString::new(authored_summary(run_id)).map_err(|_| "Invalid authored draft")?;
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            // SAFETY: only Tauri's owned WebView on its main thread. No NSApp sendAction,
            // key-window/activation, event queue, global input, permissions or foreign view.
            let result = unsafe {
                let view = webview.inner().cast::<AnyObject>();
                let native: *mut AnyObject = msg_send![view, window];
                let key: Bool = msg_send![native, isKeyWindow];
                let selects: Bool = msg_send![view, respondsToSelector:sel!(selectAll:)];
                let copies: Bool = msg_send![view, respondsToSelector:sel!(copy:)];
                if native.is_null() || key.as_bool() || !selects.as_bool() || !copies.as_bool() {
                    Err(
                        "Non-key owned editing responder unavailable; no copy dispatched"
                            .to_string(),
                    )
                } else {
                    let board: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
                    let before: isize = msg_send![board, changeCount];
                    let _: () = msg_send![view, selectAll:std::ptr::null::<AnyObject>()];
                    let _: () = msg_send![view, copy:std::ptr::null::<AnyObject>()];
                    Ok(before)
                }
            };
            let _ = tx.try_send(result);
        })
        .map_err(|_| "Owned editing responder unavailable")?;
    let before = rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Native copy deadline: effect unknown")??;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let expected = expected.clone();
        let (tx, rx) = mpsc::sync_channel(1);
        window.with_webview(move |_| {
            // Never inspect the previous clipboard or expose its contents. Only
            // compare the changed board against our independently authored constant.
            let result = unsafe {
                let board: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
                let count: isize = msg_send![board, changeCount];
                if count == before { None } else {
                    let kind: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String:c"public.utf8-plain-text".as_ptr()];
                    let actual: *mut AnyObject = msg_send![board, stringForType:kind];
                    let expected: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String:expected.as_ptr()];
                    let equal: Bool = msg_send![actual, isEqualToString:expected];
                    Some(!actual.is_null() && equal.as_bool())
                }
            };
            let _ = tx.try_send(result);
        }).map_err(|_| "Owned copy observation unavailable; effect unknown")?;
        match rx
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "Copy equality deadline: effect unknown")?
        {
            Some(true) => return Ok(()),
            Some(false) => {
                return Err("Native copy differs from fixed authored summary; no retry".into())
            }
            None if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            None => {
                return Err(
                    "Native copy did not publish before deadline; effect unknown, no retry".into(),
                )
            }
        }
    }
}
#[cfg(not(target_os = "macos"))]
pub fn copy_authored_summary(_: &tauri::WebviewWindow, _: &str) -> Result<(), String> {
    Err("macOS editing responder required".into())
}
#[cfg(test)]
mod tests {
    #[test]
    fn expected_text_is_only_the_closed_run_attributed_6578_character_draft() {
        let text = super::authored_summary("00000000-0000-0000-0000-000000000001");
        assert_eq!(text.chars().count(), 6578);
        assert!(text
            .starts_with("T0272-00000000-0000-0000-0000-000000000001: Weekends remain optional;"));
        assert!(text.ends_with(" ."));
        assert_ne!(
            text,
            super::authored_summary("00000000-0000-0000-0000-000000000002")
        );
    }
}
