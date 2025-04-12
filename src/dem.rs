use std::path::Path;
#[cfg(feature = "native")]
use gdal::Dataset;
#[cfg(feature = "native")]
use gdal::raster::RasterBand;
use ndarray::{Array2, ShapeError};
use thiserror::Error;
use std::collections::{BinaryHeap, HashSet};
use std::cmp::Reverse as StdReverse;
use std::cmp::Ordering;
use std::fmt;

#[derive(Error, Debug)]
pub enum DemError {
    #[error("Failed to open DEM file: {0}")]
    OpenError(String),
    
    #[cfg(feature = "native")]
    #[error("GDAL error: {0}")]
    GdalError(#[from] gdal::errors::GdalError),
    
    #[error("Invalid DEM data: {0}")]
    InvalidData(String),
    
    #[cfg(feature = "native")]
    #[error("Array shape error: {0}")]
    ShapeError(#[from] ShapeError),
    
    #[error("Failed to merge DEMs: {0}")]
    MergeError(String),
}

#[derive(Clone)]
pub struct DigitalElevationModel {
    pub width: usize,
    pub height: usize,
    pub resolution: f64,
    pub data: Vec<f32>,
    pub no_data_value: Option<f32>,
    pub geo_transform: [f64; 6],
    // Bounds in world coordinates (minx, miny, maxx, maxy)
    pub bounds: (f64, f64, f64, f64),
}

impl DigitalElevationModel {
    /// Create a new DEM from raw data
    pub fn new(width: usize, height: usize, resolution: f64, data: Vec<f32>) -> Self {
        let bounds = (0.0, 0.0, width as f64 * resolution, height as f64 * resolution);
        let geo_transform = [0.0, resolution, 0.0, 0.0, 0.0, resolution];
        
        DigitalElevationModel {
            width,
            height,
            resolution,
            data,
            no_data_value: Some(f32::NAN),
            geo_transform,
            bounds,
        }
    }
    
    /// Load a DEM from a single GeoTIFF file
    #[cfg(feature = "native")]
    pub fn from_geotiff(path: &Path) -> Result<Self, DemError> {
        println!("Loading DEM from: {}", path.display());
        
        // Open the dataset
        let dataset = Dataset::open(path)
            .map_err(|e| DemError::OpenError(format!("Cannot open file {}: {}", path.display(), e)))?;
        
        // Get the first raster band (DEMs typically have just one band)
        let band = dataset.rasterband(1)?;
        
        // Get the size of the dataset
        let (width, height) = dataset.raster_size();
        
        // Get the geotransform (contains resolution and coordinate information)
        let geo_transform = dataset.geo_transform()?;
        
        // Calculate resolution (assuming square pixels)
        let x_resolution = geo_transform[1].abs();
        let y_resolution = geo_transform[5].abs();
        let resolution = (x_resolution + y_resolution) / 2.0;
        
        // Get the no data value (if present)
        let no_data_value = band.no_data_value();
        
        // Read the entire DEM into memory
        let data_array: Array2<f32> = band.read_as_array(
            (0, 0), 
            (width, height), 
            (width, height), 
            None
        )?;
        
        // Convert the 2D array to a flat vector for easier processing
        let data = data_array.into_raw_vec();
        
        // Calculate bounds
        let minx = geo_transform[0];
        let maxx = minx + width as f64 * geo_transform[1];
        let maxy = geo_transform[3];
        let miny = maxy + height as f64 * geo_transform[5];
        
        Ok(DigitalElevationModel {
            width: width as usize,
            height: height as usize,
            resolution,
            data,
            no_data_value,
            geo_transform,
            bounds: (minx, miny, maxx, maxy),
        })
    }
    
    /// Merge multiple DEMs from GeoTIFF files into a single DEM
    #[cfg(feature = "native")]
    pub fn from_multiple_geotiffs(paths: &[&Path]) -> Result<Self, DemError> {
        if paths.is_empty() {
            return Err(DemError::InvalidData("No DEM files provided".to_string()));
        }
        
        if paths.len() == 1 {
            return Self::from_geotiff(paths[0]);
        }
        
        println!("Loading and merging {} DEM files...", paths.len());
        
        // Step 1: Load all DEMs and determine the overall bounds
        let mut dems = Vec::with_capacity(paths.len());
        let mut min_x = f64::MAX;
        let mut min_y = f64::MAX;
        let mut max_x = f64::MIN;
        let mut max_y = f64::MIN;
        let mut common_resolution = None;
        let mut common_no_data = None;
        
        for path in paths {
            let dem = Self::from_geotiff(path)?;
            
            // Check resolution compatibility
            if let Some(res) = common_resolution {
                // Allow a small tolerance for floating point differences
                if (dem.resolution - res).abs() > 0.01 {
                    return Err(DemError::MergeError(
                        format!("Resolution mismatch: {} vs {}", dem.resolution, res)
                    ));
                }
            } else {
                common_resolution = Some(dem.resolution);
            }
            
            // Use the first no_data value we find, or prefer explicit ones
            if common_no_data.is_none() || 
               (common_no_data.is_some() && dem.no_data_value.is_some()) {
                common_no_data = dem.no_data_value;
            }
            
            // Update overall bounds
            min_x = min_x.min(dem.bounds.0);
            min_y = min_y.min(dem.bounds.1);
            max_x = max_x.max(dem.bounds.2);
            max_y = max_y.max(dem.bounds.3);
            
            dems.push(dem);
        }
        
        let resolution = common_resolution.unwrap();
        
        // Calculate grid dimensions for the merged DEM
        let width = ((max_x - min_x) / resolution).ceil() as usize;
        let height = ((max_y - min_y) / resolution).ceil() as usize;
        
        println!("Creating merged DEM: {}x{} cells at {} meter resolution", 
                width, height, resolution);
        
        // Create a new geo_transform for the merged DEM
        let geo_transform = [
            min_x,                   // top left x
            resolution,              // w-e pixel resolution
            0.0,                     // 0 if north-up
            max_y,                   // top left y
            0.0,                     // 0 if north-up
            -resolution,             // n-s pixel resolution (negative)
        ];
        
        // Initialize the merged data with no_data values
        let no_data_value = common_no_data.unwrap_or(f32::NAN);
        let mut merged_data = vec![no_data_value; width * height];
        
        // Step 2: Merge the data from each DEM into the result grid
        for dem in &dems {
            // For each cell in the source DEM
            for src_y in 0..dem.height {
                for src_x in 0..dem.width {
                    // Get the world coordinates of this cell
                    let (world_x, world_y) = dem.grid_to_geo(src_x, src_y);
                    
                    // Calculate the corresponding cell in the merged grid
                    let merged_x = ((world_x - min_x) / resolution).floor() as usize;
                    let merged_y = ((max_y - world_y) / resolution).floor() as usize;
                    
                    // Skip if outside the bounds of the merged grid
                    if merged_x >= width || merged_y >= height {
                        continue;
                    }
                    
                    // Get the elevation value
                    if let Some(elevation) = dem.get_elevation(src_x, src_y) {
                        let merged_idx = merged_y * width + merged_x;
                        
                        // Only overwrite if the current value is no_data or if the new value is "better"
                        // Here, we just use the last DEM's value, but you could implement more sophisticated logic
                        // like averaging overlapping values or taking the higher one
                        if merged_data[merged_idx] == no_data_value || 
                           merged_data[merged_idx].is_nan() {
                            merged_data[merged_idx] = elevation;
                        }
                    }
                }
            }
        }
        
        Ok(DigitalElevationModel {
            width,
            height,
            resolution,
            data: merged_data,
            no_data_value: Some(no_data_value),
            geo_transform,
            bounds: (min_x, min_y, max_x, max_y),
        })
    }
    
    /// Create a stub implementation for WebAssembly support where GDAL is unavailable
    #[cfg(not(feature = "native"))]
    pub fn from_multiple_geotiffs(_paths: &[&Path]) -> Result<Self, DemError> {
        Err(DemError::InvalidData("GDAL features not available in WebAssembly".to_string()))
    }

    /// Get elevation at a specific grid point
    pub fn get_elevation(&self, x: usize, y: usize) -> Option<f32> {
        if x < self.width && y < self.height {
            let value = self.data[y * self.width + x];
            
            // If the value is a no_data_value, return None
            if let Some(ndv) = self.no_data_value {
                if value == ndv || value.is_nan() {
                    return None;
                }
            } else if value.is_nan() {
                return None;
            }
            
            Some(value)
        } else {
            None
        }
    }
    
    /// Fill sinks in the DEM using the priority-flood algorithm
    pub fn fill_sinks(&mut self) {
        println!("Filling sinks in DEM...");
        
        let width = self.width;
        let height = self.height;
        
        // Create a priority queue that will process cells in order of increasing elevation
        // Using a custom PriorityItem to store position with the elevation
        let mut queue = BinaryHeap::new();
        
        // Create a set to track which cells have been processed
        let mut closed = vec![false; width * height];
        
        // First, add all edge cells to the queue (these are drainage points)
        for y in 0..height {
            for x in 0..width {
                // Check if this is an edge cell
                let is_edge = x == 0 || y == 0 || x == width - 1 || y == height - 1;
                
                if is_edge {
                    if let Some(elevation) = self.get_elevation(x, y) {
                        let idx = y * width + x;
                        queue.push(StdReverse(PriorityItem {
                            elevation,
                            x,
                            y,
                        }));
                        closed[idx] = true;
                    }
                }
            }
        }
        
        // Process cells in order of increasing elevation
        while let Some(StdReverse(item)) = queue.pop() {
            let cell_idx = item.y * width + item.x;
            let cell_elev = self.data[cell_idx];
            
            // Get all valid neighbors of this cell
            let neighbors = self.get_neighbors(item.x, item.y);
            
            // Process each unprocessed neighbor
            for (nx, ny) in neighbors {
                let n_idx = ny * width + nx;
                
                // Skip if already processed
                if closed[n_idx] {
                    continue;
                }
                
                // Get the neighbor's elevation (if available)
                if let Some(mut n_elev) = self.get_elevation(nx, ny) {
                    // If the neighbor is lower than the current cell, raise it
                    if n_elev < cell_elev {
                        n_elev = cell_elev;
                        self.data[n_idx] = cell_elev;
                    }
                    
                    // Mark as processed and add to queue
                    queue.push(StdReverse(PriorityItem {
                        elevation: n_elev,
                        x: nx,
                        y: ny,
                    }));
                    closed[n_idx] = true;
                }
            }
        }
        
        println!("Sink filling completed");
    }
    
    /// Get the 8 adjacent neighbors of a cell that have valid elevation data
    fn get_neighbors(&self, x: usize, y: usize) -> Vec<(usize, usize)> {
        let width = self.width;
        let height = self.height;
        let mut neighbors = Vec::with_capacity(8);
        
        // Check all 8 adjacent cells
        for dy in -1..=1 {
            for dx in -1..=1 {
                // Skip the center cell (ourselves)
                if dx == 0 && dy == 0 {
                    continue;
                }
                
                // Calculate neighbor coordinates
                let nx = x as isize + dx;
                let ny = y as isize + dy;
                
                // Skip if outside the DEM boundaries
                if nx < 0 || ny < 0 || nx >= width as isize || ny >= height as isize {
                    continue;
                }
                
                let nx = nx as usize;
                let ny = ny as usize;
                
                // Only add if the cell has valid elevation data
                if self.get_elevation(nx, ny).is_some() {
                    neighbors.push((nx, ny));
                }
            }
        }
        
        neighbors
    }
    
    /// Convert grid coordinates to geographic coordinates
    pub fn grid_to_geo(&self, x: usize, y: usize) -> (f64, f64) {
        let geo_x = self.geo_transform[0] + x as f64 * self.geo_transform[1];
        let geo_y = self.geo_transform[3] + y as f64 * self.geo_transform[5];
        (geo_x, geo_y)
    }
    
    /// Convert geographic coordinates to grid coordinates
    pub fn geo_to_grid(&self, geo_x: f64, geo_y: f64) -> (usize, usize) {
        let x = ((geo_x - self.geo_transform[0]) / self.geo_transform[1]) as usize;
        let y = ((geo_y - self.geo_transform[3]) / self.geo_transform[5]) as usize;
        (x, y)
    }
    
    /// Check if this DEM is adjacent to another DEM
    pub fn is_adjacent_to(&self, other: &Self) -> bool {
        // Check if the bounds of the two DEMs are adjacent or overlapping
        let self_min_x = self.bounds.0;
        let self_min_y = self.bounds.1;
        let self_max_x = self.bounds.2;
        let self_max_y = self.bounds.3;
        
        let other_min_x = other.bounds.0;
        let other_min_y = other.bounds.1;
        let other_max_x = other.bounds.2;
        let other_max_y = other.bounds.3;
        
        // Two rectangles are adjacent if they share an edge or corner
        (self_min_x <= other_max_x && self_max_x >= other_min_x) &&
        (self_min_y <= other_max_y && self_max_y >= other_min_y)
    }
}

/// For priority queue in sink filling algorithm
#[derive(Debug, Clone, Copy)]
struct PriorityItem {
    elevation: f32,
    x: usize,
    y: usize,
}

impl Eq for PriorityItem {}

impl PartialEq for PriorityItem {
    fn eq(&self, other: &Self) -> bool {
        self.elevation == other.elevation
    }
}

impl PartialOrd for PriorityItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PriorityItem {
    fn cmp(&self, other: &Self) -> Ordering {
        self.elevation.partial_cmp(&other.elevation).unwrap_or(Ordering::Equal)
    }
}