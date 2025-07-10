
        pub fn gdal_version_docs_rs_wrapper() -> String {
            let key = "VERSION_NUM";
            let c_key = std::ffi::CString::new(key.as_bytes()).unwrap();

            unsafe {
                let res_ptr = crate::GDALVersionInfo(c_key.as_ptr());
                let c_res = std::ffi::CStr::from_ptr(res_ptr);
                c_res.to_string_lossy().into_owned()
            }
        }