//! Native-only macOS generic passwords. No shell process or renderer readback.
use std::ffi::c_void;
use std::ptr;

const SERVICE: &str = "com.codexa.garmin-trainer.desktop.provider.v1";
pub trait Secrets {
    fn get(&self, account: &str) -> Result<String, &'static str>;
    fn present(&self, account: &str) -> bool;
    fn add(&self, account: &str, value: &str) -> Result<(), &'static str>;
    fn delete(&self, account: &str) -> Result<(), &'static str>;
}
pub struct Keychain;

#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainFindGenericPassword(
        keychain: *const c_void,
        service_len: u32,
        service: *const u8,
        account_len: u32,
        account: *const u8,
        length: *mut u32,
        data: *mut *mut c_void,
        item: *mut *mut c_void,
    ) -> i32;
    fn SecKeychainAddGenericPassword(
        keychain: *const c_void,
        service_len: u32,
        service: *const u8,
        account_len: u32,
        account: *const u8,
        length: u32,
        data: *const u8,
        item: *mut *mut c_void,
    ) -> i32;
    fn SecKeychainItemFreeContent(attributes: *mut c_void, data: *mut c_void) -> i32;
    fn SecKeychainItemDelete(item: *mut c_void) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: *const c_void);
}

fn find(account: &str, length: *mut u32, data: *mut *mut c_void, item: *mut *mut c_void) -> i32 {
    unsafe {
        SecKeychainFindGenericPassword(
            ptr::null(),
            SERVICE.len() as u32,
            SERVICE.as_ptr(),
            account.len() as u32,
            account.as_ptr(),
            length,
            data,
            item,
        )
    }
}
impl Secrets for Keychain {
    fn get(&self, account: &str) -> Result<String, &'static str> {
        let mut length = 0;
        let mut data = ptr::null_mut();
        if find(account, &mut length, &mut data, ptr::null_mut()) != 0 {
            return Err("Keychain key missing, locked or access denied. No plaintext fallback.");
        }
        let value = if length > 0 && length <= 16384 && !data.is_null() {
            unsafe {
                std::str::from_utf8(std::slice::from_raw_parts(
                    data as *const u8,
                    length as usize,
                ))
                .ok()
                .map(str::to_owned)
            }
        } else {
            None
        };
        unsafe {
            SecKeychainItemFreeContent(ptr::null_mut(), data);
        }
        value.ok_or("Keychain value invalid; replace the key explicitly.")
    }
    fn present(&self, account: &str) -> bool {
        // Metadata-only query; never obtains the existing value for UI reads.
        let mut item = ptr::null_mut();
        let ok = find(account, ptr::null_mut(), ptr::null_mut(), &mut item) == 0;
        if !item.is_null() {
            unsafe {
                CFRelease(item);
            }
        }
        ok
    }
    fn add(&self, account: &str, value: &str) -> Result<(), &'static str> {
        let result = unsafe {
            SecKeychainAddGenericPassword(
                ptr::null(),
                SERVICE.len() as u32,
                SERVICE.as_ptr(),
                account.len() as u32,
                account.as_ptr(),
                value.len() as u32,
                value.as_ptr(),
                ptr::null_mut(),
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err("Keychain save denied or unavailable. Settings unchanged; no plaintext fallback.")
        }
    }
    fn delete(&self, account: &str) -> Result<(), &'static str> {
        let mut item = ptr::null_mut();
        let result = find(account, ptr::null_mut(), ptr::null_mut(), &mut item);
        if result == -25300 {
            return Ok(());
        }
        if result != 0 {
            return Err("Keychain cleanup unavailable.");
        }
        let deleted = unsafe { SecKeychainItemDelete(item) };
        unsafe {
            CFRelease(item);
        }
        if deleted == 0 {
            Ok(())
        } else {
            Err("Keychain cleanup unavailable.")
        }
    }
}
