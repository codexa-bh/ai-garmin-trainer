//! Only this instance's actual WKWebView/WebView2, after an admitted fixed privacy mask.
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::WebviewWindow;
pub fn publish(parent: &Path, id: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    crate::isolated_run::private_directory(parent)?;
    if uuid::Uuid::parse_str(id).is_err()
        || bytes.len() < 45
        || bytes.len() > 4 * 1024 * 1024
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || &bytes[12..16] != b"IHDR"
        || !bytes.ends_with(b"\0\0\0\0IEND\xaeB`\x82")
        || !(1..=4096).contains(&u32::from_be_bytes(bytes[16..20].try_into().unwrap()))
        || !(1..=4096).contains(&u32::from_be_bytes(bytes[20..24].try_into().unwrap()))
    {
        return Err("Invalid bounded PNG".into());
    }
    let path = parent.join(format!("capture-{id}.png"));
    let tmp = parent.join(format!(".capture-{id}.tmp"));
    let mut file =
        crate::private_fs::create_private_file(&tmp).map_err(|_| "Exclusive capture temporary")?;
    // Only an exclusive-open success owns this temporary and permits its cleanup.
    let staged = tmp.clone();
    let result = (move || {
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Complete capture write")?;
        // Close before unlinking: Windows refuses deleting an open file.
        drop(file);
        // Exclusive hard-link publication is atomic and cannot replace an existing destination.
        fs::hard_link(&staged, &path).map_err(|_| "Exclusive atomic capture publication")?;
        fs::remove_file(&staged).map_err(|_| "Capture temporary cleanup")?;
        Ok(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
#[cfg(target_os = "macos")]
pub fn png(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    use objc2::{class, msg_send, runtime::AnyObject};
    use std::{sync::mpsc, time::Duration};
    let (tx, rx) = mpsc::sync_channel(1);
    window.with_webview(move|webview|{
        let completion=block2::RcBlock::new(move|image:*mut AnyObject,error:*mut AnyObject|{
            // SAFETY: WebKit calls on its main thread with live autoreleased objects.
            // No screen/foreign window API or OS input is used.
            let result=unsafe{
                if image.is_null()||!error.is_null(){Err("Own WebView snapshot failed".into())}else{
                    let tiff:*mut AnyObject=msg_send![image,TIFFRepresentation];
                    let bitmap:*mut AnyObject=msg_send![class!(NSBitmapImageRep),imageRepWithData:tiff];
                    let props:*mut AnyObject=msg_send![class!(NSDictionary),dictionary];
                    let data:*mut AnyObject=msg_send![bitmap,representationUsingType:4usize,properties:props];
                    if data.is_null(){Err("PNG unavailable".into())}else{
                        let len:usize=msg_send![data,length];let bytes:*const u8=msg_send![data,bytes];
                        if bytes.is_null()||len==0||len>4*1024*1024{Err("PNG bound".into())}else{Ok(std::slice::from_raw_parts(bytes,len).to_vec())}
                    }
                }
            };let _=tx.try_send(result);
        });
        // SAFETY: Tauri supplies this live owned WKWebView on the main thread.
        // WebKit copies the completion block for its asynchronous snapshot.
        unsafe {
            let view = webview.inner().cast::<AnyObject>();
            // Invalidate/display this owned non-key view before asking WebKit
            // for post-update pixels; layout acknowledgment alone can leave an
            // old scroll/visibility frame. No activation or screen API is used.
            let _: () = msg_send![view, setNeedsDisplay: true];
            let _: () = msg_send![view, displayIfNeeded];
            let configuration: *mut AnyObject = msg_send![class!(WKSnapshotConfiguration), new];
            let _: () = msg_send![configuration, setAfterScreenUpdates: true];
            let _: () = msg_send![view, takeSnapshotWithConfiguration: configuration, completionHandler: &*completion];
            let _: () = msg_send![configuration, release];
        }
    }).map_err(|_|"Own WebView unavailable")?;
    rx.recv_timeout(Duration::from_secs(4))
        .map_err(|_| "Capture deadline")?
}
#[cfg(windows)]
pub fn png(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    crate::windows_webview::png(window)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_fs::testing::symlink;
    #[test]
    fn refuses_invalid_bytes_and_paths() {
        assert!(publish(Path::new("/missing"), "bad", b"not png").is_err());
    }
    #[test]
    fn publication_is_private_atomic_exclusive_and_confined() {
        let parent = crate::private_fs::testing::private_root("capture-test");
        let id = uuid::Uuid::new_v4().to_string();
        // Bounded header/end framing fixture only, not visual screenshot evidence.
        let mut bytes = vec![0; 45];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes[12..16].copy_from_slice(b"IHDR");
        bytes[19] = 1;
        bytes[23] = 1;
        bytes[33..].copy_from_slice(b"\0\0\0\0IEND\xaeB`\x82");
        assert!(publish(&parent, "../escape", &bytes).is_err());
        let mut zero = bytes.clone();
        zero[19] = 0;
        assert!(publish(&parent, &id, &zero).is_err());
        let path = publish(&parent, &id, &bytes).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert!(crate::private_fs::path_meta(&path).unwrap().private_file());
        assert!(publish(&parent, &id, &bytes).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let next = uuid::Uuid::new_v4().to_string();
        let tmp = parent.join(format!(".capture-{next}.tmp"));
        fs::write(&tmp, b"unowned existing temporary").unwrap();
        assert!(publish(&parent, &next, &bytes).is_err());
        assert!(tmp.exists());
        let alias = parent.with_extension("alias");
        symlink(&parent, &alias).unwrap();
        assert!(publish(&alias, &next, &bytes).is_err());
        #[cfg(windows)]
        fs::remove_dir(alias).unwrap();
        #[cfg(unix)]
        fs::remove_file(alias).unwrap();
        fs::remove_file(tmp).unwrap();
        fs::remove_file(path).unwrap();
        fs::remove_dir(parent).unwrap();
    }
}
