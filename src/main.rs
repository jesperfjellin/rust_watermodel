use std::path::{Path, PathBuf};
use std::fs;

mod dem;
mod flow;
mod visualization;

use dem::DigitalElevationModel;
use flow::FlowModel;

fn main() {
    println!("Rust Water Model - DEM Flow Visualization");
    
    // In Docker, files will be mounted to /data
    let data_dir = Path::new("/data");
    
    // Get all GeoTIFF files in the data directory
    let dem_files = match find_geotiff_files(data_dir) {
        Ok(files) => files,
        Err(e) => {
            println!("Error finding GeoTIFF files: {}", e);
            return;
        }
    };
    
    if dem_files.is_empty() {
        println!("No GeoTIFF files found in {}", data_dir.display());
        println!("Please place GeoTIFF DEM files in the data directory");
        return;
    }
    
    println!("Found {} GeoTIFF files", dem_files.len());
    for file in &dem_files {
        println!("  - {}", file.display());
    }
    
    // Convert to Path references for the from_multiple_geotiffs function
    let dem_paths: Vec<&Path> = dem_files.iter().map(|p| p.as_path()).collect();
    
    // Load and merge the DEMs
    match DigitalElevationModel::from_multiple_geotiffs(&dem_paths) {
        Ok(mut dem) => {
            println!("Successfully loaded and merged DEMs:");
            println!("  Width: {}", dem.width);
            println!("  Height: {}", dem.height);
            println!("  Resolution: {:.2} meters", dem.resolution);
            println!("  Bounds: ({:.2}, {:.2}) - ({:.2}, {:.2})",
                    dem.bounds.0, dem.bounds.1, dem.bounds.2, dem.bounds.3);
            
            // Fill sinks in the DEM
            println!("Filling sinks in the DEM...");
            dem.fill_sinks();
            println!("Sink filling completed.");
            
            // Create a flow model from the DEM
            let mut flow_model = FlowModel::new(dem);
            
            // Compute flow directions
            flow_model.compute_flow_directions();
            
            // Count the distribution of flow directions
            let mut direction_counts = [0; 9]; // 8 directions + NoFlow
            for &dir in &flow_model.flow_directions {
                direction_counts[dir.code() as usize] += 1;
            }
            
            println!("Flow direction distribution:");
            println!("  East: {}", direction_counts[FlowDirection::East as usize]);
            println!("  Southeast: {}", direction_counts[FlowDirection::Southeast as usize]);
            println!("  South: {}", direction_counts[FlowDirection::South as usize]);
            println!("  Southwest: {}", direction_counts[FlowDirection::Southwest as usize]);
            println!("  West: {}", direction_counts[FlowDirection::West as usize]);
            println!("  Northwest: {}", direction_counts[FlowDirection::Northwest as usize]);
            println!("  North: {}", direction_counts[FlowDirection::North as usize]);
            println!("  Northeast: {}", direction_counts[FlowDirection::Northeast as usize]);
            println!("  NoFlow: {}", direction_counts[FlowDirection::NoFlow as usize]);
            
            // Compute flow accumulation
            flow_model.compute_flow_accumulation();
            
            // Extract major streams (top 1% of cells by flow accumulation)
            let major_streams = flow_model.get_major_streams(0.01);
            println!("Extracted {} major stream cells (top 1%)", major_streams.len());
            
            // Get a sample of stream coordinates for debugging/visualization
            println!("Sample of stream cells (x, y):");
            for (i, &(x, y)) in major_streams.iter().enumerate().take(5) {
                let idx = y * flow_model.dem.width + x;
                let acc = flow_model.flow_accumulation[idx];
                let elev = flow_model.dem.get_elevation(x, y).unwrap_or(f32::NAN);
                println!("  Stream {}: ({}, {}) - Accumulation: {:.1}, Elevation: {:.1}", 
                         i+1, x, y, acc, elev);
            }
            
            // If there are outlet cells (cells that flow outside the DEM), identify them
            let mut outlets = Vec::new();
            for y in 0..flow_model.dem.height {
                for x in 0..flow_model.dem.width {
                    if flow_model.get_flow_direction(x, y) == Some(FlowDirection::NoFlow) {
                        if let Some(acc) = flow_model.get_flow_accumulation(x, y) {
                            if acc > 1.0 {  // Not just a single cell with no flow
                                outlets.push((x, y, acc));
                            }
                        }
                    }
                }
            }
            
            // Sort outlets by accumulation (largest first)
            outlets.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
            
            // Print the largest outlets (catchment pour points)
            println!("Catchment outlet points (x, y, accumulation):");
            for (i, &(x, y, acc)) in outlets.iter().enumerate().take(5) {
                let elev = flow_model.dem.get_elevation(x, y).unwrap_or(f32::NAN);
                println!("  Outlet {}: ({}, {}) - Accumulation: {:.1}, Elevation: {:.1}", 
                         i+1, x, y, acc, elev);
            }
            
            println!("Flow computation completed!");
        },
        Err(e) => {
            println!("Error loading DEMs: {}", e);
        }
    }
}

/// Find all GeoTIFF files in a directory
fn find_geotiff_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.exists() {
        return Err(format!("Directory does not exist: {}", dir.display()));
    }
    
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir.display()));
    }
    
    let mut geotiff_files = Vec::new();
    
    // Read directory entries
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => return Err(format!("Failed to read directory: {}", e)),
    };
    
    // Filter for GeoTIFF files
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            
            // Check if it's a file with a GeoTIFF extension
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if ext_str == "tif" || ext_str == "tiff" {
                        geotiff_files.push(path);
                    }
                }
            }
        }
    }
    
    Ok(geotiff_files)
}