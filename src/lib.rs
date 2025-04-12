use wasm_bindgen::prelude::*;
use web_sys::console;
use std::panic;
mod dem;
mod flow;
mod visualization;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

// Initialize function called when the wasm module is loaded
#[wasm_bindgen(start)]
pub fn start() {
    // Set up panic hook for better error messages
    panic::set_hook(Box::new(console_error_panic_hook::hook));
    console::log_1(&"Water model WASM module initialized".into());
}

#[wasm_bindgen]
pub struct WaterModel {
    dem: Option<dem::DigitalElevationModel>,
    flow_model: Option<flow::FlowModel>,
    width: usize,
    height: usize,
    resolution: f64,
}

#[wasm_bindgen]
impl WaterModel {
    // Create a new empty model
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        WaterModel {
            dem: None,
            flow_model: None,
            width: 0,
            height: 0,
            resolution: 0.0,
        }
    }
    
    // Process a DEM from raw data
    #[wasm_bindgen]
    pub fn process_dem_data(&mut self, 
                           width: usize, 
                           height: usize, 
                           resolution: f64, 
                           elevation_data: Vec<f32>,
                           fill_sinks: bool) -> Result<(), JsValue> {
        console::log_1(&format!("Processing DEM: {}x{} at {} resolution", width, height, resolution).into());
        
        // Create a DEM from the raw data
        let mut dem = dem::DigitalElevationModel::new(width, height, resolution, elevation_data);
        
        // Fill sinks if requested
        if fill_sinks {
            console::log_1(&"Filling sinks in DEM...".into());
            dem.fill_sinks();
        }
        
        // Save the dimensions for easy access
        self.width = width;
        self.height = height;
        self.resolution = resolution;
        
        // Store the DEM
        self.dem = Some(dem);
        
        Ok(())
    }
    
    // Compute flow directions and accumulation
    #[wasm_bindgen]
    pub fn compute_flow(&mut self) -> Result<(), JsValue> {
        if let Some(dem) = self.dem.take() {
            console::log_1(&"Computing flow directions...".into());
            
            // Create the flow model
            let mut flow_model = flow::FlowModel::new(dem);
            
            // Compute flow directions
            flow_model.compute_flow_directions();
            
            // Compute flow accumulation
            console::log_1(&"Computing flow accumulation...".into());
            flow_model.compute_flow_accumulation();
            
            // Store the flow model
            self.flow_model = Some(flow_model);
            
            // Put the DEM back
            self.dem = Some(self.flow_model.as_ref().unwrap().dem.clone());
            
            console::log_1(&"Flow computation completed".into());
            Ok(())
        } else {
            Err(JsValue::from_str("No DEM loaded"))
        }
    }
    
    // Get terrain data for visualization
    #[wasm_bindgen]
    pub fn get_terrain_data(&self) -> Result<JsValue, JsValue> {
        if let Some(dem) = &self.dem {
            // Create a simple object with the terrain data
            let result = serde_wasm_bindgen::to_value(&dem.data)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("No DEM loaded"))
        }
    }
    
    // Get flow direction data
    #[wasm_bindgen]
    pub fn get_flow_directions(&self) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            // Convert flow directions to u8 values
            let direction_codes: Vec<u8> = flow_model.flow_directions
                .iter()
                .map(|&dir| dir as u8)
                .collect();
                
            let result = serde_wasm_bindgen::to_value(&direction_codes)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("Flow directions not computed"))
        }
    }
    
    // Get flow accumulation data
    #[wasm_bindgen]
    pub fn get_flow_accumulation(&self) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            let result = serde_wasm_bindgen::to_value(&flow_model.flow_accumulation)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("Flow accumulation not computed"))
        }
    }
    
    // Get comprehensive water visualization data
    #[wasm_bindgen]
    pub fn get_water_visualization_data(&self) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            // Generate enhanced visualization data
            let viz_data = visualization::generate_visualization_data(flow_model);
            
            // Convert to JS
            let result = serde_wasm_bindgen::to_value(&viz_data)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("Flow model not computed"))
        }
    }
    
    // Get stream spawn points for water particle visualization
    #[wasm_bindgen]
    pub fn get_stream_spawn_points(&self) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            // Generate visualization data and extract spawn points
            let viz_data = visualization::generate_visualization_data(flow_model);
            let spawn_points = viz_data.spawn_points;
            
            // Convert to a flat array of [x1, y1, x2, y2, ...]
            let mut point_coords = Vec::with_capacity(spawn_points.len() * 2);
            for (x, y) in spawn_points {
                point_coords.push(x as u32);
                point_coords.push(y as u32);
            }
            
            let result = serde_wasm_bindgen::to_value(&point_coords)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("Flow model not computed"))
        }
    }
    
    // Get stream network data based on a threshold
    #[wasm_bindgen]
    pub fn get_stream_network(&self, threshold_percentile: f32) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            let streams = flow_model.get_major_streams(threshold_percentile);
            
            // Convert to a flat array of [x1, y1, x2, y2, ...]
            let mut stream_points = Vec::with_capacity(streams.len() * 2);
            for (x, y) in streams {
                stream_points.push(x as u32);
                stream_points.push(y as u32);
            }
            
            let result = serde_wasm_bindgen::to_value(&stream_points)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("Flow model not computed"))
        }
    }
    
    // Get detailed stream network as polylines
    #[wasm_bindgen]
    pub fn get_stream_polylines(&self, threshold_percentile: f32) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            // Generate stream polylines
            let polylines = visualization::generate_stream_network(flow_model, threshold_percentile);
            
            // Convert to a format suitable for JavaScript
            let result = serde_wasm_bindgen::to_value(&polylines)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("Flow model not computed"))
        }
    }
    
    // Get slope data for visualization
    #[wasm_bindgen]
    pub fn get_slope_data(&self) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            let result = serde_wasm_bindgen::to_value(&flow_model.slopes)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("Flow model not computed"))
        }
    }
    
    // Get model dimensions
    #[wasm_bindgen]
    pub fn get_dimensions(&self) -> JsValue {
        let dims = serde_wasm_bindgen::to_value(&(self.width, self.height, self.resolution))
            .unwrap_or(JsValue::NULL);
        dims
    }
}