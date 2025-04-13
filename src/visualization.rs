use crate::flow::FlowModel;
use crate::flow::FlowDirection;
use serde::{Serialize, Deserialize};

/// Data structure for particle-based water flow visualization
#[derive(Serialize, Deserialize)]
pub struct WaterFlowVisualizationData {
    /// Width of the DEM grid
    pub width: usize,
    /// Height of the DEM grid
    pub height: usize,
    /// Flow accumulation values
    pub flow_accumulation: Vec<f32>,
    /// Slope values for each cell
    pub slopes: Vec<f32>,
    /// Flow velocity vectors for each cell (x, y components - 2 values per cell)
    pub velocities: Vec<f32>,
    /// Suggested particle spawn points (x, y coordinates) for high-flow areas
    pub spawn_points: Vec<(usize, usize)>,
}

impl WaterFlowVisualizationData {
    /// Create a new empty visualization data object
    pub fn new(width: usize, height: usize) -> Self {
        let size = width * height;
        WaterFlowVisualizationData {
            width,
            height,
            flow_accumulation: vec![0.0; size],
            slopes: vec![0.0; size],
            velocities: vec![0.0; size * 2], // Two values (x, y) per grid cell
            spawn_points: Vec::new(),
        }
    }
}

/// Generate visualization data from the flow model
pub fn generate_visualization_data(flow_model: &FlowModel) -> WaterFlowVisualizationData {
    println!("Generating visualization data...");
    
    let width = flow_model.dem.width;
    let height = flow_model.dem.height;
    
    // Initialize visualization data
    let mut viz_data = WaterFlowVisualizationData::new(width, height);
    
    // Copy flow accumulation data
    viz_data.flow_accumulation.copy_from_slice(&flow_model.flow_accumulation);
    
    // Copy slope data
    viz_data.slopes.copy_from_slice(&flow_model.slopes);
    
    // Calculate max flow accumulation for normalization
    let max_flow = flow_model.flow_accumulation.iter()
        .fold(0.0_f32, |max_val, &val| max_val.max(val));
    
    // Threshold for identifying major streams (top 1% of flow)
    let stream_threshold = max_flow * 0.01;
    
    // Calculate flow velocities and identify spawn points
    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            let vel_idx = idx * 2; // Index into the velocities array (2 values per cell)
            
            // Skip no-data cells
            if flow_model.dem.get_elevation(x, y).is_none() {
                viz_data.velocities[vel_idx] = 0.0;     // x-component
                viz_data.velocities[vel_idx + 1] = 0.0; // y-component
                continue;
            }
            
            // Get slope and flow values
            let slope = flow_model.slopes[idx];
            let flow = flow_model.flow_accumulation[idx];
            
            // Get flow direction to determine velocity vector components
            let direction = flow_model.flow_directions[idx];
            
            // Convert direction to offsets
            let (dx, dy) = direction.get_offset();
            
            // Convert offsets to unit vector
            let length = ((dx * dx + dy * dy) as f32).sqrt();
            let (dx_norm, dy_norm) = if length > 0.0 {
                (dx as f32 / length, dy as f32 / length)
            } else {
                (0.0, 0.0)
            };
            
            // Calculate velocity magnitude based on a simplified velocity = f(slope, flow) model
            // This is an approximation of Manning's equation for water velocity
            let velocity_magnitude = if slope > 0.0 && flow > 1.0 {
                // Base velocity on slope (steeper = faster)
                let slope_factor = slope.powf(0.5);
                
                // Flow factor (more flow = higher velocity due to hydraulic radius)
                let flow_factor = (flow / max_flow).powf(0.4);
                
                // Combine factors - this is a simplified model, not physically accurate
                slope_factor * flow_factor * 10.0 // Scale factor
            } else {
                0.0
            };
            
            // Set velocity vector components
            viz_data.velocities[vel_idx] = dx_norm * velocity_magnitude;     // x-component
            viz_data.velocities[vel_idx + 1] = dy_norm * velocity_magnitude; // y-component
            
            // Check if this is a significant stream cell
            if flow > stream_threshold {
                // Get flow direction to ensure this isn't the beginning of a stream
                let dir = flow_model.flow_directions[idx];
                
                // Only add if not a sink or boundary
                if dir != FlowDirection::NoFlow {
                    // Sample upstream cells to check if this is a junction or main channel
                    let is_significant = is_stream_feature(flow_model, x, y);
                    
                    if is_significant {
                        viz_data.spawn_points.push((x, y));
                    }
                }
            }
        }
    }
    
    // Limit the number of spawn points to avoid overwhelming the renderer
    if viz_data.spawn_points.len() > 1000 {
        // Sort by flow accumulation (highest first)
        let mut sorted_points = viz_data.spawn_points.clone();
        sorted_points.sort_by(|&(x1, y1), &(x2, y2)| {
            let flow1 = flow_model.flow_accumulation[y1 * width + x1];
            let flow2 = flow_model.flow_accumulation[y2 * width + x2];
            flow2.partial_cmp(&flow1).unwrap_or(std::cmp::Ordering::Equal)
        });
        
        // Keep only the top 1000 points
        viz_data.spawn_points = sorted_points.into_iter().take(1000).collect();
    }
    
    println!("Generated visualization data with {} spawn points", viz_data.spawn_points.len());
    viz_data
}

/// Determine if a cell is a significant stream feature (e.g., junction or main channel)
fn is_stream_feature(flow_model: &FlowModel, x: usize, y: usize) -> bool {
    let width = flow_model.dem.width;
    let height = flow_model.dem.height;
    let idx = y * width + x;
    let cell_flow = flow_model.flow_accumulation[idx];
    
    // Check all 8 neighbors
    let neighbors = [
        (1, 0),    // East
        (1, 1),    // Southeast
        (0, 1),    // South
        (-1, 1),   // Southwest
        (-1, 0),   // West
        (-1, -1),  // Northwest
        (0, -1),   // North
        (1, -1),   // Northeast
    ];
    
    // Count neighbors with significant flow
    let mut inflow_count = 0;
    let mut max_inflow: f32 = 0.0;
    
    for &(dx, dy) in &neighbors {
        let nx = x as isize + dx;
        let ny = y as isize + dy;
        
        // Skip if outside bounds
        if nx < 0 || ny < 0 || nx >= width as isize || ny >= height as isize {
            continue;
        }
        
        let nx = nx as usize;
        let ny = ny as usize;
        let n_idx = ny * width + nx;
        
        // Get flow and direction of this neighbor
        let n_flow = flow_model.flow_accumulation[n_idx];
        let n_dir = flow_model.flow_directions[n_idx];
        
        // Calculate offset from neighbor's flow direction
        let (flow_dx, flow_dy) = n_dir.get_offset();
        
        // Check if this neighbor flows into our cell
        if nx as isize + flow_dx == x as isize && ny as isize + flow_dy == y as isize {
            inflow_count += 1;
            max_inflow = max_inflow.max(n_flow);
        }
    }
    
    // Cases where we want to add a spawn point:
    // 1. Stream junction (multiple inflows)
    // 2. Main channel (high flow)
    // 3. Every ~20 cells along a stream to ensure sufficient density
    inflow_count > 1 || 
    max_inflow > cell_flow * 0.8 || 
    (x + y) % 20 == 0
}

/// Generate a list of stream polylines for visualization
pub fn generate_stream_network(flow_model: &FlowModel, threshold_percentile: f32, smooth_iterations: usize) -> Vec<Vec<(usize, usize)>> {
    println!("Generating stream network with threshold {}", threshold_percentile);
    
    let width = flow_model.dem.width;
    let height = flow_model.dem.height;
    
    // Calculate max flow accumulation
    let max_flow = flow_model.flow_accumulation.iter()
        .fold(0.0_f32, |max_val, &val| max_val.max(val));
    
    // Calculate threshold
    let threshold = max_flow * threshold_percentile;
    
    // Find all cells above threshold
    let mut stream_cells = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            if flow_model.flow_accumulation[idx] >= threshold {
                stream_cells.push((x, y));
            }
        }
    }
    
    println!("Found {} cells above threshold", stream_cells.len());
    
    // Track visited cells to avoid duplicates
    let mut visited = vec![false; width * height];
    
    // Generate stream polylines
    let mut polylines = Vec::new();
    
    for &(x, y) in &stream_cells {
        let idx = y * width + x;
        if visited[idx] {
            continue;
        }
        
        // Start a new polyline from this cell
        let mut polyline = Vec::new();
        let mut current = (x, y);
        
        // Trace downstream
        loop {
            let (cx, cy) = current;
            let idx = cy * width + cx;
            
            // Mark as visited
            visited[idx] = true;
            
            // Add to polyline
            polyline.push((cx, cy));
            
            // Find downstream cell
            if let Some(downstream) = flow_model.get_downstream_cell(cx, cy) {
                let (dx, dy) = downstream;
                let d_idx = dy * width + dx;
                
                // Stop if downstream is already visited or below threshold
                if visited[d_idx] || flow_model.flow_accumulation[d_idx] < threshold {
                    break;
                }
                
                current = downstream;
            } else {
                // End of stream
                break;
            }
        }
        
        // Only add if polyline has at least 2 points
        if polyline.len() >= 2 {
            polylines.push(polyline);
        }
    }
    
    println!("Generated {} stream polylines", polylines.len());
    
    // Add smoothing step at the end
    let mut polylines = polylines;
    
    // Apply smoothing if iterations > 0
    if smooth_iterations > 0 {
        smooth_stream_polylines(&mut polylines, smooth_iterations);
    }
    
    polylines
}

pub fn smooth_stream_polylines(polylines: &mut Vec<Vec<(usize, usize)>>, iterations: usize) {
    for polyline in polylines.iter_mut() {
        if polyline.len() < 3 {
            continue;  // Too short to smooth
        }
        
        for _ in 0..iterations {
            let original = polyline.clone();
            let mut smoothed = Vec::with_capacity(original.len() * 2 - 2);
            
            // Add first point
            smoothed.push(original[0]);
            
            // Apply Chaikin's algorithm for corner cutting
            for i in 0..original.len() - 1 {
                let p0 = original[i];
                let p1 = original[i + 1];
                
                // Generate two points at 1/4 and 3/4 between each pair
                let q = (
                    p0.0 * 3 / 4 + p1.0 / 4,
                    p0.1 * 3 / 4 + p1.1 / 4
                );
                let r = (
                    p0.0 / 4 + p1.0 * 3 / 4,
                    p0.1 / 4 + p1.1 * 3 / 4
                );
                
                smoothed.push(q);
                smoothed.push(r);
            }
            
            // Add last point
            smoothed.push(original[original.len() - 1]);
            
            // Update the polyline
            *polyline = smoothed;
        }
    }
}