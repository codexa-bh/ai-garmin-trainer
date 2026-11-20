//! Fixed system-browser destinations. Never a generic arbitrary-URL command.
//!
//! macOS keeps its existing routes (fixed `/usr/bin/open` usage page; the OAuth
//! helper's own NSWorkspace bridge). Windows opens both through the in-process
//! ShellExecuteExW API: no app-spawned shell, argv, environment or file carries
//! the URL. Windows then hands the URL to the user's registered browser itself.

pub const USAGE_PAGE: &str = "https://chatgpt.com/settings/usage";
/// Garmin Connect's own key-creation page. The user signs in and creates the
/// key in their browser; the app never automates or observes that session.
pub const GARMIN_KEY_PAGE: &str = "https://connect.garmin.com/app/settings/personalApiToken";
const AUTHORIZE_ORIGIN: &str = "https://auth.openai.com";
const AUTHORIZE_PATH: &str = "/api/accounts/authorize";

/// The single official OAuth authorization route, re-validated natively.
pub fn authorization_url(value: &str) -> bool {
    let Ok(url) = tauri::Url::parse(value) else {
        return false;
    };
    value.len() <= 16 * 1024
        && url.origin().ascii_serialization() == AUTHORIZE_ORIGIN
        && url.path() == AUTHORIZE_PATH
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.as_str() == value
}

pub fn usage_page() -> Result<(), ()> {
    fixed(USAGE_PAGE)
}
pub fn garmin_key_page() -> Result<(), ()> {
    fixed(GARMIN_KEY_PAGE)
}
fn fixed(url: &'static str) -> Result<(), ()> {
    #[cfg(target_os = "macos")]
    return std::process::Command::new("/usr/bin/open")
        .arg(url)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(drop)
        .map_err(drop);
    #[cfg(windows)]
    return windows::open(url);
}

/// Windows OAuth route only; macOS opens through the helper's own bridge.
pub fn authorization(url: &str) -> Result<(), ()> {
    if !authorization_url(url) {
        return Err(());
    }
    #[cfg(windows)]
    return windows::open(url);
    #[cfg(not(windows))]
    Err(())
}

#[cfg(windows)]
mod windows {
    use std::mem::size_of;
    use std::ptr::null_mut;
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    pub fn open(url: &str) -> Result<(), ()> {
        let url: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        // A dedicated COM-initialized thread, per ShellExecuteEx requirements.
        std::thread::spawn(move || unsafe {
            let initialized = CoInitializeEx(
                std::ptr::null(),
                (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
            ) >= 0;
            let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
            let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
            info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
            info.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
            info.hwnd = null_mut();
            info.lpVerb = verb.as_ptr();
            info.lpFile = url.as_ptr();
            info.nShow = SW_SHOWNORMAL;
            let opened = ShellExecuteExW(&mut info) != 0;
            if initialized {
                CoUninitialize();
            }
            if opened {
                Ok(())
            } else {
                Err(())
            }
        })
        .join()
        .unwrap_or(Err(()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_exact_official_authorization_route_is_accepted() {
        assert!(authorization_url(
            "https://auth.openai.com/api/accounts/authorize?client_id=x&state=y"
        ));
        for bad in [
            "https://auth.openai.com.evil.invalid/api/accounts/authorize",
            "http://auth.openai.com/api/accounts/authorize",
            "https://user:pw@auth.openai.com/api/accounts/authorize",
            "https://auth.openai.com/api/accounts/authorize#fragment",
            "https://auth.openai.com/api/accounts/other",
            "https://auth.openai.com:444/api/accounts/authorize",
            "file:///C:/Windows/System32/calc.exe",
            "https://AUTH.openai.com/api/accounts/authorize",
            " https://auth.openai.com/api/accounts/authorize",
        ] {
            assert!(!authorization_url(bad), "{bad}");
        }
        if !cfg!(windows) {
            assert!(authorization("https://auth.openai.com/api/accounts/authorize").is_err());
        }
    }
}
