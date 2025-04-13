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
    
    // Define a global callback function
    #[wasm_bindgen(js_namespace = window)]
    fn streamDataCallback(data: JsValue);
}

// Initialize function called when the wasm module is loaded
#[wasm_bindgen(start)]
pub fn start() {
    // Set up panic hook for better error messages
    panic::set_hook(Box::new(console_error_panic_hook::hook));
    console::log_1(&"Water model WASM module initialized with high-quality streams support (v1.3)".into());
    console::log_1(&"Module has static debug_streams function and method test() for diagnostics".into());
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
                           sink_method: &str,
                           epsilon: f32,
                           max_breach_depth: usize) -> Result<(), JsValue> {
        console::log_1(&format!("Processing DEM: {}x{} at {} resolution", width, height, resolution).into());
        
        // Create a DEM from the raw data
        let mut dem = dem::DigitalElevationModel::new(width, height, resolution, elevation_data);
        
        // Process sinks based on method
        let method = match sink_method {
            "fill" => dem::SinkTreatmentMethod::CompletelyFill,
            "epsilon" => dem::SinkTreatmentMethod::EpsilonFill(epsilon),
            "breach" => dem::SinkTreatmentMethod::Breach(max_breach_depth),
            "combined" => dem::SinkTreatmentMethod::Combined(epsilon, max_breach_depth),
            _ => dem::SinkTreatmentMethod::CompletelyFill
        };
        
        console::log_1(&"Processing sinks in DEM...".into());
        dem.process_sinks(method);
        
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
    pub fn get_stream_network(&self, threshold_percentile: f32, smooth_iterations: usize) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            // Generate stream network with smoothing
            let stream_network = visualization::generate_stream_network(flow_model, threshold_percentile, smooth_iterations);
            
            // Convert to JS
            let result = serde_wasm_bindgen::to_value(&stream_network)?;
            Ok(result)
        } else {
            Err(JsValue::from_str("Flow model not computed"))
        }
    }
    
    // Get detailed stream network as polylines
    #[wasm_bindgen]
    pub fn get_stream_polylines(&self, threshold_percentile: f32) -> Result<JsValue, JsValue> {
        if let Some(flow_model) = &self.flow_model {
            // Try to use the high-quality stream generator 
            console::log_1(&format!("Generating HIGH QUALITY stream network with threshold {}", threshold_percentile).into());
            
            // Use our high-quality streams function
            let polylines = visualization::generate_high_quality_streams(flow_model, threshold_percentile);
            console::log_1(&format!("Generated {} high-quality stream polylines", polylines.len()).into());
            
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
    
    // Get high-quality stream network without downsampling
    #[wasm_bindgen]
    pub fn get_hq_streams(&self, threshold_percentile: f32) -> JsValue {
        console::log_1(&format!("get_hq_streams called with threshold percentile: {}", threshold_percentile).into());
        
        if let Some(flow_model) = &self.flow_model {
            // Generate high-quality stream polylines using the provided threshold percentile
            let polylines = visualization::generate_high_quality_streams(flow_model, threshold_percentile);
            
            // Log success
            console::log_1(&format!("Generated {} high-quality stream polylines", polylines.len()).into());
            
            // Convert to JS directly without using Result
            match serde_wasm_bindgen::to_value(&polylines) {
                Ok(result) => result,
                Err(_) => JsValue::NULL,
            }
        } else {
            console::log_1(&"Flow model not computed".into());
            JsValue::NULL
        }
    }

    // Simple test function with minimal name to check if it gets exported
    #[wasm_bindgen]
    pub fn test(&self) -> JsValue {
        console::log_1(&"Test function called!".into());
        JsValue::from_str("test function response")
    }
}

// Add a static debug function outside of the WaterModel impl
#[wasm_bindgen]
pub fn debug_streams() -> JsValue {
    console::log_1(&"Debug streams function called".into());
    JsValue::from_str("debug function working")
}

// A very simple global function that doesn't use WaterModel at all
#[wasm_bindgen]
pub fn global_streams_test() -> JsValue {
    console::log_1(&"Global streams test function called".into());
    JsValue::from_str("Global function works")
}