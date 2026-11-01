//! Read-only legacy adoption adapter. Only explicit local setup may call get.
//! Never enumerate, write or delete original Keychain items.
use std::ffi::c_void;
use std::ptr;

const SERVICE: &str = "com.codexa.garmin-trainer.desktop.provider.v1";
pub trait Secrets {
    fn get(&self, account: &str) -> Result<String, &'static str>;
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
    fn SecKeychainItemFreeContent(attributes: *mut c_void, data: *mut c_void) -> i32;
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
            return Err("Legacy key missing, locked or denied. Privately re-enter configured slots; originals unchanged.");
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
}
