use crate::dem::DigitalElevationModel;
use std::f32;
use std::collections::VecDeque;

/// Enum representing the 8 possible flow directions (D8 method)
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FlowDirection {
    East = 1,
    Southeast = 2,
    South = 4,
    Southwest = 8,
    West = 16,
    Northwest = 32,
    North = 64,
    Northeast = 128,
    NoFlow = 0, // For sinks or boundary cells
}

impl FlowDirection {
    /// Get the (dx, dy) offset for this flow direction
    pub fn get_offset(&self) -> (isize, isize) {
        match self {
            FlowDirection::East => (1, 0),
            FlowDirection::Southeast => (1, 1),
            FlowDirection::South => (0, 1),
            FlowDirection::Southwest => (-1, 1),
            FlowDirection::West => (-1, 0),
            FlowDirection::Northwest => (-1, -1),
            FlowDirection::North => (0, -1),
            FlowDirection::Northeast => (1, -1),
            FlowDirection::NoFlow => (0, 0),
        }
    }
    
    /// Convert a code to a FlowDirection
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => FlowDirection::East,
            2 => FlowDirection::Southeast,
            4 => FlowDirection::South,
            8 => FlowDirection::Southwest,
            16 => FlowDirection::West,
            32 => FlowDirection::Northwest,
            64 => FlowDirection::North,
            128 => FlowDirection::Northeast,
            _ => FlowDirection::NoFlow,
        }
    }
    
    /// Get the direction code
    pub fn code(&self) -> u8 {
        *self as u8
    }
}

pub struct FlowModel {
    pub dem: DigitalElevationModel,
    pub flow_directions: Vec<FlowDirection>,
    pub flow_accumulation: Vec<f32>,
    pub slopes: Vec<f32>,  // Store the slope for each cell
}

impl FlowModel {
    pub fn new(dem: DigitalElevationModel) -> Self {
        let cell_count = dem.width * dem.height;
        
        FlowModel {
            dem,
            flow_directions: vec![FlowDirection::NoFlow; cell_count],
            flow_accumulation: vec![0.0; cell_count],
            slopes: vec![0.0; cell_count],
        }
    }
    
    /// Compute D8 flow directions for each cell
    pub fn compute_flow_directions(&mut self) {
        println!("Computing D8 flow directions...");
        
        let width = self.dem.width;
        let height = self.dem.height;
        let resolution = self.dem.resolution;
        
        // Define the 8 neighboring directions in (dx, dy) offsets
        // Order: E, SE, S, SW, W, NW, N, NE
        let directions = [
            (1, 0),    // East
            (1, 1),    // Southeast
            (0, 1),    // South
            (-1, 1),   // Southwest
            (-1, 0),   // West
            (-1, -1),  // Northwest
            (0, -1),   // North
            (1, -1),   // Northeast
        ];
        
        // Direction codes corresponding to the directions array
        let direction_codes = [
            FlowDirection::East,
            FlowDirection::Southeast,
            FlowDirection::South,
            FlowDirection::Southwest,
            FlowDirection::West,
            FlowDirection::Northwest,
            FlowDirection::North,
            FlowDirection::Northeast,
        ];
        
        // Distance to each neighbor (used for slope calculation)
        // For diagonal neighbors, the distance is √2 * resolution
        // Convert to f32 to match the elevation data type
        let distances = [
            resolution as f32,                          // East
            (resolution * 1.41421356) as f32,           // Southeast (√2)
            resolution as f32,                          // South
            (resolution * 1.41421356) as f32,           // Southwest (√2)
            resolution as f32,                          // West
            (resolution * 1.41421356) as f32,           // Northwest (√2)
            resolution as f32,                          // North
            (resolution * 1.41421356) as f32,           // Northeast (√2)
        ];
        
        // For each cell in the DEM
        for y in 0..height {
            for x in 0..width {
                // Skip if no elevation data or outside boundaries
                if let Some(elev) = self.dem.get_elevation(x, y) {
                    let cell_idx = y * width + x;
                    
                    // Find the steepest downslope neighbor
                    let mut max_slope = 0.0;
                    let mut max_dir = FlowDirection::NoFlow;
                    
                    // Check all 8 neighboring cells
                    for i in 0..8 {
                        let (dx, dy) = directions[i];
                        let nx = x as isize + dx;
                        let ny = y as isize + dy;
                        
                        // Skip if neighbor is outside the DEM
                        if nx < 0 || ny < 0 || nx >= width as isize || ny >= height as isize {
                            continue;
                        }
                        
                        // Get neighbor's elevation (if available)
                        if let Some(n_elev) = self.dem.get_elevation(nx as usize, ny as usize) {
                            // Calculate elevation difference (drop)
                            let drop = elev - n_elev;
                            
                            // Calculate slope (drop / distance)
                            let slope = drop / distances[i];
                            
                            // If this is a steeper downward slope than we've seen, record it
                            if slope > max_slope {
                                max_slope = slope;
                                max_dir = direction_codes[i];
                            }
                        }
                    }
                    
                    // Assign the flow direction and slope
                    self.flow_directions[cell_idx] = max_dir;
                    self.slopes[cell_idx] = max_slope;
                }
            }
        }
        
        println!("Flow direction computation completed");
    }
    
    /// Determine the downstream cell indices for each cell based on flow direction
    pub fn get_downstream_cell(&self, x: usize, y: usize) -> Option<(usize, usize)> {
        if x >= self.dem.width || y >= self.dem.height {
            return None;
        }
        
        let idx = y * self.dem.width + x;
        let dir = self.flow_directions[idx];
        
        // If this cell has no flow, return None
        if dir == FlowDirection::NoFlow {
            return None;
        }
        
        // Get the offset for this direction
        let (dx, dy) = dir.get_offset();
        
        // Calculate the coordinates of the downstream cell
        let nx = x as isize + dx;
        let ny = y as isize + dy;
        
        // Ensure the downstream cell is within bounds
        if nx >= 0 && ny >= 0 && nx < self.dem.width as isize && ny < self.dem.height as isize {
            Some((nx as usize, ny as usize))
        } else {
            None // Flow goes outside the DEM
        }
    }
    
    /// Compute flow accumulation based on flow directions
    pub fn compute_flow_accumulation(&mut self) {
        println!("Computing flow accumulation...");
        
        let width = self.dem.width;
        let height = self.dem.height;
        let cell_count = width * height;
        
        // Initialize flow accumulation: each cell starts with a value of 1 (itself)
        self.flow_accumulation = vec![1.0; cell_count];
        
        // Count incoming connections for each cell (indegree)
        let mut indegree = vec![0; cell_count];
        
        // For each cell, increment indegree of its downstream cell
        for y in 0..height {
            for x in 0..width {
                if let Some((down_x, down_y)) = self.get_downstream_cell(x, y) {
                    let down_idx = down_y * width + down_x;
                    indegree[down_idx] += 1;
                }
            }
        }
        
        // Use a queue to process cells in topological order
        let mut queue = VecDeque::new();
        
        // Start with cells that have no upstream connections (leaf nodes in the flow tree)
        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                if indegree[idx] == 0 && self.dem.get_elevation(x, y).is_some() {
                    queue.push_back((x, y));
                }
            }
        }
        
        // Process cells in topological order
        let mut processed_count = 0;
        while let Some((x, y)) = queue.pop_front() {
            processed_count += 1;
            
            // Find downstream cell and pass accumulation to it
            if let Some((down_x, down_y)) = self.get_downstream_cell(x, y) {
                let down_idx = down_y * width + down_x;
                let current_idx = y * width + x;
                
                // Add the accumulation from current cell to downstream cell
                self.flow_accumulation[down_idx] += self.flow_accumulation[current_idx];
                
                // Decrement indegree of downstream cell
                indegree[down_idx] -= 1;
                
                // If downstream cell has no more upstream cells to process, add it to queue
                if indegree[down_idx] == 0 {
                    queue.push_back((down_x, down_y));
                }
            }
        }
        
        println!("Flow accumulation completed. Processed {} of {} cells", processed_count, cell_count);
    }
    
    /// Extract a stream network using a flow accumulation threshold
    pub fn extract_stream_network(&self, threshold: f32) -> Vec<(usize, usize)> {
        let width = self.dem.width;
        let height = self.dem.height;
        let mut streams = Vec::new();
        
        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                if self.flow_accumulation[idx] >= threshold {
                    streams.push((x, y));
                }
            }
        }
        
        streams
    }
    
    /// Get major streams based on a percentile threshold
    pub fn get_major_streams(&self, percentile: f32) -> Vec<(usize, usize)> {
        // Find the maximum flow accumulation value
        let max_flow = self.flow_accumulation.iter()
            .fold(0.0_f32, |max, &val| max.max(val));
        
        // Calculate threshold as a percentage of maximum flow
        let threshold = max_flow * percentile;
        
        self.extract_stream_network(threshold)
    }
    
    /// Get the slope at a specific point
    pub fn get_slope(&self, x: usize, y: usize) -> Option<f32> {
        if x >= self.dem.width || y >= self.dem.height {
            return None;
        }
        
        let idx = y * self.dem.width + x;
        Some(self.slopes[idx])
    }
    
    /// Get the flow direction at a specific point
    pub fn get_flow_direction(&self, x: usize, y: usize) -> Option<FlowDirection> {
        if x >= self.dem.width || y >= self.dem.height {
            return None;
        }
        
        let idx = y * self.dem.width + x;
        Some(self.flow_directions[idx])
    }
    
    /// Get the flow accumulation at a specific point
    pub fn get_flow_accumulation(&self, x: usize, y: usize) -> Option<f32> {
        if x >= self.dem.width || y >= self.dem.height {
            return None;
        }
        
        let idx = y * self.dem.width + x;
        Some(self.flow_accumulation[idx])
    }
}