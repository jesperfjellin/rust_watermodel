import { TerrainRenderer } from './three_renderer.js';

// Global variables
let renderer = null;
let catchmentIndex = null;
let currentCatchment = null;

// Initialize the viewer
async function initializeViewer() {
    const canvas3d = document.getElementById('canvas3d');
    const status = document.getElementById('status');
    
    // Setup canvas
    canvas3d.style.width = '100%';
    canvas3d.style.height = '100vh';
    canvas3d.style.display = 'block';
    canvas3d.style.margin = '0';
    canvas3d.width = window.innerWidth;
    canvas3d.height = window.innerHeight;
    
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
        return;
    }
    
    // Load catchment index
    await loadCatchmentIndex();
    
    // Setup UI event handlers
    setupUI();
}

// Load the catchment index file
async function loadCatchmentIndex() {
    const status = document.getElementById('status');
    const select = document.getElementById('catchmentSelect');
    
    try {
        status.textContent = 'Loading catchment index...';
        status.style.opacity = '1';
        
        // Load the index file
        const response = await fetch('./precomputed/catchment_index.json');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        catchmentIndex = await response.json();
        
        // Populate the select dropdown
        select.innerHTML = '<option value="">Select a catchment...</option>';
        
        for (const [catchmentId, metadata] of Object.entries(catchmentIndex)) {
            const option = document.createElement('option');
            option.value = catchmentId;
            option.textContent = `${catchmentId} (${metadata.width}x${metadata.height}, ${metadata.resolution}m)`;
            select.appendChild(option);
        }
        
        status.textContent = `Loaded ${Object.keys(catchmentIndex).length} catchments`;
        setTimeout(() => {
            status.style.opacity = '0';
        }, 3000);
        
    } catch (error) {
        console.error('Failed to load catchment index:', error);
        status.textContent = `Error loading catchments: ${error.message}`;
        status.style.opacity = '1';
    }
}

// Setup UI event handlers
function setupUI() {
    const select = document.getElementById('catchmentSelect');
    const loadButton = document.getElementById('loadButton');
    const loader = document.getElementById('loader');
    
    loadButton.addEventListener('click', async () => {
        const selectedCatchment = select.value;
        if (!selectedCatchment) {
            alert('Please select a catchment first');
            return;
        }
        
        await loadCatchment(selectedCatchment);
    });
    
    // Also allow loading on select change
    select.addEventListener('change', async (e) => {
        if (e.target.value) {
            await loadCatchment(e.target.value);
        }
    });
}

// Load a specific catchment
async function loadCatchment(catchmentId) {
    const status = document.getElementById('status');
    const loader = document.getElementById('loader');
    
    try {
        // Show loading state
        loader.style.display = 'block';
        status.textContent = `Loading catchment ${catchmentId}...`;
        status.style.opacity = '1';
        
        // Load the pre-computed data
        const response = await fetch(`./precomputed/${catchmentId}.json`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const jsonText = await response.text();
        
        // Parse the JSON data
        const catchmentData = JSON.parse(jsonText);
        
        // Render the catchment
        renderCatchment(catchmentData);
        
        currentCatchment = catchmentData;
        
        status.textContent = `Catchment ${catchmentId} loaded successfully`;
        setTimeout(() => {
            status.style.opacity = '0';
        }, 3000);
        
    } catch (error) {
        console.error('Failed to load catchment:', error);
        status.textContent = `Error loading catchment: ${error.message}`;
        status.style.opacity = '1';
    } finally {
        loader.style.display = 'none';
    }
}

// No longer needed - we now parse JSON directly in loadCatchment()

// Render the catchment data
function renderCatchment(catchmentData) {
    if (!renderer) {
        console.error('Renderer not initialized');
        return;
    }
    
    console.log('Rendering catchment:', catchmentData.id);
    
    // Convert the pre-computed data to the format expected by the renderer
    const terrainData = catchmentData.terrain.elevation_data;
    const dimensions = [
        catchmentData.metadata.width,
        catchmentData.metadata.height,
        catchmentData.metadata.resolution
    ];
    
    // Set the terrain data
    renderer.setTerrainData(terrainData, dimensions);
    
    // TODO: Add stream visualization
    // TODO: Add water flow visualization
}

// Initialize when page loads
window.addEventListener('load', initializeViewer); 