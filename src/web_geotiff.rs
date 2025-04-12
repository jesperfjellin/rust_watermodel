use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{File, FileReader};
use wasm_bindgen_futures::JsFuture;
use js_sys::{ArrayBuffer, Uint8Array};
use crate::dem::DigitalElevationModel;
use crate::dem::DemError;
use std::io::Cursor;

#[wasm_bindgen]
pub async fn parse_geotiff_file(file: File) -> Result<JsValue, JsValue> {
    // Read the file as an ArrayBuffer
    let array_buffer = read_file_as_array_buffer(file).await?;
    
    // Convert the ArrayBuffer to a Uint8Array
    let uint8_array = Uint8Array::new(&array_buffer);
    let data = uint8_array.to_vec();
    
    // Parse the GeoTIFF file
    match parse_geotiff_bytes(&data) {
        Ok(dem) => {
            // Create a result object to return to JavaScript
            let result = js_sys::Object::new();
            js_sys::Reflect::set(&result, &JsValue::from_str("width"), &JsValue::from(dem.width as u32))?;
            js_sys::Reflect::set(&result, &JsValue::from_str("height"), &JsValue::from(dem.height as u32))?;
            js_sys::Reflect::set(&result, &JsValue::from_str("resolution"), &JsValue::from(dem.resolution))?;
            
            // Set the elevation data
            let elevation_array = serde_wasm_bindgen::to_value(&dem.data)?;
            js_sys::Reflect::set(&result, &JsValue::from_str("data"), &elevation_array)?;
            
            Ok(JsValue::from(result))
        },
        Err(e) => {
            Err(JsValue::from_str(&format!("Failed to parse GeoTIFF: {}", e)))
        }
    }
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
        let onerror_cb = Closure::once_into_js(move |e: web_sys::ProgressEvent| {
            reject.call1(&JsValue::NULL, &JsValue::from_str("Error reading file"));
        });
        reader.set_onerror(Some(onerror_cb.as_ref().unchecked_ref()));
        
        // Start reading
        reader.read_as_array_buffer(&file)
            .expect("FileReader should be able to read as ArrayBuffer");
    });
    
    let result = JsFuture::from(promise).await?;
    Ok(result.dyn_into::<ArrayBuffer>()?)
}

// Parse GeoTIFF bytes to a DEM
fn parse_geotiff_bytes(data: &[u8]) -> Result<DigitalElevationModel, DemError> {
    // Since the geotiff crate's TIFF::open only works with file paths,
    // we need to modify our approach. We'll create a custom function to
    // handle byte data.
    
    // For now, this is a simplified version since we can't directly use
    // the geotiff crate's API to parse in-memory data

    // Create a memory cursor to read the data
    let cursor = Cursor::new(data);
    
    // Create a temporary file and write the data
    // This is a workaround since the geotiff crate only supports file paths
    let temp_dir = std::env::temp_dir();
    let temp_file_path = temp_dir.join("temp_geotiff.tif");
    std::fs::write(&temp_file_path, data)
        .map_err(|e| DemError::OpenError(format!("Failed to write temporary file: {}", e)))?;
    
    // Open the GeoTIFF file
    let tiff = geotiff::tiff::TIFF::open(temp_file_path.to_str().unwrap())
        .map_err(|e| DemError::OpenError(format!("Failed to open GeoTIFF: {}", e)))?;
    
    // Get dimensions
    let ifd = &tiff.ifds[0]; // Use the first IFD
    let width = ifd.get_image_width();
    let height = ifd.get_image_length();
    
    // Read elevation data
    let mut elevation_data = Vec::with_capacity(width * height);
    for y in 0..height {
        for x in 0..width {
            let value = tiff.get_value_at(x, y);
            elevation_data.push(value as f32); // Convert to f32
        }
    }
    
    // Clean up temporary file
    let _ = std::fs::remove_file(temp_file_path);
    
    // Default to a reasonable resolution if not available
    let resolution = 10.0; // Placeholder - actual resolution would be extracted from GeoTIFF metadata
    
    // Create DEM
    Ok(DigitalElevationModel::new(width, height, resolution, elevation_data))
}