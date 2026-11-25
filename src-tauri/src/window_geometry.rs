//! Optional macOS Trainer preference. AppKit outer frames/work areas use logical
//! desktop points (including negative origins), independent of backing scale.
use crate::private_fs as fs;
use objc2::{
    class, msg_send,
    runtime::{AnyObject, Bool},
    Encode, Encoding,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
struct Size {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
struct Rect {
    origin: Point,
    size: Size,
}
// SAFETY: AppKit's NSPoint/NSSize/NSRect are the CoreGraphics double structs
// on supported 64-bit macOS. Values are copied, never retained Objective-C objects.
unsafe impl Encode for Point {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[Encoding::Double, Encoding::Double]);
}
unsafe impl Encode for Size {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[Encoding::Double, Encoding::Double]);
}
unsafe impl Encode for Rect {
    const ENCODING: Encoding = Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]);
}
impl Rect {
    fn valid(self) -> bool {
        [
            self.origin.x,
            self.origin.y,
            self.size.width,
            self.size.height,
        ]
        .iter()
        .all(|v| v.is_finite() && v.abs() <= 100_000.0)
            && self.size.width >= 100.0
            && self.size.height >= 100.0
    }
    fn fit(self, area: Self) -> Self {
        let width = self.size.width.min(area.size.width);
        let height = self.size.height.min(area.size.height);
        Self {
            origin: Point {
                x: self
                    .origin
                    .x
                    .clamp(area.origin.x, area.origin.x + area.size.width - width),
                y: self
                    .origin
                    .y
                    .clamp(area.origin.y, area.origin.y + area.size.height - height),
            },
            size: Size { width, height },
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    display: u32,
    area: Rect,
    frame: Rect,
}
impl Record {
    fn valid(&self) -> bool {
        self.version == 1 && self.area.valid() && self.frame.valid()
    }
}
#[derive(Clone, Copy)]
struct Display {
    id: u32,
    area: Rect,
}
fn restore(saved: Option<&Record>, displays: &[Display], current: usize) -> Option<Record> {
    let saved = saved.filter(|r| r.valid());
    let display = saved
        .and_then(|r| displays.iter().find(|d| d.id == r.display))
        .or_else(|| displays.get(current))
        .or_else(|| displays.first())?;
    let area = display.area;
    if !area.valid() {
        return None;
    }
    let frame = if let Some(saved) = saved {
        // Preserve exact placement on an unchanged display. Changed/missing
        // displays retain the user's offset from its usable lower-left corner.
        Rect {
            origin: Point {
                x: area.origin.x + saved.frame.origin.x - saved.area.origin.x,
                y: area.origin.y + saved.frame.origin.y - saved.area.origin.y,
            },
            size: saved.frame.size,
        }
        .fit(area)
    } else {
        let width = 1280.0_f64.min(area.size.width);
        Rect {
            origin: Point {
                x: area.origin.x + (area.size.width - width) / 2.0,
                y: area.origin.y,
            },
            size: Size {
                width,
                height: area.size.height,
            },
        }
    };
    Some(Record {
        version: 1,
        display: display.id,
        area,
        frame,
    })
}

struct Store {
    path: PathBuf,
    writable: bool,
}
impl Store {
    fn new(settings: &Path) -> (Self, Option<Record>) {
        let path = settings.with_file_name("trainer-window-v1.json");
        let result = Self::read(&path);
        let (writable, record) = match result {
            Ok(record) => (true, record),
            Err(()) => (false, None),
        };
        (Self { path, writable }, record)
    }
    fn read(path: &Path) -> Result<Option<Record>, ()> {
        let dir = fs::walk(path.parent().ok_or(())?, false).map_err(|_| ())?;
        if !fs::meta(&dir).map_err(|_| ())?.private_dir() {
            return Err(());
        }
        let file = match fs::open_at(&dir, path.file_name().ok_or(())?) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(()),
        };
        let meta = fs::meta(&file).map_err(|_| ())?;
        if !meta.private_file() || meta.len > 4096 {
            return Err(());
        }
        let mut bytes = Vec::new();
        file.take(4097).read_to_end(&mut bytes).map_err(|_| ())?;
        let record: Record = serde_json::from_slice(&bytes).map_err(|_| ())?;
        if !record.valid() {
            return Err(());
        }
        Ok(Some(record))
    }
    fn save(&self, record: &Record) -> Result<(), ()> {
        if !self.writable || !record.valid() {
            return Err(());
        }
        let parent = self.path.parent().ok_or(())?;
        let dir = fs::walk(parent, false).map_err(|_| ())?;
        if !fs::meta(&dir).map_err(|_| ())?.private_dir() {
            return Err(());
        }
        let _lock = fs::try_lock(&dir).ok_or(())?;
        let result = (|| {
            // Never adopt malformed, unsupported, shared or linked state that
            // appeared since startup. Replacement is atomic under the pinned parent.
            Self::read(&self.path)?;
            let name = self.path.file_name().ok_or(())?;
            let stage = format!(".trainer-window-{}.tmp", uuid::Uuid::new_v4());
            let mut file = fs::create_at(&dir, stage.as_ref()).map_err(|_| ())?;
            let result = (|| {
                file.write_all(&serde_json::to_vec(record).map_err(|_| ())?)
                    .map_err(|_| ())?;
                file.sync_all().map_err(|_| ())?;
                if !fs::same_object(parent, &dir) {
                    return Err(());
                }
                fs::rename_at(&dir, stage.as_ref(), &file, name, true).map_err(|_| ())?;
                if !fs::sync_dir(&dir) {
                    return Err(());
                }
                Ok(())
            })();
            if result.is_err() {
                let _ = fs::remove_at(&dir, stage.as_ref(), &file);
            }
            result
        })();
        fs::unlock(&dir);
        result
    }
}

struct Tracking {
    store: Store,
    saved: Option<Record>,
    candidate: Option<(Record, Instant)>,
    committed: Option<Record>,
    temporary: bool,
    write_failed: bool,
}
pub struct State(Mutex<Tracking>);
pub fn initialize(app: &tauri::AppHandle, settings: &Path) {
    let (store, saved) = Store::new(settings);
    app.manage(State(Mutex::new(Tracking {
        store,
        saved,
        candidate: None,
        committed: None,
        temporary: false,
        write_failed: false,
    })));
}

// All AppKit access below is on the main thread. Only the owned Trainer is used.
unsafe fn displays() -> Vec<Display> {
    let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
    let count: usize = msg_send![screens, count];
    (0..count)
        .filter_map(|i| {
            let screen: *mut AnyObject = msg_send![screens, objectAtIndex:i];
            let area: Rect = msg_send![screen, visibleFrame];
            let description: *mut AnyObject = msg_send![screen, deviceDescription];
            let key: *mut AnyObject =
                msg_send![class!(NSString), stringWithUTF8String:c"NSScreenNumber".as_ptr()];
            let number: *mut AnyObject = msg_send![description, objectForKey:key];
            let id: u32 = msg_send![number, unsignedIntValue];
            area.valid().then_some(Display { id, area })
        })
        .collect()
}
unsafe fn observe(native: *mut AnyObject, normal_only: bool) -> Option<Record> {
    let minimized: Bool = msg_send![native, isMiniaturized];
    let zoomed: Bool = msg_send![native, isZoomed];
    let style: usize = msg_send![native, styleMask];
    if normal_only && (minimized.as_bool() || zoomed.as_bool() || style & (1 << 14) != 0) {
        return None;
    }
    let frame: Rect = msg_send![native, frame];
    let screen: *mut AnyObject = msg_send![native, screen];
    if screen.is_null() {
        return None;
    }
    let area: Rect = msg_send![screen, visibleFrame];
    let all = displays();
    let display = all.iter().find(|d| d.area == area)?;
    let record = Record {
        version: 1,
        display: display.id,
        area,
        frame,
    };
    record.valid().then_some(record)
}
fn owned(app: &tauri::AppHandle) -> Option<*mut AnyObject> {
    app.get_webview_window("trainer")?
        .ns_window()
        .ok()
        .map(|p| p.cast())
}
/// Called on the main thread, before the hidden window is first shown.
pub fn install(app: &tauri::AppHandle) {
    let Some(native) = owned(app) else {
        return;
    };
    let Some(state) = app.try_state::<State>() else {
        return;
    };
    let Ok(tracking) = state.0.lock() else {
        return;
    };
    // SAFETY: caller runs on AppKit main thread with the live owned NSWindow.
    unsafe {
        let all = displays();
        let screen: *mut AnyObject = msg_send![native, screen];
        let current = if screen.is_null() {
            0
        } else {
            let area: Rect = msg_send![screen, visibleFrame];
            all.iter().position(|d| d.area == area).unwrap_or(0)
        };
        if let Some(record) = restore(tracking.saved.as_ref(), &all, current) {
            let _: () = msg_send![native, setFrame:record.frame, display:Bool::NO];
        }
    }
}
fn sample(tracking: &mut Tracking, record: Option<Record>, now: Instant, flush: bool) {
    if tracking.temporary || tracking.write_failed {
        return;
    }
    let Some(record) = record else {
        // A transition cannot settle an intermediate resize into a preference.
        tracking.candidate = tracking.committed.clone().map(|r| (r, now));
        return;
    };
    if tracking.candidate.as_ref().map(|(r, _)| r) != Some(&record) {
        tracking.candidate = Some((record, now));
    }
    let Some((record, since)) = &tracking.candidate else {
        return;
    };
    if tracking.committed.as_ref() == Some(record)
        || (!flush && now.duration_since(*since) < Duration::from_millis(750))
    {
        return;
    }
    match tracking.store.save(record) {
        Ok(()) => tracking.committed = Some(record.clone()),
        Err(()) => {
            tracking.write_failed = true; // Optional failure: no per-event retry loop.
            eprintln!(
                "desktop: optional Trainer window preference unavailable; existing state preserved"
            );
        }
    }
}
/// Periodic settled sampling, and a final flush on every main-thread exit request.
pub fn tick(app: &tauri::AppHandle, flush: bool) {
    let Some(native) = owned(app) else {
        return;
    };
    let Some(state) = app.try_state::<State>() else {
        return;
    };
    if let Ok(mut tracking) = state.0.lock() {
        // SAFETY: scheduled on main thread; AppKit state cannot change mid-sample.
        sample(
            &mut tracking,
            unsafe { observe(native, true) },
            Instant::now(),
            flush,
        );
    };
}
/// Fixed smoke viewport sizes are presentation overrides, never a user preference.
#[cfg(any(debug_assertions, not(feature = "release-probe")))]
pub fn suspend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<State>() {
        if let Ok(mut tracking) = state.0.lock() {
            tracking.temporary = true;
        }
    }
}
/// Finite admitted ordinary-only observation/arrangement; no caller geometry.
#[cfg(any(debug_assertions, not(feature = "release-probe")))]
pub fn smoke(app: &tauri::AppHandle, arrange: bool) -> Result<serde_json::Value, &'static str> {
    let native = owned(app).ok_or("Owned Trainer unavailable")?;
    let state = app.state::<State>();
    let mut tracking = state.0.lock().map_err(|_| "Geometry state unavailable")?;
    // SAFETY: bridge dispatches on main thread, only to its admitted Trainer.
    unsafe {
        if arrange {
            let current = observe(native, false).ok_or("Normal geometry unavailable")?;
            let frame = Rect {
                origin: Point {
                    x: current.area.origin.x + 40.0,
                    y: current.area.origin.y + 50.0,
                },
                size: Size {
                    width: 900.0,
                    height: 650.0,
                },
            }
            .fit(current.area);
            let _: () = msg_send![native, setFrame:frame, display:Bool::YES];
            tracking.temporary = false;
        }
        let record = observe(native, false).ok_or("Normal geometry unavailable")?;
        Ok(
            serde_json::json!({"ok":true,"frame":record.frame,"workArea":record.area,"display":record.display,"units":"AppKit logical points; lower-left origin","temporary":tracking.temporary}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_fs::testing::*;
    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect {
            origin: Point { x, y },
            size: Size {
                width: w,
                height: h,
            },
        }
    }
    fn display(id: u32, area: Rect) -> Display {
        Display { id, area }
    }
    fn record() -> Record {
        Record {
            version: 1,
            display: 1,
            area: rect(0.0, 30.0, 1440.0, 850.0),
            frame: rect(40.0, 70.0, 900.0, 650.0),
        }
    }
    #[test]
    fn initial_outer_frame_fills_only_usable_height_and_fits_width() {
        let area = rect(0.0, 30.0, 1100.0, 800.0);
        assert_eq!(restore(None, &[display(1, area)], 0).unwrap().frame, area);
        let area = rect(-1920.0, 24.0, 1920.0, 1000.0);
        assert_eq!(
            restore(None, &[display(2, area)], 0).unwrap().frame,
            rect(-1600.0, 24.0, 1280.0, 1000.0)
        );
    }
    #[test]
    fn unchanged_smaller_frame_is_not_recentered() {
        let saved = record();
        assert_eq!(
            restore(Some(&saved), &[display(1, saved.area)], 0).unwrap(),
            saved
        );
    }
    #[test]
    fn changed_missing_negative_origin_and_scale_independent_displays_recover() {
        let mut saved = record();
        saved.area = rect(-2000.0, -500.0, 1440.0, 850.0);
        saved.frame = rect(-1960.0, -460.0, 900.0, 650.0);
        let smaller = rect(100.0, -1000.0, 700.0, 500.0);
        let recovered = restore(Some(&saved), &[display(9, smaller)], 0).unwrap();
        assert_eq!(recovered.frame, smaller);
        // Backing scale is intentionally absent: NSScreen/NSWindow points stay
        // coherent on 1x/2x displays; no physical-origin division is performed.
        let other = display(2, rect(0.0, 0.0, 2000.0, 1200.0));
        let preferred = display(1, saved.area);
        assert_eq!(
            restore(Some(&saved), &[other, preferred], 0).unwrap().frame,
            saved.frame
        );
    }
    #[test]
    fn invalid_and_unsupported_records_fall_back_without_adoption() {
        for invalid in [f64::NAN, f64::INFINITY, -1.0, 0.0, 100001.0] {
            let mut saved = record();
            saved.frame.size.width = invalid;
            assert_eq!(
                restore(Some(&saved), &[display(1, saved.area)], 0)
                    .unwrap()
                    .frame
                    .size
                    .width,
                1280.0
            );
        }
        let root = private_root("geometry-invalid");
        let settings = root.join("settings-v3.json");
        let path = root.join("trainer-window-v1.json");
        for bytes in [b"bad".as_slice(), b"{\"version\":99}"] {
            write_private(&path, bytes);
            let (store, saved) = Store::new(&settings);
            assert!(saved.is_none());
            assert!(store.save(&record()).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn optional_private_atomic_storage_and_explicit_run_routing() {
        let first = private_root("geometry-run-a");
        let second = private_root("geometry-run-b");
        let settings = first.join("settings-v3.json");
        write_private(&settings, b"credentials untouched");
        let (store, saved) = Store::new(&settings);
        assert!(saved.is_none());
        store.save(&record()).unwrap();
        assert_eq!(Store::new(&settings).1, Some(record()));
        assert!(Store::new(&second.join("settings-v3.json")).1.is_none());
        assert_eq!(std::fs::read(&settings).unwrap(), b"credentials untouched");
        make_shared(&store.path);
        assert!(store.save(&record()).is_err());
        make_private(&store.path);
        std::fs::remove_file(&store.path).unwrap();
        symlink(&settings, &store.path).unwrap();
        assert!(store.save(&record()).is_err());
        assert_eq!(std::fs::read(&settings).unwrap(), b"credentials untouched");
        std::fs::remove_dir_all(first).unwrap();
        std::fs::remove_dir_all(second).unwrap();
    }
    #[test]
    fn settled_normal_quit_and_temporary_capture_do_not_overwrite_preference() {
        let root = private_root("geometry-settle");
        let (store, saved) = Store::new(&root.join("settings-v3.json"));
        let path = store.path.clone();
        let mut tracking = Tracking {
            store,
            saved,
            candidate: None,
            committed: None,
            temporary: false,
            write_failed: false,
        };
        let now = Instant::now();
        sample(&mut tracking, Some(record()), now, false);
        assert!(!path.exists());
        sample(
            &mut tracking,
            Some(record()),
            now + Duration::from_secs(1),
            false,
        );
        assert_eq!(Store::read(&path).unwrap(), Some(record()));
        let mut moved = record();
        moved.frame.origin.x += 10.0;
        sample(
            &mut tracking,
            Some(moved.clone()),
            now + Duration::from_secs(2),
            true,
        );
        assert_eq!(Store::read(&path).unwrap(), Some(moved.clone()));
        // Minimized/fullscreen/zoomed observations are None, preserving normal.
        sample(&mut tracking, None, now + Duration::from_secs(3), true);
        tracking.temporary = true;
        sample(
            &mut tracking,
            Some(record()),
            now + Duration::from_secs(4),
            true,
        );
        assert_eq!(Store::read(&path).unwrap(), Some(moved));
        std::fs::remove_dir_all(root).unwrap();
    }
}
