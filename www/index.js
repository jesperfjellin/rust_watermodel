import init, { WaterModel } from './pkg/rust_watermodel.js';
import { TerrainRenderer } from './three_renderer.js';

// Initialize the WASM module
init().then(() => {
    console.log("WASM module initialized");
    setupUI();
}).catch(e => {
    console.error("Failed to initialize WASM module:", e);
    document.getElementById('status').textContent = 
        "Error: Failed to initialize WebAssembly module. This app requires WebAssembly support.";
});

let waterModel = null;
let renderer = null;

function setupUI() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const status = document.getElementById('status');
    const loader = document.getElementById('loader');
    
    // Setup drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('highlight');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('highlight');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('highlight');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFiles(files);
        }
    });
    
    // Setup file input
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processFiles(e.target.files);
        }
    });
    
    // Setup stream threshold slider
    const thresholdSlider = document.getElementById('streamThreshold');
    const thresholdValue = document.getElementById('thresholdValue');
    
    thresholdSlider.addEventListener('input', () => {
        const value = thresholdSlider.value;
        thresholdValue.textContent = `${(value * 100).toFixed(1)}%`;
        
        // Update visualization if we have data
        if (waterModel && renderer) {
            updateStreamVisualization(parseFloat(value));
        }
    });
    
    // Setup water animation controls
    setupWaterControls();
    
    // Create the WaterModel instance
    waterModel = new WaterModel();
    
    // Initialize the 3D renderer
    renderer = new TerrainRenderer(document.getElementById('canvas3d'));
}

function setupWaterControls() {
    // Create water animation controls
    const controlsDiv = document.querySelector('.controls');
    
    // Add water flow toggle and density controls
    const waterControlsHTML = `
        <div class="water-controls">
            <h3>Flow Animation Controls</h3>
            <div>
                <label>
                    <input type="checkbox" id="showFlowAnimation" checked />
                    Show flow animation
                </label>
            </div>
            <div>
                <label>
                    Flow speed:
                    <input type="range" id="flowSpeed" min="0.1" max="3.0" step="0.1" value="1.0" />
                    <span id="speedValue">1.0x</span>
                </label>
            </div>
        </div>
    `;
    
    controlsDiv.insertAdjacentHTML('beforeend', waterControlsHTML);
    
    // Setup event listeners for water controls
    const showFlowCheckbox = document.getElementById('showFlowAnimation');
    const flowSpeedSlider = document.getElementById('flowSpeed');
    const speedValue = document.getElementById('speedValue');
    
    showFlowCheckbox.addEventListener('change', () => {
        if (renderer) {
            renderer.toggleFlowAnimation(showFlowCheckbox.checked);
        }
    });
    
    flowSpeedSlider.addEventListener('input', () => {
        const value = parseFloat(flowSpeedSlider.value);
        speedValue.textContent = `${value.toFixed(1)}x`;
        
        if (renderer) {
            renderer.setFlowSpeed(value);
        }
    });
}

async function processFiles(files) {
    const status = document.getElementById('status');
    const loader = document.getElementById('loader');
    
    // Show loading indicator
    loader.style.display = 'block';
    status.textContent = 'Processing GeoTIFF file...';
    
    try {
        // Process the first file only for now
        const file = files[0];
        
        // Parse the GeoTIFF file using GeoTIFF.js
        status.textContent = 'Parsing GeoTIFF...';
        const arrayBuffer = await file.arrayBuffer();
        // Use GeoTIFF as a global object instead of an imported module
        const geotiff = await window.GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await geotiff.getImage();
        const rasters = await image.readRasters();
        
        // Get dimensions and metadata
        const width = image.getWidth();
        const height = image.getHeight();
        
        // Try to get resolution from the GeoTIFF
        let resolution = 10; // Default fallback
        const fileDirectory = image.getFileDirectory();
        if (fileDirectory.ModelPixelScale) {
            // Average X and Y resolution
            resolution = (fileDirectory.ModelPixelScale[0] + fileDirectory.ModelPixelScale[1]) / 2;
        }
        
        // Convert raster data to the format expected by Rust
        // Usually, first band contains elevation data
        const elevationData = Array.from(rasters[0]);
        
        status.textContent = 'Processing DEM...';
        
        // Process the DEM data in Rust
        waterModel.process_dem_data(
            width,
            height,
            resolution,
            elevationData,
            document.getElementById('fillSinks').checked
        );
        
        // Compute flow directions and accumulation
        status.textContent = 'Computing flow model...';
        waterModel.compute_flow();
        
        // Render the terrain and flow
        status.textContent = 'Rendering terrain...';
        renderTerrain();
        
        // Hide loader
        loader.style.display = 'none';
        status.textContent = 'DEM loaded and processed successfully!';
    } catch (error) {
        console.error('Error processing files:', error);
        loader.style.display = 'none';
        status.textContent = `Error: ${error.message || 'Failed to process the file'}`;
    }
}

function renderTerrain() {
    if (!waterModel || !renderer) return;
    
    // Get the terrain data
    const terrainData = waterModel.get_terrain_data();
    const dimensions = waterModel.get_dimensions();
    
    // Set terrain in the renderer
    renderer.setTerrainData(terrainData, dimensions);
    
    // Get enhanced water visualization data
    try {
        const waterData = waterModel.get_water_visualization_data();
        renderer.setWaterVisualizationData(waterData);
    } catch (error) {
        console.error("Could not get water visualization data:", error);
    }
    
    // Get slope data
    try {
        const slopeData = waterModel.get_slope_data();
        renderer.setSlopeData(slopeData);
    } catch (error) {
        console.error("Could not get slope data:", error);
    }
    
    // Get stream spawn points
    try {
        const spawnPoints = waterModel.get_stream_spawn_points();
        renderer.setStreamSpawnPoints(spawnPoints);
    } catch (error) {
        console.error("Could not get stream spawn points:", error);
    }
    
    // Update the stream visualization
    const thresholdValue = parseFloat(document.getElementById('streamThreshold').value);
    updateStreamVisualization(thresholdValue);
}

function updateStreamVisualization(thresholdPercentile) {
    if (!waterModel || !renderer) return;
    
    // Get detailed stream polylines
    try {
        const streamPolylines = waterModel.get_stream_polylines(thresholdPercentile);
        renderer.setStreamPolylines(streamPolylines);
    } catch (error) {
        console.error("Could not get stream polylines:", error);
        
        // Fall back to simpler stream representation
        try {
            const streamNetwork = waterModel.get_stream_network(thresholdPercentile);
            renderer.setStreamNetwork(streamNetwork);
        } catch (fallbackError) {
            console.error("Could not get stream network as fallback:", fallbackError);
        }
    }
}