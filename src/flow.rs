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
    
    /// Compute D∞ flow directions for each cell
    pub fn compute_flow_directions_dinf(&mut self) {
        let width = self.dem.width;
        let height = self.dem.height;
        let resolution = self.dem.resolution;
        
        // For D∞, we need to store flow angle and proportion
        // Store angle in radians (0-2π) instead of discrete directions
        let mut flow_angles = vec![0.0; width * height];
        
        for y in 1..height-1 {
            for x in 1..width-1 {
                if let Some(elev) = self.dem.get_elevation(x, y) {
                    let idx = y * width + x;
                    
                    // Calculate the steepest downward slope direction by fitting a plane
                    // to the 3x3 window centered on the current cell
                    let mut facets = Vec::new();
                    
                    // For each of the 8 triangular facets around the center
                    for i in 0..8 {
                        let e0 = elev;
                        
                        // Get elevations for the two neighboring points forming the facet
                        let i1 = i;
                        let i2 = (i + 1) % 8;
                        
                        // Convert facet indices to neighbor coordinates
                        let (dx1, dy1) = match i1 {
                            0 => (1, 0),    // E
                            1 => (1, 1),    // SE
                            2 => (0, 1),    // S
                            3 => (-1, 1),   // SW
                            4 => (-1, 0),   // W
                            5 => (-1, -1),  // NW
                            6 => (0, -1),   // N
                            7 => (1, -1),   // NE
                            _ => unreachable!()
                        };
                        
                        let (dx2, dy2) = match i2 {
                            0 => (1, 0),    // E
                            1 => (1, 1),    // SE
                            2 => (0, 1),    // S
                            3 => (-1, 1),   // SW
                            4 => (-1, 0),   // W
                            5 => (-1, -1),  // NW
                            6 => (0, -1),   // N
                            7 => (1, -1),   // NE
                            _ => unreachable!()
                        };
                        
                        // Get neighbor elevations (if available)
                        if let (Some(e1), Some(e2)) = (
                            self.dem.get_elevation((x as isize + dx1) as usize, (y as isize + dy1) as usize),
                            self.dem.get_elevation((x as isize + dx2) as usize, (y as isize + dy2) as usize)
                        ) {
                            // Calculate slope vector components for this facet
                            let sx = (e0 - e1) / (resolution * dx1.abs() as f64) as f32;
                            let sy = (e0 - e2) / (resolution * dy2.abs() as f64) as f32;
                            
                            // Calculate magnitude and direction of slope
                            let s = (sx*sx + sy*sy).sqrt();
                            let d = f32::atan2(sy, sx);
                            
                            // Store facet information if it's downslope
                            if s > 0.0 {
                                facets.push((s, d));
                            }
                        }
                    }
                    
                    // Find the steepest downslope facet
                    if let Some(&(max_slope, flow_direction)) = facets.iter().max_by(|a, b| 
                        a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)) {
                        
                        flow_angles[idx] = flow_direction;
                        self.slopes[idx] = max_slope;
                    }
                }
            }
        }
        
        // Store flow angles and modify downstream processing to use angles
        // instead of discrete directions
        // This would require additional code changes throughout the codebase
    }
    
    /// Compute flow accumulation based on flow directions using MFD method
    pub fn compute_flow_accumulation_mfd(&mut self) {
        let width = self.dem.width;
        let height = self.dem.height;
        let cell_count = width * height;
        
        // Create a matrix to store flow proportions from each cell to its neighbors
        // For each cell, store up to 8 flow proportions (one for each neighbor)
        let mut flow_proportions = vec![vec![0.0; 8]; cell_count];
        
        // Calculate flow proportions for each cell
        for y in 0..height {
            for x in 0..width {
                if let Some(elev) = self.dem.get_elevation(x, y) {
                    let idx = y * width + x;
                    
                    // Get all downslope neighbors and their slopes
                    let mut downslope_neighbors = Vec::new();
                    let directions = [
                        (1, 0), (1, 1), (0, 1), (-1, 1),
                        (-1, 0), (-1, -1), (0, -1), (1, -1)
                    ];
                    
                    let distances = [
                        self.dem.resolution as f32,
                        (2.0 * self.dem.resolution * self.dem.resolution) as f32,
                        self.dem.resolution as f32,
                        (2.0 * self.dem.resolution * self.dem.resolution) as f32,
                        self.dem.resolution as f32,
                        (2.0 * self.dem.resolution * self.dem.resolution) as f32,
                        self.dem.resolution as f32,
                        (2.0 * self.dem.resolution * self.dem.resolution) as f32,
                    ];
                    
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
                            
                            // Only consider downslope neighbors
                            if drop > 0.0 {
                                // Calculate slope (drop / distance)
                                let slope = drop / distances[i];
                                downslope_neighbors.push((i, slope));
                            }
                        }
                    }
                    
                    // Calculate flow proportion for each downslope neighbor
                    // Using Quinn et al. (1991) method with exponent
                    let exponent = 1.1; // Adjustable parameter
                    let total_slope = downslope_neighbors.iter()
                        .map(|(_, slope)| slope.powf(exponent))
                        .sum::<f32>();
                    
                    if total_slope > 0.0 {
                        for (dir_idx, slope) in downslope_neighbors {
                            flow_proportions[idx][dir_idx] = slope.powf(exponent) / total_slope;
                        }
                    }
                }
            }
        }
        
        // Initialize flow accumulation (each cell starts with 1.0)
        self.flow_accumulation = vec![1.0; cell_count];
        
        // Create a copy for the iterative calculation
        let mut new_flow_accumulation = self.flow_accumulation.clone();
        
        // Iterative flow routing until convergence
        for _ in 0..20 { // Run for a fixed number of iterations
            for y in 0..height {
                for x in 0..width {
                    let idx = y * width + x;
                    
                    // Distribute flow to downslope neighbors
                    for dir_idx in 0..8 {
                        let proportion = flow_proportions[idx][dir_idx];
                        if proportion > 0.0 {
                            let (dx, dy) = match dir_idx {
                                0 => (1, 0),    // E
                                1 => (1, 1),    // SE
                                2 => (0, 1),    // S
                                3 => (-1, 1),   // SW
                                4 => (-1, 0),   // W
                                5 => (-1, -1),  // NW
                                6 => (0, -1),   // N
                                7 => (1, -1),   // NE
                                _ => unreachable!()
                            };
                            
                            let nx = x as isize + dx;
                            let ny = y as isize + dy;
                            
                            if nx >= 0 && ny >= 0 && nx < width as isize && ny < height as isize {
                                let n_idx = ny as usize * width + nx as usize;
                                new_flow_accumulation[n_idx] += self.flow_accumulation[idx] * proportion;
                            }
                        }
                    }
                }
            }
            
            // Update the flow accumulation
            self.flow_accumulation = new_flow_accumulation.clone();
            
            // Reset for next iteration (keep the initial 1.0 for each cell)
            new_flow_accumulation = vec![1.0; cell_count];
        }
    }
}