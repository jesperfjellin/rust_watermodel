// Add a version query parameter to force browser to fetch a fresh copy
// This prevents caching of the WASM module
import init, { WaterModel } from './pkg/rust_watermodel.js';
import { TerrainRenderer } from './three_renderer.js';

// Version parameter for cache busting
const WASM_VERSION = '1.4.0';

// Global variables
let waterModel = null;
let renderer = null;
let geotiffWorker = null;

// Initialize the WASM module
init(`./pkg/rust_watermodel_bg.wasm?v=${WASM_VERSION}`).then(() => {
    console.log(`WASM module v${WASM_VERSION} initialized`);
    
    // Create WaterModel instance 
    waterModel = new WaterModel();
    
    // Setup the UI once WASM is loaded
    setupUI();
}).catch(e => {
    console.error("Failed to initialize WASM module:", e);
    document.getElementById('status').textContent = 
        "Error: Failed to initialize WebAssembly module. This app requires WebAssembly support.";
});

// Create the GeoTIFF Web Worker
function createGeotiffWorker() {
    // Create a blob containing the worker script
    const workerScript = `
        // GeoTIFF Worker
        
        // Listen for messages from the main thread
        self.onmessage = async function(e) {
            if (e.data.type === 'parseGeoTIFF') {
                try {
                    // Post updates about progress
                    self.postMessage({ type: 'progress', stage: 'Starting GeoTIFF parsing', progress: 10 });
                    
                    // Load GeoTIFF.js from the main page's scope (dynamic import)
                    self.importScripts('https://cdn.jsdelivr.net/npm/geotiff@2.0.7/dist-browser/geotiff.js');
                    
                    // Post progress update
                    self.postMessage({ type: 'progress', stage: 'Parsing GeoTIFF', progress: 20 });
                    
                    // Parse the GeoTIFF
                    const geotiff = await self.GeoTIFF.fromArrayBuffer(e.data.arrayBuffer);
                    
                    self.postMessage({ type: 'progress', stage: 'Reading image data', progress: 30 });
                    
                    // Get the first image
                    const image = await geotiff.getImage();
                    
                    // Get metadata
                    const width = image.getWidth();
                    const height = image.getHeight();
                    const fileDirectory = image.getFileDirectory();
                    const bands = image.getSamplesPerPixel();
                    
                    self.postMessage({ 
                        type: 'progress', 
                        stage: 'Reading raster data', 
                        progress: 40,
                        details: { width, height, bands }
                    });

                    // Read rasters (the most time-consuming part)
                    const rasters = await image.readRasters();
                    
                    self.postMessage({ 
                        type: 'progress', 
                        stage: 'Raster data loaded', 
                        progress: 90
                    });
                    
                    // Convert raster data to array
                    const elevationData = Array.from(rasters[0]);
                    
                    // Get resolution
                    let resolution = 10; // Default fallback
                    if (fileDirectory.ModelPixelScale) {
                        // Average X and Y resolution
                        resolution = (fileDirectory.ModelPixelScale[0] + fileDirectory.ModelPixelScale[1]) / 2;
                    }

                    // Send the complete data back to the main thread
                    self.postMessage({
                        type: 'complete',
                        data: {
                            width,
                            height,
                            resolution,
                            elevationData
                        }
                    });
                    
                } catch (error) {
                    self.postMessage({ type: 'error', message: error.message });
                }
            }
        };
    `;
    
    // Create a blob URL for the worker script
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    
    // Create the worker
    const worker = new Worker(workerUrl);
    
    return worker;
}

function setupUI() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const status = document.getElementById('status');
    const canvas3d = document.getElementById('canvas3d');
    const instructionsOverlay = document.getElementById('instructionsOverlay');
    
    // Ensure canvas fills the viewport
    canvas3d.style.width = '100%';
    canvas3d.style.height = '100vh';
    canvas3d.style.display = 'block';
    canvas3d.style.margin = '0';
    canvas3d.width = window.innerWidth;
    canvas3d.height = window.innerHeight;
    
    // Create loader element for visual feedback
    const loader = document.createElement('div');
    loader.id = 'progressContainer';
    loader.style.display = 'none';
    loader.style.position = 'absolute';
    loader.style.top = '50%';
    loader.style.left = '50%';
    loader.style.transform = 'translate(-50%, -50%)';
    loader.style.padding = '15px';
    loader.style.background = 'rgba(0, 0, 0, 0.7)';
    loader.style.borderRadius = '5px';
    loader.style.color = 'white';
    loader.style.zIndex = '1000';
    loader.style.textAlign = 'center';
    
    const progressBar = document.createElement('div');
    progressBar.id = 'progressBar';
    progressBar.style.width = '300px';
    progressBar.style.height = '20px';
    progressBar.style.background = '#333';
    progressBar.style.borderRadius = '5px';
    progressBar.style.overflow = 'hidden';
    progressBar.style.marginTop = '10px';
    
    const progressIndicator = document.createElement('div');
    progressIndicator.id = 'progressIndicator';
    progressIndicator.style.width = '0%';
    progressIndicator.style.height = '100%';
    progressIndicator.style.background = 'linear-gradient(to right, #2196F3, #21F3A3)';
    progressIndicator.style.transition = 'width 0.3s ease-in-out';
    
    const progressText = document.createElement('div');
    progressText.id = 'progressText';
    progressText.textContent = 'Processing...';
    
    progressBar.appendChild(progressIndicator);
    loader.appendChild(progressText);
    loader.appendChild(progressBar);
    document.body.appendChild(loader);
    
    // Initialize the TerrainRenderer
    try {
        renderer = new TerrainRenderer(canvas3d);
        
        // Handle window resize
        window.addEventListener('resize', () => {
            canvas3d.width = window.innerWidth;
            canvas3d.height = window.innerHeight;
            renderer.resize();
        });
    } catch (e) {
        console.error("Error initializing renderer:", e);
        status.textContent = "Could not initialize 3D renderer. Please try a different browser.";
        status.style.opacity = '1';
    }
    
    // Setup drag and drop on the main canvas
    canvas3d.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('highlight');
    });
    
    canvas3d.addEventListener('dragleave', () => {
        dropZone.classList.remove('highlight');
    });
    
    canvas3d.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('highlight');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFile(files[0]);
        }
    });
    
    // Setup click to upload
    instructionsOverlay.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processFile(e.target.files[0]);
        }
    });
    
    // Create GeoTIFF worker
    geotiffWorker = createGeotiffWorker();
    
    // Setup worker message handler
    geotiffWorker.onmessage = function(e) {
        const message = e.data;
        
        if (message.type === 'progress') {
            updateProgress(message.stage, message.progress);
        }
        else if (message.type === 'complete') {
            processDEMData(message.data);
        }
        else if (message.type === 'error') {
            handleError(message.message);
        }
    };
}

function updateProgress(stage, percent) {
    const progressContainer = document.getElementById('progressContainer');
    const progressIndicator = document.getElementById('progressIndicator');
    const progressText = document.getElementById('progressText');
    
    if (progressContainer && progressIndicator && progressText) {
        progressContainer.style.display = 'block';
        progressText.textContent = stage;
        progressIndicator.style.width = `${percent}%`;
    }
}

function handleError(message) {
    const status = document.getElementById('status');
    const progressContainer = document.getElementById('progressContainer');
    
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    
    if (status) {
        status.textContent = `Error: ${message}`;
        status.style.opacity = '1';
    }
    
    console.error("Error:", message);
}

function processFile(file) {
    const instructionsOverlay = document.getElementById('instructionsOverlay');
    
    // Hide instructions
    if (instructionsOverlay) {
        instructionsOverlay.style.display = 'none';
    }
    
    // Show status
    updateProgress('Reading file...', 0);
    
    // Read file as ArrayBuffer
    file.arrayBuffer().then(arrayBuffer => {
        // Send the file to the worker for processing
        geotiffWorker.postMessage({
            type: 'parseGeoTIFF',
            arrayBuffer: arrayBuffer
        });
    }).catch(error => {
        handleError(`Failed to read file: ${error.message}`);
    });
}

function processDEMData(data) {
    const { width, height, resolution, elevationData } = data;
    
    try {
        updateProgress('Processing DEM data...', 95);
        
        // Process the DEM data in the Rust model
        waterModel.process_dem_data(
            width,
            height,
            resolution,
            elevationData,
            "fill",  // Fill method
            0.1,     // epsilon value
            10       // max breach depth
        );
        
        // Compute the flow model
        waterModel.compute_flow();
        
        // Get the processed terrain data for visualization
        const terrainData = waterModel.get_terrain_data();
        const dimensions = waterModel.get_dimensions();
        
        // Render the terrain
        if (renderer) {
            renderer.setTerrainData(terrainData, dimensions);
        }
        
        // Hide progress indicator
        const progressContainer = document.getElementById('progressContainer');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        
        // Show success message
        const status = document.getElementById('status');
        status.textContent = 'DEM loaded successfully';
        status.style.opacity = '1';
        
        // Fade out status message after a few seconds
        setTimeout(() => {
            status.style.opacity = '0';
        }, 3000);
        
        // Add reset button
        addResetButton();
    } catch (error) {
        handleError(`Failed to process DEM data: ${error.message}`);
    }
}

function addResetButton() {
    // Create a simple reset button
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.style.position = 'absolute';
    resetBtn.style.bottom = '20px';
    resetBtn.style.right = '20px';
    resetBtn.style.padding = '8px 16px';
    resetBtn.style.background = 'rgba(0, 0, 0, 0.7)';
    resetBtn.style.color = 'white';
    resetBtn.style.border = 'none';
    resetBtn.style.borderRadius = '4px';
    resetBtn.style.cursor = 'pointer';
    resetBtn.style.zIndex = '100';
    
    // Add click handler to reload the page
    resetBtn.addEventListener('click', () => {
        window.location.reload();
    });
    
    document.body.appendChild(resetBtn);
}