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
let geotiffWorker = null; // Web Worker for GeoTIFF processing

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

                    // On large files, provide incremental updates during the long process
                    // Unfortunately, GeoTIFF.js doesn't expose progress callbacks for readRasters
                    // So we'll use a timer to update progress periodically during the long operation
                    const pixelCount = width * height;
                    let readingInterval;

                    if (pixelCount > 500000) { // For large files
                        let progressPercent = 40;
                        readingInterval = setInterval(() => {
                            progressPercent += 1;
                            if (progressPercent <= 85) {
                                self.postMessage({ 
                                    type: 'progress', 
                                    stage: 'Reading raster data', 
                                    progress: progressPercent,
                                    details: { estimating: true }
                                });
                            }
                        }, 100);
                    }
                    
                    // Read rasters (the most time-consuming part)
                    const startTime = Date.now();
                    const rasters = await image.readRasters();
                    const endTime = Date.now();
                    
                    // Clear the interval if it was set
                    if (readingInterval) {
                        clearInterval(readingInterval);
                    }
                    
                    self.postMessage({ 
                        type: 'progress', 
                        stage: 'Raster data loaded', 
                        progress: 90,
                        details: { timeMs: endTime - startTime }
                    });
                    
                    // Convert raster data to array
                    const elevationData = Array.from(rasters[0]);
                    
                    // Get resolution
                    let resolution = 10; // Default fallback
                    if (fileDirectory.ModelPixelScale) {
                        // Average X and Y resolution
                        resolution = (fileDirectory.ModelPixelScale[0] + fileDirectory.ModelPixelScale[1]) / 2;
                    }

                    // Send progress update that we're preparing the final data
                    self.postMessage({ 
                        type: 'progress', 
                        stage: 'Preparing elevation data', 
                        progress: 95
                    });
                    
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
        
        // Log when worker starts
        self.postMessage({ type: 'progress', stage: 'GeoTIFF Worker Initialized', progress: 0 });
    `;
    
    // Create a blob URL for the worker script
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    
    // Create the worker
    const worker = new Worker(workerUrl);
    
    return worker;
}

// Default values
const DEFAULT_STREAM_THRESHOLD = 0.01; // 1%
const FILL_SINKS = true;
const DEFAULT_WMS_URL = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/WMSServer";
const DEFAULT_WMS_LAYERS = "0";
const DEFAULT_WMS_WIDTH = 2048;
const DEFAULT_WMS_HEIGHT = 2048;

// Define the processing stages for progress tracking
const PROCESSING_STAGES = [
    "Parsing GeoTIFF",
    "Processing DEM",
    "Computing flow model",
    "Rendering terrain"
];

function setupUI() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const status = document.getElementById('status');
    const loader = document.getElementById('loader');
    const canvas3d = document.getElementById('canvas3d');
    const instructionsOverlay = document.getElementById('instructionsOverlay');
    
    // Create gradient loading bar elements
    const loadingBarContainer = document.createElement('div');
    loadingBarContainer.id = 'loadingBarContainer';
    loadingBarContainer.style.display = 'none';
    loadingBarContainer.style.position = 'absolute';
    loadingBarContainer.style.top = '50%';
    loadingBarContainer.style.left = '50%';
    loadingBarContainer.style.transform = 'translate(-50%, -50%)';
    loadingBarContainer.style.width = '60%';
    loadingBarContainer.style.maxWidth = '500px';
    loadingBarContainer.style.zIndex = '1000';
    loadingBarContainer.style.textAlign = 'center';
    
    const loadingBar = document.createElement('div');
    loadingBar.id = 'loadingBar';
    loadingBar.style.height = '20px';
    loadingBar.style.width = '100%';
    loadingBar.style.position = 'relative';
    loadingBar.style.borderRadius = '10px';
    loadingBar.style.overflow = 'hidden';
    loadingBar.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    
    // Base gradient visible from the start (full width)
    const gradientBase = document.createElement('div');
    gradientBase.style.position = 'absolute';
    gradientBase.style.top = '0';
    gradientBase.style.left = '0';
    gradientBase.style.width = '100%';
    gradientBase.style.height = '100%';
    gradientBase.style.background = 'linear-gradient(to right, rgb(13%, 33%, 8%), rgb(30%, 55%, 15%) 20%, rgb(90%, 70%, 0%) 40%, rgb(90%, 30%, 0%) 60%, rgb(90%, 10%, 10%) 80%, rgb(60%, 0%, 60%) 100%)';
    
    // Overlay that covers the gradient and will be reduced as progress increases
    const progressOverlay = document.createElement('div');
    progressOverlay.id = 'progressOverlay';
    progressOverlay.style.position = 'absolute';
    progressOverlay.style.top = '0';
    progressOverlay.style.right = '0';
    progressOverlay.style.height = '100%';
    progressOverlay.style.width = '100%'; // Start with fully covered
    progressOverlay.style.background = '#444';
    progressOverlay.style.transition = 'width 0.5s ease-in-out';
    
    // Create a pulsing effect container for indeterminate progress
    const pulseEffect = document.createElement('div');
    pulseEffect.id = 'pulseEffect';
    pulseEffect.style.position = 'absolute';
    pulseEffect.style.top = '0';
    pulseEffect.style.left = '0';
    pulseEffect.style.height = '100%';
    pulseEffect.style.width = '100%';
    pulseEffect.style.background = 'linear-gradient(to right, transparent, rgba(255,255,255,0.3), transparent)';
    pulseEffect.style.backgroundSize = '200% 100%';
    pulseEffect.style.display = 'none';
    pulseEffect.style.pointerEvents = 'none';
    
    // Create a scrolling log container instead of a single text line
    const loadingLogContainer = document.createElement('div');
    loadingLogContainer.id = 'loadingLogContainer';
    loadingLogContainer.style.marginTop = '20px';
    loadingLogContainer.style.color = 'white';
    loadingLogContainer.style.fontFamily = 'Arial, sans-serif';
    loadingLogContainer.style.fontSize = '14px';
    loadingLogContainer.style.textAlign = 'center'; // Center the text
    loadingLogContainer.style.height = '80px';
    loadingLogContainer.style.overflowY = 'hidden';
    loadingLogContainer.style.display = 'flex';
    loadingLogContainer.style.flexDirection = 'column-reverse'; // Most recent at top
    loadingLogContainer.style.backgroundColor = '#444'; // Solid matching color to loading bar background
    loadingLogContainer.style.borderRadius = '8px';
    loadingLogContainer.style.padding = '10px 15px 10px 15px'; // Add padding to all sides
    loadingLogContainer.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)'; // Subtle shadow
    
    loadingBar.appendChild(gradientBase);
    loadingBar.appendChild(progressOverlay);
    loadingBar.appendChild(pulseEffect);
    loadingBarContainer.appendChild(loadingBar);
    loadingBarContainer.appendChild(loadingLogContainer);
    document.body.appendChild(loadingBarContainer);
    
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
    
    // Add click handler to instructions overlay
    if (instructionsOverlay) {
        instructionsOverlay.addEventListener('click', () => {
            fileInput.click();
        });
    }
    
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
    
    // Hide the original drop zone since we're using the 3D scene
    dropZone.style.display = 'none';

    // Create Web Worker for GeoTIFF processing
    geotiffWorker = createGeotiffWorker();
    
    // Listen for messages from the worker
    geotiffWorker.onmessage = function(e) {
        const message = e.data;
        
        if (message.type === 'progress') {
            // Update progress based on worker updates
            const stage = message.stage || 'Parsing GeoTIFF';
            const progress = message.progress || 0;
            
            // Get references to the progress elements
            const progressOverlay = document.getElementById('progressOverlay');
            
            // Calculate overall progress (GeoTIFF parsing is the first stage)
            const stageIndex = 0; // GeoTIFF parsing is first stage
            const stageProgress = (stageIndex / PROCESSING_STAGES.length) * 100;
            const nextStageProgress = ((stageIndex + 1) / PROCESSING_STAGES.length) * 100;
            const overallProgress = stageProgress + 
                (nextStageProgress - stageProgress) * (progress / 100);
            
            // Update the progress bar
            if (progressOverlay) {
                progressOverlay.style.width = `${100 - overallProgress}%`;
            }
            
            // Add a log entry with the stage information
            addLogEntry(`${stage}${message.details ? `: ${JSON.stringify(message.details)}` : ''}`, overallProgress);
            
            // Log detailed info
            if (message.details) {
                console.log(`${stage}: `, message.details);
            }
            
            // Toggle pulse animation for the reading raster data phase
            if (stage === 'Reading raster data') {
                togglePulseAnimation(true);
            } else if (stage === 'Raster data loaded') {
                togglePulseAnimation(false);
            }
        }
        else if (message.type === 'complete') {
            // Worker has completed processing
            console.log('GeoTIFF processing complete');
            processDEMData(message.data);
        }
        else if (message.type === 'error') {
            // Handle errors
            console.error('GeoTIFF Worker error:', message.message);
            const status = document.getElementById('status');
            const loadingBarContainer = document.getElementById('loadingBarContainer');
            
            if (status && loadingBarContainer) {
                loadingBarContainer.style.display = 'none';
                status.textContent = `Error: ${message.message || 'Failed to process the file'}`;
                status.style.opacity = '1';
            }
            
            togglePulseAnimation(false);
        }
    };

    // Get controls elements
    const controlsPanel = document.getElementById('controlsPanel');
    const toggleWmsLayerCheckbox = document.getElementById('toggleWmsLayer');
    
    // Set up event handlers for controls
    toggleWmsLayerCheckbox.addEventListener('change', function() {
        if (!renderer) return;
        
        const isVisible = this.checked;
        // If enabling WMS and we don't have it loaded yet, load it
        if (isVisible && !renderer.wmsTexture) {
            loadWmsTexture();
        }
        
        // Toggle visibility
        renderer.toggleWmsVisibility(isVisible);
        
        // Show status message
        showStatus(isVisible ? "Satellite imagery enabled" : "Satellite imagery disabled");
    });
}

async function processFiles(files) {
    const status = document.getElementById('status');
    const loader = document.getElementById('loader');
    const canvas3d = document.getElementById('canvas3d');
    const instructionsOverlay = document.getElementById('instructionsOverlay');
    const loadingBarContainer = document.getElementById('loadingBarContainer');
    const progressOverlay = document.getElementById('progressOverlay');
    
    // Hide instructions overlay
    if (instructionsOverlay) {
        instructionsOverlay.style.display = 'none';
    }
    
    // Hide old loader and show our new gradient loading bar
    loader.style.display = 'none';
    loadingBarContainer.style.display = 'block';
    
    status.textContent = 'Processing GeoTIFF file...';
    status.style.opacity = '0'; // Hide the status text as we'll use the loading bar
    
    // Show initial state of loading bar
    progressOverlay.style.width = '100%'; // Start with no progress
    addLogEntry('Preparing GeoTIFF processing...', 0);
    
    // Function to start/stop the pulse animation
    const togglePulseAnimation = (start) => {
        const pulseEffect = document.getElementById('pulseEffect');
        if (!pulseEffect) return;
        
        if (start) {
            pulseEffect.style.display = 'block';
            pulseEffect.style.animation = 'pulse 2s ease-in-out infinite';
            // Define the animation if it doesn't exist
            if (!document.getElementById('pulseAnimation')) {
                const style = document.createElement('style');
                style.id = 'pulseAnimation';
                style.textContent = `
                @keyframes pulse {
                    0% { background-position: 100% 0; }
                    100% { background-position: -100% 0; }
                }`;
                document.head.appendChild(style);
            }
        } else {
            pulseEffect.style.display = 'none';
            pulseEffect.style.animation = 'none';
        }
    };
    
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
        
        // Read the file as an ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        
        // Send the ArrayBuffer to the Web Worker for processing
        if (!geotiffWorker) {
            geotiffWorker = createGeotiffWorker();
        }
        
        geotiffWorker.postMessage({
            type: 'parseGeoTIFF',
            arrayBuffer: arrayBuffer
        });
        
    } catch (error) {
        console.error('Error processing files:', error);
        loadingBarContainer.style.display = 'none';
        status.textContent = `Error: ${error.message || 'Failed to process the file'}`;
        status.style.opacity = '1';
        togglePulseAnimation(false);
    }
}

// New function to process DEM data once the worker returns
function processDEMData(data) {
    const { width, height, resolution, elevationData } = data;
    const loadingBarContainer = document.getElementById('loadingBarContainer');
    const progressOverlay = document.getElementById('progressOverlay');
    const status = document.getElementById('status');
    
    // Function to update the progress bar with a small delay
    // to ensure the UI gets updated between processing steps
    const updateProgressWithDelay = (stage, progress) => {
        return new Promise(resolve => {
            // Add log entry with stage info
            addLogEntry(stage, progress);
            
            // Force a UI update with requestAnimationFrame
            requestAnimationFrame(() => {
                // Update the progress bar
                progressOverlay.style.width = `${100 - progress}%`;
                
                // Short delay to ensure the UI updates are visible
                setTimeout(resolve, 50);
            });
        });
    };
    
    // Process the DEM data with visible progress updates
    (async function() {
        try {
            // Update progress to the next stage (Processing DEM)
            const stageIndex = 1;
            const stageProgress = (stageIndex / PROCESSING_STAGES.length) * 100;
            await updateProgressWithDelay(PROCESSING_STAGES[stageIndex], stageProgress);
            
            // Process the DEM data in Rust with sinks always filled
            waterModel.process_dem_data(
                width,
                height,
                resolution,
                elevationData,
                "fill", // Use standard fill method
                0.1,    // epsilon value (not used with fill)
                10      // max breach depth (not used with fill)
            );
            
            // Update progress to the next stage (Computing flow model)
            const nextStageIndex = 2;
            const nextStageProgress = (nextStageIndex / PROCESSING_STAGES.length) * 100;
            await updateProgressWithDelay(PROCESSING_STAGES[nextStageIndex], nextStageProgress);
            
            // Compute flow directions and accumulation
            waterModel.compute_flow();
            
            // Update progress to the next stage (Rendering terrain)
            const finalStageIndex = 3;
            const finalStageProgress = (finalStageIndex / PROCESSING_STAGES.length) * 100;
            await updateProgressWithDelay(PROCESSING_STAGES[finalStageIndex], finalStageProgress);
            
            // Render the terrain and flow
            renderTerrain();
            
            // Set progress to 100% and show full gradient
            await updateProgressWithDelay('Complete', 100);
            
            // Wait a moment to show the completed progress bar before hiding
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Hide loader when complete
            loadingBarContainer.style.display = 'none';
            
            // Update status and then fade it out after a few seconds
            status.textContent = 'DEM loaded successfully';
            status.style.opacity = '1';
            setTimeout(() => {
                status.style.opacity = '0';
                // Show a small button to reload/reset
                showResetButton();
            }, 3000);
        } catch (error) {
            console.error('Error processing DEM data:', error);
            loadingBarContainer.style.display = 'none';
            status.textContent = `Error: ${error.message || 'Failed to process DEM data'}`;
            status.style.opacity = '1';
        }
    })();

    // Show the controls panel
    document.getElementById('controlsPanel').style.display = 'block';
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
        // Show instructions overlay again
        const instructionsOverlay = document.getElementById('instructionsOverlay');
        if (instructionsOverlay) {
            instructionsOverlay.style.display = 'block';
        }
        
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
            const streamNetwork = waterModel.get_stream_network(thresholdPercentile, 0);
            renderer.setStreamNetwork(streamNetwork);
        } catch (fallbackError) {
            console.error("Could not get stream network as fallback:", fallbackError);
        }
    }
}

// Helper function to get color for log entries - now returns white
function getColorForProgress(progress) {
    // Return white text color
    return 'white';
}

// Helper function to add a log entry
function addLogEntry(message, progress) {
    const logContainer = document.getElementById('loadingLogContainer');
    if (!logContainer) return;
    
    const entry = document.createElement('div');
    entry.style.color = getColorForProgress(progress);
    entry.style.marginBottom = '4px';
    entry.style.transition = 'opacity 0.3s ease';
    entry.style.opacity = '0';
    entry.style.width = '100%'; // Ensure the div takes full width for centering
    entry.style.textAlign = 'center'; // Center the text within each entry
    entry.style.paddingTop = '4px'; // Add padding to the top of each entry
    entry.style.lineHeight = '1.6'; // Increase line height for better readability
    entry.textContent = message;
    
    // Add to the top of the container
    logContainer.insertBefore(entry, logContainer.firstChild);
    
    // Fade in
    setTimeout(() => {
        entry.style.opacity = '1';
    }, 10);
    
    // Limit the number of entries to keep
    const maxEntries = 5;
    while (logContainer.children.length > maxEntries) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// Add a function to load WMS texture
function loadWmsTexture() {
    if (!renderer || !waterModel) return;
    
    // Since get_geographic_bounds is not available, use estimated bounds based on dimensions
    try {
        const dimensions = waterModel.get_dimensions();
        if (!dimensions || dimensions === null) {
            console.warn("Dimensions not available for WMS");
            showStatus("Unable to load satellite imagery: No dimensions available");
            return;
        }
        
        // Extract width, height, resolution from dimensions
        const [width, height, resolution] = dimensions;
        
        // Create estimated bounds based on dimensions and resolution
        // This assumes the DEM is centered around the origin (0,0)
        // Using a fixed coordinate system for testing (replace with real coordinates if available)
        const bounds = [
            -74.5, // west (longitude)
            40.5,  // south (latitude)
            -73.5, // east (longitude)
            41.5   // north (latitude)
        ];
        
        // Set the bounds in the renderer
        renderer.setGeographicBounds(bounds);
        
        // Load the WMS texture
        const success = renderer.setWmsTexture(
            DEFAULT_WMS_URL, 
            DEFAULT_WMS_LAYERS,
            DEFAULT_WMS_WIDTH,
            DEFAULT_WMS_HEIGHT
        );
        
        if (success) {
            addLogEntry("Loading satellite imagery...", 0);
            showStatus("Loading satellite imagery...");
        } else {
            showStatus("Failed to load satellite imagery");
        }
    } catch (error) {
        console.error("Error loading WMS texture:", error);
        showStatus("Error loading satellite imagery: " + error.message);
    }
}

// ... existing showStatus function or add if missing ...
function showStatus(message, duration = 3000) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.style.opacity = 1;
    
    // Clear any existing timeout
    if (status.fadeTimeout) {
        clearTimeout(status.fadeTimeout);
    }
    
    // Set new timeout to fade out
    status.fadeTimeout = setTimeout(() => {
        status.style.opacity = 0;
    }, duration);
}