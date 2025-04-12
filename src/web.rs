#[cfg(feature = "web")]
pub mod geotiff_loader {
    use wasm_bindgen::prelude::*;
    use wasm_bindgen::JsCast;
    use web_sys::{File, Blob, FileReader};
    use wasm_bindgen_futures::JsFuture;
    use js_sys::{ArrayBuffer, Uint8Array};
    use std::convert::TryFrom;
    
    #[wasm_bindgen]
    pub async fn read_geotiff(file: File) -> Result<JsValue, JsValue> {
        // Read the file as an ArrayBuffer
        let array_buffer = read_file_as_array_buffer(file).await?;
        
        // Convert the ArrayBuffer to a Uint8Array
        let uint8_array = Uint8Array::new(&array_buffer);
        let data = uint8_array.to_vec();
        
        // Parse the GeoTIFF data
        let result = parse_geotiff(&data)?;
        
        Ok(result)
    }
    
    async fn read_file_as_array_buffer(file: File) -> Result<ArrayBuffer, JsValue> {
        let reader = FileReader::new()?;
        let reader_clone = reader.clone();
        
        let promise = js_sys::Promise::new(&mut |resolve, reject| {
            // Set up onload handler
            let onload_cb = Closure::once_into_js(move || {
                match reader_clone.result() {
                    Ok(result) => resolve.call1(&JsValue::NULL, &result),
                    Err(e) => reject.call1(&JsValue::NULL, &e),
                }
            });
            reader.set_onload(Some(onload_cb.as_ref().unchecked_ref()));
            
            // Set up onerror handler
            let onerror_cb = Closure::once_into_js(move |_| {
                reject.call0(&JsValue::NULL);
            });
            reader.set_onerror(Some(onerror_cb.as_ref().unchecked_ref()));
            
            // Start reading
            reader.read_as_array_buffer(&file)
                .expect("FileReader should be able to read as ArrayBuffer");
        });
        
        let result = JsFuture::from(promise).await?;
        Ok(result.dyn_into::<ArrayBuffer>()?)
    }
    
    fn parse_geotiff(data: &[u8]) -> Result<JsValue, JsValue> {
        #[cfg(feature = "geotiff")]
        {
            use geotiff::GeoTiff;
            
            // Parse GeoTIFF
            let tiff = match GeoTiff::from_blob(data) {
                Ok(tiff) => tiff,
                Err(e) => return Err(JsValue::from_str(&format!("Failed to parse GeoTIFF: {}", e))),
            };
            
            // Get dimensions
            let width = tiff.dimensions().unwrap_or((0, 0)).0;
            let height = tiff.dimensions().unwrap_or((0, 0)).1;
            
            // Get resolution
            let resolution = if let Some(res) = tiff.resolution() {
                (res.0.abs() + res.1.abs()) / 2.0
            } else {
                1.0 // Default if not available
            };
            
            // Get the first band data (assuming single-band DEM)
            let band_data = match tiff.band(0) {
                Ok(band) => band,
                Err(e) => return Err(JsValue::from_str(&format!("Failed to read band: {}", e))),
            };
            
            // Convert to f32 values
            let mut elevation_data = Vec::with_capacity(width * height);
            for y in 0..height {
                for x in 0..width {
                    let value = band_data.get(x, y).unwrap_or(f32::NAN);
                    elevation_data.push(value);
                }
            }
            
            // Create a result object
            let result = js_sys::Object::new();
            js_sys::Reflect::set(&result, &JsValue::from_str("width"), &JsValue::from(width as u32))?;
            js_sys::Reflect::set(&result, &JsValue::from_str("height"), &JsValue::from(height as u32))?;
            js_sys::Reflect::set(&result, &JsValue::from_str("resolution"), &JsValue::from(resolution))?;
            
            // Set the elevation data
            let elevation_array = serde_wasm_bindgen::to_value(&elevation_data)?;
            js_sys::Reflect::set(&result, &JsValue::from_str("data"), &elevation_array)?;
            
            Ok(result)
        }
        
        #[cfg(not(feature = "geotiff"))]
        {
            Err(JsValue::from_str("GeoTIFF support not enabled"))
        }
    }
}