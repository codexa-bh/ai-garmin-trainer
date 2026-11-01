//! Fixed keys delivered only to this admitted non-key WKWebView. Never post OS events.
#[cfg(target_os = "macos")]
pub fn disclosure_key(window: &tauri::WebviewWindow, key: &str) -> Result<(), String> {
    use objc2::{
        class, msg_send,
        runtime::{AnyObject, Bool},
        Encode, Encoding,
    };
    use std::{sync::mpsc, time::Duration};
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: f64,
        y: f64,
    }
    // SAFETY: AppKit's NSPoint is CGPoint, two CGFloat doubles on supported ARM64.
    unsafe impl Encode for Point {
        const ENCODING: Encoding =
            Encoding::Struct("CGPoint", &[Encoding::Double, Encoding::Double]);
    }
    let (characters, code) = match key {
        "Enter" => (c"\r", 36u16),
        "Space" => (c" ", 49u16),
        _ => return Err("Unsupported disclosure key".into()),
    };
    let (tx, rx) = mpsc::sync_channel(1);
    window.with_webview(move |webview| {
        // SAFETY: Tauri queues on its owned WebView's main thread. NSEvent is sent
        // directly to that responder, not NSApp/event queues/CGEventPost/foreign windows.
        let result = unsafe {
            let view = webview.inner().cast::<AnyObject>();
            let native: *mut AnyObject = msg_send![view, window];
            let key_window: Bool = msg_send![native, isKeyWindow];
            if native.is_null() || key_window.as_bool() {
                Err("Owned window unavailable or unexpectedly key; no input dispatched".into())
            } else {
                let number: isize = msg_send![native, windowNumber];
                let text: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String:characters.as_ptr()];
                for kind in [10usize, 11usize] {
                    let event: *mut AnyObject = msg_send![class!(NSEvent),
                        keyEventWithType:kind, location:Point{x:0.0,y:0.0}, modifierFlags:0usize,
                        timestamp:0.0f64, windowNumber:number, context:std::ptr::null::<AnyObject>(),
                        characters:text, charactersIgnoringModifiers:text, isARepeat:Bool::NO, keyCode:code];
                    if kind == 10 { let _: () = msg_send![view, keyDown:event]; }
                    else { let _: () = msg_send![view, keyUp:event]; }
                }
                Ok(())
            }
        };
        let _ = tx.try_send(result);
    }).map_err(|_| "Own WebView unavailable")?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Local key deadline: effect unknown")?
}
#[cfg(not(target_os = "macos"))]
pub fn disclosure_key(_window: &tauri::WebviewWindow, _key: &str) -> Result<(), String> {
    Err("macOS local key dispatch required".into())
}
