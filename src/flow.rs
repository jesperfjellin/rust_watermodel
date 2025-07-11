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
    // D∞ specific data
    pub dinf_flow_angles: Option<Vec<f32>>,  // Flow direction angles in radians (0-2π)
    pub dinf_flow_proportions: Option<Vec<Vec<f32>>>, // Flow proportions to each of 8 neighbors
    pub flow_method: FlowMethod,  // Track which method we're using
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FlowMethod {
    D8,      // Traditional 8-direction flow
    DInf,    // D-infinity continuous flow
    MFD,     // Multiple flow direction
}

impl FlowModel {
    pub fn new(dem: DigitalElevationModel) -> Self {
        let cell_count = dem.width * dem.height;
        
        FlowModel {
            dem,
            flow_directions: vec![FlowDirection::NoFlow; cell_count],
            flow_accumulation: vec![0.0; cell_count],
            slopes: vec![0.0; cell_count],
            dinf_flow_angles: None,
            dinf_flow_proportions: None,
            flow_method: FlowMethod::D8,
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
    /// Works with both D8 and D∞ flow methods
    pub fn get_downstream_cell(&self, x: usize, y: usize) -> Option<(usize, usize)> {
        if x >= self.dem.width || y >= self.dem.height {
            return None;
        }
        
        let idx = y * self.dem.width + x;
        
        match self.flow_method {
            FlowMethod::DInf => {
                // For D∞, find the downstream cell with highest flow proportion
                if let Some(ref flow_proportions) = self.dinf_flow_proportions {
                    let proportions = &flow_proportions[idx];
                    
                    // Direction offsets (matching the proportions array)
                    let directions = [
                        (1, 0),    // 0: East
                        (1, 1),    // 1: Southeast  
                        (0, 1),    // 2: South
                        (-1, 1),   // 3: Southwest
                        (-1, 0),   // 4: West
                        (-1, -1),  // 5: Northwest
                        (0, -1),   // 6: North
                        (1, -1),   // 7: Northeast
                    ];
                    
                    // Find the direction with the highest flow proportion
                    let mut max_proportion = 0.0;
                    let mut best_direction = None;
                    
                    for dir in 0..8 {
                        if proportions[dir] > max_proportion {
                            max_proportion = proportions[dir];
                            let (dx, dy) = directions[dir];
                            let nx = x as isize + dx;
                            let ny = y as isize + dy;
                            
                            // Ensure the downstream cell is within bounds
                            if nx >= 0 && ny >= 0 && nx < self.dem.width as isize && ny < self.dem.height as isize {
                                best_direction = Some((nx as usize, ny as usize));
                            }
                        }
                    }
                    
                    best_direction
                } else {
                    // Fallback to D8 if D∞ data not available
                    self.get_downstream_cell_d8(x, y)
                }
            }
            _ => {
                // For D8 and MFD, use the traditional D8 method
                self.get_downstream_cell_d8(x, y)
            }
        }
    }
    
    /// Traditional D8 downstream cell detection
    fn get_downstream_cell_d8(&self, x: usize, y: usize) -> Option<(usize, usize)> {
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
        match self.flow_method {
            FlowMethod::D8 => self.compute_flow_accumulation_d8(),
            FlowMethod::DInf => self.compute_flow_accumulation_dinf(),
            FlowMethod::MFD => self.compute_flow_accumulation_mfd(),
        }
    }
    
    /// Compute flow accumulation using D8 method (original implementation)
    fn compute_flow_accumulation_d8(&mut self) {
        println!("Computing D8 flow accumulation...");
        
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
        
        println!("D8 flow accumulation completed. Processed {} of {} cells", processed_count, cell_count);
    }
    
    /// Compute flow accumulation using D∞ method with proportional distribution
    fn compute_flow_accumulation_dinf(&mut self) {
        println!("Computing D∞ flow accumulation...");
        
        let width = self.dem.width;
        let height = self.dem.height;
        let cell_count = width * height;
        
        // Get flow proportions (should exist after compute_flow_directions_dinf)
        let flow_proportions = match &self.dinf_flow_proportions {
            Some(props) => props,
            None => {
                println!("Error: D∞ flow proportions not computed. Run compute_flow_directions_dinf first.");
                return;
            }
        };
        
        // Initialize flow accumulation: each cell starts with a value of 1 (itself)
        self.flow_accumulation = vec![1.0; cell_count];
        
        // Direction offsets (matching the proportions array)
        let directions = [
            (1, 0),    // 0: East
            (1, 1),    // 1: Southeast  
            (0, 1),    // 2: South
            (-1, 1),   // 3: Southwest
            (-1, 0),   // 4: West
            (-1, -1),  // 5: Northwest
            (0, -1),   // 6: North
            (1, -1),   // 7: Northeast
        ];
        
        // Count incoming flow proportions for each cell (for ordering)
        let mut incoming_flow = vec![0.0; cell_count];
        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                for dir in 0..8 {
                    let proportion = flow_proportions[idx][dir];
                    if proportion > 0.0 {
                        let (dx, dy) = directions[dir];
                        let nx = x as isize + dx;
                        let ny = y as isize + dy;
                        
                        if nx >= 0 && ny >= 0 && nx < width as isize && ny < height as isize {
                            let downstream_idx = ny as usize * width + nx as usize;
                            incoming_flow[downstream_idx] += proportion;
                        }
                    }
                }
            }
        }
        
        // Process cells from highest to lowest elevation to ensure proper ordering
        let mut cell_elevations: Vec<(usize, usize, f32)> = Vec::new();
        for y in 0..height {
            for x in 0..width {
                if let Some(elev) = self.dem.get_elevation(x, y) {
                    cell_elevations.push((x, y, elev));
                }
            }
        }
        
        // Sort by elevation (highest first)
        cell_elevations.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        
        let mut processed_count = 0;
        
        // Process each cell in elevation order
        for (x, y, _elev) in cell_elevations {
            processed_count += 1;
            let idx = y * width + x;
            
            // Distribute this cell's flow to downstream neighbors according to proportions
            for dir in 0..8 {
                let proportion = flow_proportions[idx][dir];
                if proportion > 0.0 {
                    let (dx, dy) = directions[dir];
                    let nx = x as isize + dx;
                    let ny = y as isize + dy;
                    
                    if nx >= 0 && ny >= 0 && nx < width as isize && ny < height as isize {
                        let downstream_idx = ny as usize * width + nx as usize;
                        
                        // Add proportional flow to downstream cell
                        self.flow_accumulation[downstream_idx] += 
                            self.flow_accumulation[idx] * proportion;
                    }
                }
            }
        }
        
        println!("D∞ flow accumulation completed. Processed {} of {} cells", processed_count, cell_count);
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
    
    /// Compute D∞ flow directions for each cell using Tarboton's method
    pub fn compute_flow_directions_dinf(&mut self) {
        println!("Computing D∞ flow directions...");
        
        let width = self.dem.width;
        let height = self.dem.height;
        let resolution = self.dem.resolution;
        let cell_count = width * height;
        
        // Initialize D∞ data structures
        let mut flow_angles = vec![0.0; cell_count];
        let mut flow_proportions = vec![vec![0.0; 8]; cell_count];
        
        // 8 neighbor directions (matching D8 order)
        let directions = [
            (1, 0),    // 0: East
            (1, 1),    // 1: Southeast  
            (0, 1),    // 2: South
            (-1, 1),   // 3: Southwest
            (-1, 0),   // 4: West
            (-1, -1),  // 5: Northwest
            (0, -1),   // 6: North
            (1, -1),   // 7: Northeast
        ];
        
        // Corresponding angles for each direction (in radians)
        let direction_angles = [
            0.0,                    // 0: East
            std::f32::consts::PI / 4.0,      // 1: Southeast
            std::f32::consts::PI / 2.0,      // 2: South
            3.0 * std::f32::consts::PI / 4.0, // 3: Southwest
            std::f32::consts::PI,            // 4: West
            5.0 * std::f32::consts::PI / 4.0, // 5: Northwest
            3.0 * std::f32::consts::PI / 2.0, // 6: North
            7.0 * std::f32::consts::PI / 4.0, // 7: Northeast
        ];
        
        for y in 0..height {
            for x in 0..width {
                if let Some(elev) = self.dem.get_elevation(x, y) {
                    let idx = y * width + x;
                    
                    // Calculate steepest slope and its direction using planar fitting
                    let mut max_slope = 0.0;
                    let mut best_angle = 0.0;
                    
                    // Check all 8 adjacent cells to find steepest descent
                    for i in 0..8 {
                        let (dx, dy) = directions[i];
                        let nx = x as isize + dx;
                        let ny = y as isize + dy;
                        
                        if nx >= 0 && ny >= 0 && nx < width as isize && ny < height as isize {
                            if let Some(n_elev) = self.dem.get_elevation(nx as usize, ny as usize) {
                                let drop = elev - n_elev;
                                if drop > 0.0 {
                                    // Calculate distance (accounting for diagonals)
                                    let distance = if dx.abs() + dy.abs() == 2 {
                                        resolution * std::f64::consts::SQRT_2 // Diagonal
                                    } else {
                                        resolution // Cardinal
                                    };
                                    
                                    let slope = drop / distance as f32;
                                    if slope > max_slope {
                                        max_slope = slope;
                                        best_angle = direction_angles[i];
                                    }
                                }
                            }
                        }
                    }
                    
                    if max_slope > 0.0 {
                        // Store the continuous flow angle
                        flow_angles[idx] = best_angle;
                        self.slopes[idx] = max_slope;
                        
                        // Calculate flow proportions to adjacent cells
                        // Find which two adjacent directions bracket the flow angle
                        let mut dir1 = 0;
                        let mut dir2 = 1;
                        
                        for i in 0..8 {
                            let next_i = (i + 1) % 8;
                            let angle1 = direction_angles[i];
                            let mut angle2 = direction_angles[next_i];
                            
                            // Handle angle wraparound at 2π
                            if angle2 < angle1 {
                                angle2 += 2.0 * std::f32::consts::PI;
                            }
                            
                            let mut test_angle = best_angle;
                            if test_angle < angle1 {
                                test_angle += 2.0 * std::f32::consts::PI;
                            }
                            
                            if test_angle >= angle1 && test_angle <= angle2 {
                                dir1 = i;
                                dir2 = next_i;
                                break;
                            }
                        }
                        
                        // Calculate proportional flow split between the two directions
                        let angle1 = direction_angles[dir1];
                        let mut angle2 = direction_angles[dir2];
                        if angle2 < angle1 {
                            angle2 += 2.0 * std::f32::consts::PI;
                        }
                        
                        let mut flow_angle = best_angle;
                        if flow_angle < angle1 {
                            flow_angle += 2.0 * std::f32::consts::PI;
                        }
                        
                        // Linear interpolation between the two directions
                        let total_angle_diff = angle2 - angle1;
                        if total_angle_diff > 0.0 {
                            let prop2 = (flow_angle - angle1) / total_angle_diff;
                            let prop1 = 1.0 - prop2;
                            
                            // Ensure both directions are valid (within bounds and downslope)
                            let (dx1, dy1) = directions[dir1];
                            let (dx2, dy2) = directions[dir2];
                            
                            let nx1 = x as isize + dx1;
                            let ny1 = y as isize + dy1;
                            let nx2 = x as isize + dx2;
                            let ny2 = y as isize + dy2;
                            
                            if nx1 >= 0 && ny1 >= 0 && nx1 < width as isize && ny1 < height as isize {
                                if let Some(n_elev1) = self.dem.get_elevation(nx1 as usize, ny1 as usize) {
                                    if elev > n_elev1 {
                                        flow_proportions[idx][dir1] = prop1;
                                    }
                                }
                            }
                            
                            if nx2 >= 0 && ny2 >= 0 && nx2 < width as isize && ny2 < height as isize {
                                if let Some(n_elev2) = self.dem.get_elevation(nx2 as usize, ny2 as usize) {
                                    if elev > n_elev2 {
                                        flow_proportions[idx][dir2] = prop2;
                                    }
                                }
                            }
                        } else {
                            // Angle difference is zero, put all flow in first direction
                            let (dx1, dy1) = directions[dir1];
                            let nx1 = x as isize + dx1;
                            let ny1 = y as isize + dy1;
                            
                            if nx1 >= 0 && ny1 >= 0 && nx1 < width as isize && ny1 < height as isize {
                                if let Some(n_elev1) = self.dem.get_elevation(nx1 as usize, ny1 as usize) {
                                    if elev > n_elev1 {
                                        flow_proportions[idx][dir1] = 1.0;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Store D∞ data and set method
        self.dinf_flow_angles = Some(flow_angles);
        self.dinf_flow_proportions = Some(flow_proportions);
        self.flow_method = FlowMethod::DInf;
        
        println!("D∞ flow direction computation completed");
    }
    
    /// Compute flow accumulation based on flow directions using MFD method
    fn compute_flow_accumulation_mfd(&mut self) {
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
    
    /// Extract a high-quality stream network with minimal downsampling
    /// Returns stream polylines with variable density based on flow accumulation
    pub fn extract_high_quality_streams(&self, threshold_percentile: f32) -> Vec<Vec<(usize, usize)>> {
        let width = self.dem.width;
        let height = self.dem.height;
        
        // Calculate max flow for threshold
        let max_flow = self.flow_accumulation.iter()
            .fold(0.0_f32, |max_val, &val| max_val.max(val));
        
        // Calculate threshold based on percentile
        let threshold = max_flow * threshold_percentile;
        
        println!("Starting high-quality stream extraction with threshold {}", threshold);
        
        // Find all cells above threshold
        let mut stream_cells = Vec::with_capacity(width * height / 100); // Estimate ~1% of cells
        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                if self.flow_accumulation[idx] >= threshold {
                    stream_cells.push((x, y));
                }
            }
        }
        
        println!("Found {} cells above threshold {}", stream_cells.len(), threshold);
        
        // Track visited cells to avoid duplicates
        let mut visited = vec![false; width * height];
        
        // Generate stream polylines with adaptive sampling
        let mut polylines = Vec::new();
        
        // Sort stream cells by flow accumulation (highest first)
        // This ensures we start tracing from the most significant streams
        stream_cells.sort_by(|&(x1, y1), &(x2, y2)| {
            let flow1 = self.flow_accumulation[y1 * width + x1];
            let flow2 = self.flow_accumulation[y2 * width + x2];
            flow2.partial_cmp(&flow1).unwrap_or(std::cmp::Ordering::Equal)
        });
        
        // Process cells in batches 
        let cells_per_batch = 100;
        let mut _total_polylines = 0;
        let mut batch_start = 0;
        
        // Continue processing batches until we run out of cells
        while batch_start < stream_cells.len() {
            let batch_end = (batch_start + cells_per_batch).min(stream_cells.len());
            let current_batch = &stream_cells[batch_start..batch_end];
            
            // Process this batch
            for &(x, y) in current_batch {
                let idx = y * width + x;
                if visited[idx] {
                    continue;
                }
                
                // Start a new polyline from this cell
                let mut polyline = Vec::new();
                let mut current = (x, y);
                
                // Track flow accumulation for adaptive sampling
                let mut last_flow = self.flow_accumulation[idx];
                let mut _last_point_added = true;
                let mut _distance_since_last_point = 0;
                
                // Trace downstream
                loop {
                    let (cx, cy) = current;
                    let current_idx = cy * width + cx;
                    

                    // Mark as visited
                    visited[current_idx] = true;
                    
                    // Get the current flow accumulation
                    let current_flow = self.flow_accumulation[current_idx];
                    
                    // Decide whether to add this point based on:
                    // 1. Flow accumulation change
                    // 2. Distance since last point
                    // 3. Always add first and junction points
                    let flow_change_ratio = if last_flow > 0.0 { 
                        (current_flow - last_flow).abs() / last_flow 
                    } else { 
                        1.0 
                    };
                    
                    let _significant_flow_change = flow_change_ratio > 0.05; // 5% change
                    let _enough_distance = _distance_since_last_point >= 2;  // Reduced from 3 to 2 cells
                    
                    // Always add points to ensure continuous flow lines
                    polyline.push(current);
                    last_flow = current_flow;
                    _last_point_added = true;
                    _distance_since_last_point = 0;
                    
                    // Find the downstream cell to continue tracing
                    if let Some(downstream) = self.get_downstream_cell(cx, cy) {
                        // Continue to downstream cell
                        current = downstream;
                        
                        // Check if we'll go below threshold
                        let downstream_idx = downstream.1 * width + downstream.0;
                        if self.flow_accumulation[downstream_idx] < threshold {
                            // Ensure the very last point *before* dropping below threshold is added
                            polyline.push(downstream); // Add the point that is just below threshold
                            break;
                        }
                    } else {
                        // Ensure the final point (the outlet/sink itself) is added
                        // The current point `(cx, cy)` IS the last point here.
                        // Ensure it was added on the previous iteration or add it now.
                        if !_last_point_added { // If the last loop iteration decided not to add it
                            polyline.push(current);
                        }
                        break;
                    }
                }
                

                // Add the polyline if it has enough points
                if polyline.len() >= 2 {
                    polylines.push(polyline);
                    _total_polylines += 1;
                }
            }
            
            // Move to next batch
            batch_start = batch_end;
        }
        
        #[cfg(target_arch = "wasm32")]
        web_sys::console::log_1(&format!("Generated {} high-quality stream polylines", polylines.len()).into());
        #[cfg(not(target_arch = "wasm32"))]
        println!("Generated {} high-quality stream polylines", polylines.len());
        polylines
    }
    
    /// Extract a hierarchical stream network with multi-level detail
    pub fn extract_hierarchical_streams(&self) -> Vec<(Vec<Vec<(usize, usize)>>, f32)> {
        let _width = self.dem.width;
        let _height = self.dem.height;
        
        // Find the maximum flow accumulation value
        let max_flow = self.flow_accumulation.iter()
            .fold(0.0_f32, |max, &val| max.max(val));
        
        // Define hierarchical thresholds - use only 2 levels for better performance
        // Level 1: Major rivers (5% of max flow) - far fewer streams
        // Level 2: Secondary streams (1% of max flow)
        let thresholds = [
            max_flow * 0.05,  // Level 1 - Only the largest main rivers (5%)
            max_flow * 0.01,  // Level 2 - Significant tributaries (1%)
        ];
        
        let mut hierarchical_streams = Vec::new();
        
        // Process each threshold level with a limit on stream count
        for &threshold in &thresholds {
            // Generate polylines with the current threshold
            let mut polylines = self.extract_high_quality_streams(threshold / max_flow);
            
            // Limit the number of polylines to avoid excessive memory usage
            // Sort by average flow accumulation to keep the most important streams
            polylines.sort_by(|a, b| {
                // Calculate average flow for each polyline
                let avg_flow_a = self.calculate_polyline_importance(&a);
                let avg_flow_b = self.calculate_polyline_importance(&b);
                
                // Sort descending (highest flow first)
                avg_flow_b.partial_cmp(&avg_flow_a).unwrap_or(std::cmp::Ordering::Equal)
            });
            
            // Limit to a reasonable number of streams per level
            let max_streams = 150; // Significantly reduced from potentially thousands
            if polylines.len() > max_streams {
                polylines.truncate(max_streams);
            }
            
            #[cfg(target_arch = "wasm32")]
            web_sys::console::log_1(&format!("Level with threshold {}: kept {} streams (limited from original)", 
                threshold, polylines.len()).into());
            #[cfg(not(target_arch = "wasm32"))]
            println!("Level with threshold {}: kept {} streams (limited from original)", 
                threshold, polylines.len());
            
            // Store the polylines with their importance level (threshold)
            hierarchical_streams.push((polylines, threshold));
        }
        
        #[cfg(target_arch = "wasm32")]
        web_sys::console::log_1(&format!("Generated hierarchical streams with {} levels", hierarchical_streams.len()).into());
        #[cfg(not(target_arch = "wasm32"))]
        println!("Generated hierarchical streams with {} levels", hierarchical_streams.len());
        hierarchical_streams
    }

    // Helper to calculate importance of a polyline based on flow accumulation
    fn calculate_polyline_importance(&self, polyline: &Vec<(usize, usize)>) -> f32 {
        if polyline.is_empty() {
            return 0.0;
        }
        
        let width = self.dem.width;
        let mut total_flow = 0.0;
        
        // Sample just a few points along the polyline to calculate importance
        // This is faster than using every point for sorting
        let num_samples = 3.min(polyline.len());
        let step = polyline.len() / num_samples;
        
        for i in 0..num_samples {
            let idx = i * step;
            if idx < polyline.len() {
                let (x, y) = polyline[idx];
                let flow_idx = y * width + x;
                if flow_idx < self.flow_accumulation.len() {
                    total_flow += self.flow_accumulation[flow_idx];
                }
            }
        }
        
        total_flow / num_samples as f32
    }
}