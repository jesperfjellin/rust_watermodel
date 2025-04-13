import init, { WaterModel } from './pkg/rust_watermodel.js';
import { TerrainRenderer } from './three_renderer.js';
import { LandingScene } from './landing_scene.js';

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
let landingScene = null; // Reference to landing scene

// Default values
const DEFAULT_STREAM_THRESHOLD = 0.01; // 1%
const FILL_SINKS = true;

function setupUI() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const status = document.getElementById('status');
    const loader = document.getElementById('loader');
    const canvas3d = document.getElementById('canvas3d');
    
    console.log("Setting up UI with canvas:", canvas3d);
    
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
    
    // Setup file input - now hidden but activated by clicking on the drop zone
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processFiles(e.target.files);
        }
    });
    
    // Create the WaterModel instance
    waterModel = new WaterModel();
    
    // Make the canvas fill the screen
    canvas3d.style.margin = '0';
    canvas3d.style.width = '100%';
    canvas3d.style.height = '100vh';
    
    // Set initial dimensions explicitly 
    canvas3d.width = window.innerWidth;
    canvas3d.height = window.innerHeight;
    
    // Handle window resize
    window.addEventListener('resize', () => {
        canvas3d.width = window.innerWidth;
        canvas3d.height = window.innerHeight;
        if (landingScene) {
            landingScene.resize();
        }
        if (renderer) {
            renderer.resize();
        }
    });
    
    // Wait for a frame to ensure canvas dimensions are set
    requestAnimationFrame(() => {
        // Initialize the landing scene 
        try {
            landingScene = new LandingScene(canvas3d);
            console.log("LandingScene created successfully");
        } catch (e) {
            console.error("Error creating LandingScene:", e);
            status.textContent = "Error initializing 3D view. Please try reloading the page.";
            status.style.opacity = "1";
        }
    });
    
    // Add drag and drop event listeners to the canvas
    canvas3d.addEventListener('dragover', (e) => {
        e.preventDefault();
        // Add a visual cue that files can be dropped
        status.textContent = 'Drop your GeoTIFF file here';
        status.style.opacity = '1';
    });
    
    canvas3d.addEventListener('dragleave', () => {
        status.style.opacity = '0';
    });
    
    canvas3d.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFiles(files);
        }
    });
    
    // Allow clicking anywhere to open the file browser
    canvas3d.addEventListener('click', () => {
        if (landingScene) { // Only trigger file browser in landing scene
            fileInput.click();
        }
    });
    
    // Hide the original drop zone since we're using the 3D scene
    dropZone.style.display = 'none';
}

async function processFiles(files) {
    const status = document.getElementById('status');
    const loader = document.getElementById('loader');
    const canvas3d = document.getElementById('canvas3d');
    
    // Show loading indicator
    loader.style.display = 'block';
    status.textContent = 'Processing GeoTIFF file...';
    status.style.opacity = '1';
    
    try {
        // Dispose of the landing scene if it exists
        if (landingScene) {
            landingScene.dispose();
            landingScene = null;
        }
        
        // Initialize the 3D renderer if not already done
        if (!renderer) {
            renderer = new TerrainRenderer(canvas3d);
        }
        
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
        
        // Process the DEM data in Rust with sinks always filled
        waterModel.process_dem_data(
            width,
            height,
            resolution,
            elevationData,
            FILL_SINKS // Always fill sinks
        );
        
        // Compute flow directions and accumulation
        status.textContent = 'Computing flow model...';
        waterModel.compute_flow();
        
        // Render the terrain and flow
        status.textContent = 'Rendering terrain...';
        renderTerrain();
        
        // Hide loader
        loader.style.display = 'none';
        
        // Update status and then fade it out after a few seconds
        status.textContent = 'DEM loaded successfully';
        setTimeout(() => {
            status.style.opacity = '0';
            // Show a small button to reload/reset
            showResetButton();
        }, 3000);
        
    } catch (error) {
        console.error('Error processing files:', error);
        loader.style.display = 'none';
        status.textContent = `Error: ${error.message || 'Failed to process the file'}`;
        status.style.opacity = '1';
    }
}

function showResetButton() {
    // Create a tiny reset button
    const resetBtn = document.createElement('button');
    resetBtn.innerText = "Reset";
    resetBtn.style.position = "absolute";
    resetBtn.style.bottom = "20px";
    resetBtn.style.right = "20px";
    resetBtn.style.zIndex = "100";
    resetBtn.style.padding = "5px 10px";
    resetBtn.style.background = "rgba(0,0,0,0.5)";
    resetBtn.style.color = "white";
    resetBtn.style.border = "none";
    resetBtn.style.borderRadius = "5px";
    resetBtn.style.cursor = "pointer";
    
    resetBtn.addEventListener('click', () => {
        // Clean up resources before reloading
        if (landingScene) {
            landingScene.dispose();
            landingScene = null;
        }
        if (renderer) {
            // Clean up terrain renderer if it exists
            renderer = null;
        }
        
        // Reload the page
        window.location.reload();
    });
    
    document.body.appendChild(resetBtn);
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
    
    // Update the stream visualization with fixed 1% threshold
    updateStreamVisualization(DEFAULT_STREAM_THRESHOLD);
    
    // Always enable flow animation
    renderer.toggleFlowAnimation(true);
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