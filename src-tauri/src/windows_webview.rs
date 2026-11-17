//! Main-thread COM callbacks for this Tauri-owned WebView2 only. No screen,
//! debugger port, OS input or caller-authored script is exposed.
use std::{sync::mpsc, time::Duration};
use tauri::WebviewWindow;
use webview2_com::{
    CapturePreviewCompletedHandler, ExecuteScriptCompletedHandler,
    Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::HGLOBAL,
        System::Com::{
            IStream, StructuredStorage::CreateStreamOnHGlobal, STATFLAG_NONAME, STATSTG,
            STREAM_SEEK_SET,
        },
    },
};

fn stream_png(stream: &IStream) -> windows::core::Result<Vec<u8>> {
    // SAFETY: callback owns a live memory stream, on its COM apartment. Never
    // return the stream across threads. Bound before allocating or reading.
    unsafe {
        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME)?;
        if !(45..=4 * 1024 * 1024).contains(&stat.cbSize) {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x8007000Du32 as i32,
            )));
        }
        stream.Seek(0, STREAM_SEEK_SET, None)?;
        let mut bytes = vec![0; stat.cbSize as usize];
        let mut read = 0;
        stream
            .Read(
                bytes.as_mut_ptr().cast(),
                bytes.len() as u32,
                Some(&mut read),
            )
            .ok()?;
        if read as usize != bytes.len() {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x8007000Du32 as i32,
            )));
        }
        Ok(bytes)
    }
}

fn diagnostic_bytes(text: &str) -> Result<Vec<u8>, String> {
    if text.len() > 2048 {
        return Err("Renderer diagnostic bound".to_owned());
    }
    let decoded: String =
        serde_json::from_str(text).map_err(|_| "Renderer diagnostic encoding".to_owned())?;
    if decoded.len() > 512 {
        return Err("Renderer diagnostic bound".to_owned());
    }
    Ok(decoded.into_bytes())
}

pub fn png(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            let failure = tx.clone();
            // SAFETY: Tauri invokes on its main thread; controller, stream and
            // completion remain in that apartment until completion. Receiver expiry
            // discards late bytes and cannot publish a stale capture.
            let queued = unsafe {
                (|| -> windows::core::Result<()> {
                    let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
                    let captured = stream.clone();
                    let completion =
                        CapturePreviewCompletedHandler::create(Box::new(move |status| {
                            let result = status
                                .and_then(|_| stream_png(&captured))
                                .map_err(|_| "Own WebView2 PNG capture failed".to_owned());
                            let _ = tx.try_send(result);
                            Ok(())
                        }));
                    webview.controller().CoreWebView2()?.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &completion,
                    )
                })()
            };
            if queued.is_err() {
                let _ = failure.try_send(Err("Own WebView2 capture unavailable".to_owned()));
            }
        })
        .map_err(|_| "Own WebView2 unavailable")?;
    rx.recv_timeout(Duration::from_secs(4))
        .map_err(|_| "Capture deadline".to_owned())?
}

pub fn diagnostic(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            let failure = tx.clone();
            let script: Vec<u16> = crate::dev_bridge::DIAGNOSTIC
                .encode_utf16()
                .chain(Some(0))
                .collect();
            // SAFETY: fixed native script only. WebView2 copies script before this
            // call returns; its callback supplies JSON-encoded UTF-16 text, converted
            // by the reviewed callback owner while live. No raw text leaves native.
            let queued = unsafe {
                (|| -> windows::core::Result<()> {
                    let completion =
                        ExecuteScriptCompletedHandler::create(Box::new(move |status, text| {
                            let result = status
                                .map_err(|_| "Renderer diagnostic failed".to_owned())
                                .and_then(|_| diagnostic_bytes(&text));
                            let _ = tx.try_send(result);
                            Ok(())
                        }));
                    webview
                        .controller()
                        .CoreWebView2()?
                        .ExecuteScript(PCWSTR(script.as_ptr()), &completion)
                })()
            };
            if queued.is_err() {
                let _ = failure.try_send(Err("Renderer diagnostic unavailable".to_owned()));
            }
        })
        .map_err(|_| "Own WebView2 unavailable")?;
    rx.recv_timeout(Duration::from_secs(1))
        .map_err(|_| "Renderer diagnostic deadline".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_encoding_is_bounded_and_never_treats_null_or_objects_as_strings() {
        assert_eq!(diagnostic_bytes("\"{}\"").unwrap(), b"{}");
        for text in ["null", "{}", "true", "\"unterminated"] {
            assert!(diagnostic_bytes(text).is_err());
        }
        assert!(diagnostic_bytes(&serde_json::to_string(&"x".repeat(513)).unwrap()).is_err());
        assert!(diagnostic_bytes(&"x".repeat(2049)).is_err());
    }
    #[test]
    fn memory_stream_is_exact_and_bounded_before_allocation() {
        // Actual COM memory stream, not a renderer/capture-success claim.
        unsafe {
            let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true).unwrap();
            assert!(stream_png(&stream).is_err());
            let bytes = vec![42u8; 45];
            stream
                .Write(bytes.as_ptr().cast(), bytes.len() as u32, None)
                .ok()
                .unwrap();
            assert_eq!(stream_png(&stream).unwrap(), bytes);
            stream.SetSize(4 * 1024 * 1024 + 1).unwrap();
            assert!(stream_png(&stream).is_err());
        }
    }
}
