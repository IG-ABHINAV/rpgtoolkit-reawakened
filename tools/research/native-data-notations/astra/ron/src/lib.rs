//! Research-only wasm32 bridge to the official parser; not a second RON parser.
//! JS owns allocations through these functions. Never expose this ABI to untrusted pointers.
use serde_json::{json, Value};

#[no_mangle]
pub extern "C" fn input_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// # Safety
/// `ptr` and `len` must be one live allocation returned by this module, freed once.
#[no_mangle]
pub unsafe extern "C" fn input_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

/// # Safety
/// `ptr` must point to `len` initialized bytes allocated by input_alloc.
#[no_mangle]
pub unsafe extern "C" fn convert(ptr: *const u8, len: usize, encode: bool) -> u64 {
    let input = std::str::from_utf8(std::slice::from_raw_parts(ptr, len));
    let result = input.map_err(|e| e.to_string()).and_then(|text| {
        if encode {
            let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
            ron::ser::to_string_pretty(&value, ron::ser::PrettyConfig::default())
                .map(|text| json!({"ok": true, "text": text})).map_err(|e| e.to_string())
        } else {
            ron::from_str::<Value>(text).map(|value| json!({"ok": true, "value": value}))
                .map_err(|e| e.to_string())
        }
    });
    let value = result.unwrap_or_else(|error| json!({"ok": false, "error": error}));
    let bytes = serde_json::to_vec(&value).expect("JSON Value is serializable").into_boxed_slice();
    let len = bytes.len() as u64;
    let ptr = Box::into_raw(bytes) as *mut u8 as u64;
    (len << 32) | ptr
}
