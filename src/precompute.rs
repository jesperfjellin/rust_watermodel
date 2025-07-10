use crate::dem::DigitalElevationModel;
use crate::flow::FlowModel;
use crate::visualization::{generate_visualization_data, generate_high_quality_streams};
use serde::{Serialize, Deserialize};
use std::path::{Path, PathBuf};
use std::fs;
use std::collections::HashMap;

/// Pre-computed catchment data that can be loaded instantly
#[derive(Serialize, Deserialize)]
pub struct PrecomputedCatchment {
    /// Catchment identifier
    pub id: String,
    /// Basic metadata
    pub metadata: CatchmentMetadata,
    /// Optimized terrain data for 3D rendering
    pub terrain: TerrainData,
    /// Flow analysis results
    pub flow: FlowData,
    /// Stream networks at different detail levels
    pub streams: StreamNetworks,
    /// Water visualization data
    pub water_viz: WaterVisualizationData,
}

#[derive(Serialize, Deserialize)]
pub struct CatchmentMetadata {
    pub width: usize,
    pub height: usize,
    pub resolution: f64,
    pub bounds: (f64, f64, f64, f64),
    pub elevation_range: (f32, f32),
    pub processing_timestamp: String,
}

#[derive(Serialize, Deserialize)]
pub struct TerrainData {
    /// Optimized elevation data (potentially downsampled for rendering)
    pub elevation_data: Vec<f32>,
    /// Mesh optimization parameters
    pub mesh_width: usize,
    pub mesh_height: usize,
    pub skip_factor: usize,
    /// Color mapping data
    pub color_data: Vec<f32>, // RGB values for each vertex
}

#[derive(Serialize, Deserialize)]
pub struct FlowData {
    /// Flow direction codes (u8 values)
    pub flow_directions: Vec<u8>,
    /// Flow accumulation values
    pub flow_accumulation: Vec<f32>,
    /// Slope values
    pub slopes: Vec<f32>,
    /// Major outlet points
    pub outlets: Vec<(usize, usize, f32)>, // (x, y, accumulation)
}

#[derive(Serialize, Deserialize)]
pub struct StreamNetworks {
    /// High-detail streams (0.01 threshold)
    pub detailed: Vec<Vec<(usize, usize)>>,
    /// Medium-detail streams (0.05 threshold)
    pub medium: Vec<Vec<(usize, usize)>>,
    /// Major streams only (0.1 threshold)
    pub major: Vec<Vec<(usize, usize)>>,
}

#[derive(Serialize, Deserialize)]
pub struct WaterVisualizationData {
    /// Flow accumulation values
    pub flow_accumulation: Vec<f32>,
    /// Slope values
    pub slopes: Vec<f32>,
    /// Velocity vectors (x, y components)
    pub velocities: Vec<f32>,
    /// Particle spawn points
    pub spawn_points: Vec<(usize, usize)>,
}

impl PrecomputedCatchment {
    /// Create a new pre-computed catchment from a DEM file
    pub fn from_dem_file(dem_path: &Path, catchment_id: &str) -> Result<Self, Box<dyn std::error::Error>> {
        println!("Processing catchment {} from {}", catchment_id, dem_path.display());
        
        // Load DEM
        let mut dem = DigitalElevationModel::from_multiple_geotiffs(&[dem_path])?;
        
        // Process sinks
        dem.process_sinks(crate::dem::SinkTreatmentMethod::CompletelyFill);
        
        // Create flow model
        let mut flow_model = FlowModel::new(dem);
        flow_model.compute_flow_directions();
        flow_model.compute_flow_accumulation();
        
        // Generate visualization data
        let water_viz_data = generate_visualization_data(&flow_model);
        
        // Extract stream networks at different detail levels
        let detailed_streams = generate_high_quality_streams(&flow_model, 0.01);
        let medium_streams = generate_high_quality_streams(&flow_model, 0.05);
        let major_streams = generate_high_quality_streams(&flow_model, 0.1);
        
        // Find outlet points
        let outlets = Self::find_outlets(&flow_model);
        
        // Create optimized terrain data
        let terrain_data = Self::create_optimized_terrain(&flow_model.dem);
        
        // Create metadata
        let elevation_range = Self::calculate_elevation_range(&flow_model.dem.data);
        let metadata = CatchmentMetadata {
            width: flow_model.dem.width,
            height: flow_model.dem.height,
            resolution: flow_model.dem.resolution,
            bounds: flow_model.dem.bounds,
            elevation_range,
            processing_timestamp: chrono::Utc::now().to_rfc3339(),
        };
        
        // Create flow data
        let flow_data = FlowData {
            flow_directions: flow_model.flow_directions.iter().map(|&d| d.code()).collect(),
            flow_accumulation: flow_model.flow_accumulation,
            slopes: flow_model.slopes,
            outlets,
        };
        
        // Create stream networks
        let streams = StreamNetworks {
            detailed: detailed_streams,
            medium: medium_streams,
            major: major_streams,
        };
        
        // Create water visualization data
        let water_viz = WaterVisualizationData {
            flow_accumulation: water_viz_data.flow_accumulation,
            slopes: water_viz_data.slopes,
            velocities: water_viz_data.velocities,
            spawn_points: water_viz_data.spawn_points,
        };
        
        Ok(PrecomputedCatchment {
            id: catchment_id.to_string(),
            metadata,
            terrain: terrain_data,
            flow: flow_data,
            streams,
            water_viz,
        })
    }
    
    /// Save the pre-computed data to a file
    pub fn save_to_file(&self, output_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let data = bincode::serialize(self)?;
        fs::write(output_path, data)?;
        println!("Saved pre-computed data to {}", output_path.display());
        Ok(())
    }
    
    /// Load pre-computed data from a file
    pub fn load_from_file(file_path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let data = fs::read(file_path)?;
        let catchment: PrecomputedCatchment = bincode::deserialize(&data)?;
        Ok(catchment)
    }
    
    /// Find major outlet points in the catchment
    fn find_outlets(flow_model: &FlowModel) -> Vec<(usize, usize, f32)> {
        let mut outlets = Vec::new();
        
        for y in 0..flow_model.dem.height {
            for x in 0..flow_model.dem.width {
                if flow_model.get_flow_direction(x, y) == Some(crate::flow::FlowDirection::NoFlow) {
                    if let Some(acc) = flow_model.get_flow_accumulation(x, y) {
                        if acc > 1.0 {  // Not just a single cell with no flow
                            outlets.push((x, y, acc));
                        }
                    }
                }
            }
        }
        
        // Sort by accumulation (largest first) and take top 10
        outlets.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        outlets.truncate(10);
        
        outlets
    }
    
    /// Create optimized terrain data for 3D rendering
    fn create_optimized_terrain(dem: &DigitalElevationModel) -> TerrainData {
        // Use the same optimization logic as in three_renderer.js
        let max_vertices_per_dimension = 2048;
        
        let mut mesh_width = dem.width;
        let mut mesh_height = dem.height;
        let mut skip_factor = 1;
        
        // Calculate skip factor for large DEMs
        if dem.width > max_vertices_per_dimension || dem.height > max_vertices_per_dimension {
            skip_factor = std::cmp::max(1, (std::cmp::max(dem.width, dem.height) + max_vertices_per_dimension - 1) / max_vertices_per_dimension);
            if skip_factor > 3 {
                skip_factor = (skip_factor as f64 * 0.75) as usize;
            }
            
            mesh_width = dem.width / skip_factor;
            mesh_height = dem.height / skip_factor;
        }
        
        // Create optimized elevation data
        let mut optimized_elevations = Vec::new();
        for y in 0..mesh_height + 1 {
            for x in 0..mesh_width + 1 {
                let dem_x = (dem.width - 1).min(x * skip_factor);
                let dem_y = (dem.height - 1).min(y * skip_factor);
                let dem_index = dem_y * dem.width + dem_x;
                optimized_elevations.push(dem.data[dem_index]);
            }
        }
        
        // Create color data (simplified version)
        let color_data = vec![0.5; optimized_elevations.len() * 3]; // Default gray
        
        TerrainData {
            elevation_data: optimized_elevations,
            mesh_width,
            mesh_height,
            skip_factor,
            color_data,
        }
    }
    
    /// Calculate elevation range from data
    fn calculate_elevation_range(elevation_data: &[f32]) -> (f32, f32) {
        let mut min_elev = f32::INFINITY;
        let mut max_elev = f32::NEG_INFINITY;
        
        for &elev in elevation_data {
            if !elev.is_nan() && elev >= 0.0 {
                min_elev = min_elev.min(elev);
                max_elev = max_elev.max(elev);
            }
        }
        
        (min_elev, max_elev)
    }
}

/// Process all catchments and save pre-computed data
pub fn process_all_catchments(input_dir: &Path, output_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Create output directory if it doesn't exist
    fs::create_dir_all(output_dir)?;
    
    // Find all GeoTIFF files
    let dem_files = find_geotiff_files(input_dir)?;
    
    if dem_files.is_empty() {
        return Err("No GeoTIFF files found".into());
    }
    
    println!("Processing {} catchments...", dem_files.len());
    
    // Process each catchment
    for (i, dem_path) in dem_files.iter().enumerate() {
        let catchment_id = dem_path.file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("catchment_{}", i));
        
        println!("Processing {}/{}: {}", i + 1, dem_files.len(), catchment_id);
        
        // Create pre-computed data
        let catchment = PrecomputedCatchment::from_dem_file(dem_path, &catchment_id)?;
        
        // Save to file
        let output_path = output_dir.join(format!("{}.bin", catchment_id));
        catchment.save_to_file(&output_path)?;
    }
    
    // Create an index file with metadata
    create_catchment_index(output_dir)?;
    
    println!("All catchments processed successfully!");
    Ok(())
}

/// Create an index file with metadata for all catchments
fn create_catchment_index(output_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let mut index = HashMap::new();
    
    // Read all .bin files and extract metadata
    for entry in fs::read_dir(output_dir)? {
        let entry = entry?;
        let path = entry.path();
        
        if path.extension().and_then(|s| s.to_str()) == Some("bin") {
            if let Ok(catchment) = PrecomputedCatchment::load_from_file(&path) {
                index.insert(catchment.id.clone(), catchment.metadata);
            }
        }
    }
    
    // Save index as JSON
    let index_path = output_dir.join("catchment_index.json");
    let index_json = serde_json::to_string_pretty(&index)?;
    fs::write(index_path, index_json)?;
    
    Ok(())
}

/// Find all GeoTIFF files in a directory
fn find_geotiff_files(dir: &Path) -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
    let mut geotiff_files = Vec::new();
    
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        
        if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if ext_str == "tif" || ext_str == "tiff" {
                    geotiff_files.push(path);
                }
            }
        }
    }
    
    Ok(geotiff_files)
} 