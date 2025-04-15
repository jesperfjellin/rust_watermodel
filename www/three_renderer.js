import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class TerrainRenderer {
    constructor(canvas) {
        // Basic properties
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.terrainMesh = null;
        this.gridHelper = null;
        this.legendElement = null;
        this.rawTerrainData = null;
        this.terrainScale = 1.0;
        this.heightScale = 1.0;
        
        // Initialize the 3D components
        this.init();
    }
    
    init() {
        try {
            // Create scene with light background as in original renderer
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0xf0f0f0);
            
            // Create camera with reasonable defaults
            this.camera = new THREE.PerspectiveCamera(
                45, 
                this.canvas.clientWidth / this.canvas.clientHeight,
                0.1, 
                100000
            );
            
            // Start with camera positioned as in original renderer
            this.camera.position.set(0, 200, 400);
            this.camera.lookAt(0, 0, 0);
            
            // Create renderer with settings from original
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: true
            });
            this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
            this.renderer.shadowMap.enabled = true;
            
            // Add orbit controls for camera manipulation with original damping
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.25;
            
            // Add enhanced lighting from original renderer
            this.addLights();
            
            // Add a helper grid for reference
            this.gridHelper = new THREE.GridHelper(1000, 10);
            this.scene.add(this.gridHelper);
            
            // Add axes helper to show X, Y, Z directions
            const axesHelper = new THREE.AxesHelper(100);
            this.scene.add(axesHelper);
            
            // Start animation loop
            this.animate();
            
            console.log("TerrainRenderer initialized successfully");
        } catch (error) {
            console.error("Failed to initialize TerrainRenderer:", error);
        }
    }
    
    addLights() {
        // Add ambient light (soft overall illumination)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);
        
        // Add directional light (sun-like)
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(100, 100, 50);
        dirLight.castShadow = true;
        
        // Configure shadows for better quality
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 500;
        dirLight.shadow.bias = -0.001;
        
        // Set up shadow camera frustum to cover terrain
        const shadowExtent = 300;
        dirLight.shadow.camera.left = -shadowExtent;
        dirLight.shadow.camera.right = shadowExtent;
        dirLight.shadow.camera.top = shadowExtent;
        dirLight.shadow.camera.bottom = -shadowExtent;
        
        this.scene.add(dirLight);
        
        // Add a secondary directional light from another angle for more definition
        const secondaryLight = new THREE.DirectionalLight(0xf0e0c0, 0.4); // Warm secondary light
        secondaryLight.position.set(-50, 40, -50);
        this.scene.add(secondaryLight);
    }
    
    animate() {
        if (!this.renderer) return;
        
        requestAnimationFrame(() => this.animate());
        
        if (this.controls) {
            this.controls.update();
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    resize() {
        if (!this.camera || !this.renderer) return;
        
        this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    }
    
    setTerrainData(terrainData, dimensions) {
        // Store dimensions and raw data as in original renderer
        this.dimensions = dimensions;
        this.rawTerrainData = terrainData;
        
        const [width, height, resolution] = dimensions;
        
        console.log(`Setting terrain data: ${width}x${height}, resolution: ${resolution}`);
        
        // Calculate scale factor using original renderer's logic
        // Use more moderate scaling for better visual quality as in original
        let scaleDown;
        if (Math.max(width, height) > 5000) {
            scaleDown = 0.3; // Larger value than our previous code
        } else if (Math.max(width, height) > 3000) {
            scaleDown = 0.4;
        } else if (Math.max(width, height) > 1000) {
            scaleDown = 0.6;
        } else {
            scaleDown = 1.0; // No reduction for small DEMs
        }
        
        console.log(`Using scale factor: ${scaleDown} for terrain of size ${width}x${height}`);
        
        // Store scale for use in other methods as in original
        this.terrainScale = scaleDown;
        
        // Clear any existing terrain
        if (this.terrainMesh) {
            this.scene.remove(this.terrainMesh);
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.material.dispose();
            this.terrainMesh = null;
        }
        
        // Create simplified high-quality terrain similar to original
        this.createSimpleTerrain(terrainData, width, height, resolution, scaleDown);
    }
    
    createSimpleTerrain(terrainData, width, height, resolution, scaleDown) {
        // Follow original logic for detail level calculation
        const maxVerticesPerDimension = 1600;
        
        // Calculate how many vertices to use based on DEM size
        let meshWidth = width;
        let meshHeight = height;
        let skipFactor = 1;
        
        // If DEM is too large, calculate a skip factor to reduce resolution
        // using the original's more aggressive approach
        if (width > maxVerticesPerDimension || height > maxVerticesPerDimension) {
            skipFactor = Math.max(1, Math.ceil(Math.max(width, height) / maxVerticesPerDimension));
            // For very large DEMs, try to use more vertices than before as in original
            if (skipFactor > 3) {
                skipFactor = Math.floor(skipFactor * 0.75);
            }
            
            meshWidth = Math.floor(width / skipFactor);
            meshHeight = Math.floor(height / skipFactor);
            console.log(`DEM too large for WebGL, using ${meshWidth}x${meshHeight} vertices with skip factor ${skipFactor}`);
        }
        
        // Store metadata for stream line height calculations as in original
        this.terrainMetadata = {
            skipFactor: skipFactor,
            meshWidth: meshWidth,
            meshHeight: meshHeight
        };
        
        // Create terrain geometry with scaled dimensions
        const geometry = new THREE.PlaneGeometry(
            width * resolution * scaleDown,
            height * resolution * scaleDown,
            meshWidth,
            meshHeight
        );
        
        // Find elevation range for proper scaling
        let minHeight = Infinity;
        let maxHeight = -Infinity;
        let validElevations = [];
        
        // First pass: collect valid elevations (no negatives, as required)
        for (let y = 0; y < height; y += skipFactor) {
            for (let x = 0; x < width; x += skipFactor) {
                const index = y * width + x;
                const elevation = terrainData[index];
                
                // Only consider valid elevations (not NaN or negative) as in original
                if (!isNaN(elevation) && elevation >= 0) {
                    validElevations.push(elevation);
                    minHeight = Math.min(minHeight, elevation);
                    maxHeight = Math.max(maxHeight, elevation);
                }
            }
        }
        
        // Calculate average elevation from valid values as in original
        let avgElevation = 0;
        if (validElevations.length > 0) {
            avgElevation = validElevations.reduce((a, b) => a + b, 0) / validElevations.length;
        } else {
            // Fallback if no valid elevations found
            avgElevation = 0;
            minHeight = 0;
            maxHeight = 1;
        }
        
        console.log(`Terrain elevation range: ${minHeight} to ${maxHeight}`);
        console.log(`Average elevation: ${avgElevation}`);
        
        // Use original renderer's height scale calculation
        const heightScale = (3.0 - skipFactor * 0.1) * scaleDown;
        this.heightScale = heightScale;
        
        console.log(`Using height scale: ${heightScale}`);
        
        // Create colors array for vertex coloring
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        
        // Set elevations and colors using original approach
        for (let y = 0; y < meshHeight + 1; y++) {
            for (let x = 0; x < meshWidth + 1; x++) {
                // Map mesh coordinates to original DEM coordinates
                const demX = Math.min(width - 1, x * skipFactor);
                const demY = Math.min(height - 1, y * skipFactor);
                const demIndex = demY * width + demX;
                const vertexIndex = y * (meshWidth + 1) + x;
                
                if (vertexIndex >= geometry.attributes.position.count) continue;
                
                // Get elevation and filter out invalid values as in original
                let elevation = terrainData[demIndex];
                
                // Critical: If invalid elevation (negative or NaN), use slightly below minHeight as in original
                if (isNaN(elevation) || elevation < 0) {
                    // Instead of rendering, set clearly below valid terrain to avoid render
                    elevation = minHeight - 10;
                }
                
                // Set Z value for this vertex with height exaggeration
                geometry.attributes.position.setZ(vertexIndex, elevation * heightScale);
                
                // Set vertex color based on elevation using original gradient
                const i3 = vertexIndex * 3;
                
                // Skip coloring for negative/invalid elevations (will not be visible)
                if (elevation <= 0.0) {
                    // Neutral gray for elevation 0.0
                    colors[i3] = 0.5;     // R
                    colors[i3 + 1] = 0.5; // G
                    colors[i3 + 2] = 0.5; // B
                } else {
                    // Create a gradient for elevation values using original gradient
                    // Normalize elevation within range
                    const normalizedHeight = Math.max(0.1, Math.min(1.0, (elevation - minHeight) / (maxHeight - minHeight)));
                    
                    // Improved color gradient code from original renderer
                    if (normalizedHeight < 0.2) {
                        // Forest green to olive green (0.1-0.2)
                        const t = normalizedHeight / 0.2;
                        colors[i3] = 0.13 + t * 0.17;    // R: 0.13 to 0.3
                        colors[i3 + 1] = 0.33 + t * 0.22; // G: 0.33 to 0.55
                        colors[i3 + 2] = 0.08 + t * 0.07; // B: 0.08 to 0.15
                    } else if (normalizedHeight < 0.4) {
                        // Olive green to yellow (0.2-0.4)
                        const t = (normalizedHeight - 0.2) / 0.2;
                        colors[i3] = 0.3 + t * 0.6;      // R: 0.3 to 0.9
                        colors[i3 + 1] = 0.55 + t * 0.15; // G: 0.55 to 0.7
                        colors[i3 + 2] = 0.15 - t * 0.15; // B: 0.15 to 0.0
                    } else if (normalizedHeight < 0.6) {
                        // Yellow to orange (0.4-0.6)
                        const t = (normalizedHeight - 0.4) / 0.2;
                        colors[i3] = 0.9;               // R: 0.9 to 0.9
                        colors[i3 + 1] = 0.7 - t * 0.4; // G: 0.7 to 0.3
                        colors[i3 + 2] = 0.0;           // B: 0 to 0
                    } else if (normalizedHeight < 0.8) {
                        // Orange to red (0.6-0.8)
                        const t = (normalizedHeight - 0.6) / 0.2;
                        colors[i3] = 0.9;               // R: 0.9 to 0.9
                        colors[i3 + 1] = 0.3 - t * 0.2; // G: 0.3 to 0.1
                        colors[i3 + 2] = 0.0 + t * 0.1; // B: 0 to 0.1
                    } else {
                        // Red to purple (0.8-1.0)
                        const t = (normalizedHeight - 0.8) / 0.2;
                        colors[i3] = 0.9 - t * 0.3;     // R: 0.9 to 0.6
                        colors[i3 + 1] = 0.1 - t * 0.1; // G: 0.1 to 0
                        colors[i3 + 2] = 0.1 + t * 0.5; // B: 0.1 to 0.6
                    }
                }
            }
        }
        
        // Add color attribute to geometry
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        // Update the geometry
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        
        // Create original renderer's material
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            metalness: 0.0,
            roughness: 0.7,
            side: THREE.DoubleSide,
        });
        
        // Create mesh
        this.terrainMesh = new THREE.Mesh(geometry, material);
        this.terrainMesh.rotation.x = -Math.PI / 2; // Rotate to be horizontal
        this.terrainMesh.receiveShadow = true;
        
        // Add to scene
        this.scene.add(this.terrainMesh);
        
        // Create elevation legend
        this.createElevationLegend(minHeight, maxHeight);
        
        // Setup camera using original positioning logic
        this.setupCamera(width, height, resolution, scaleDown);
    }
    
    // Setup camera as in original renderer
    setupCamera(width, height, resolution, scaleDown) {
        // Calculate terrain dimensions
        const terrainWidth = width * resolution * scaleDown;
        const terrainHeight = height * resolution * scaleDown;
        const terrainSize = Math.max(terrainWidth, terrainHeight);
        
        // Set camera position to view the entire terrain
        // Using original renderer's positioning approach
        const cameraHeight = terrainSize * 0.8;
        const cameraDistance = terrainSize * 0.7;
        
        this.camera.position.set(0, cameraHeight, cameraDistance);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        
        // Log camera information
        console.log("Camera positioned at:", this.camera.position);
        console.log("Looking at target:", this.controls.target);
        console.log("Terrain dimensions:", width, "x", height);
        console.log("Scale factor applied:", scaleDown);
    }
    
    // Create elevation legend from original renderer
    createElevationLegend(minHeight, maxHeight) {
        // Remove existing legend if any
        if (this.legendElement) {
            document.body.removeChild(this.legendElement);
        }
        
        // Create legend container
        const legend = document.createElement('div');
        legend.className = 'elevation-legend';
        legend.style.position = 'absolute';
        legend.style.left = '20px';
        legend.style.bottom = '20px';
        legend.style.width = '60px';
        legend.style.background = 'transparent';
        legend.style.padding = '10px';
        legend.style.zIndex = '1000';
        legend.style.pointerEvents = 'none'; // So it doesn't interfere with orbit controls
        
        // Create gradient bar
        const gradientBar = document.createElement('div');
        gradientBar.style.width = '30px';
        gradientBar.style.height = '200px';
        gradientBar.style.margin = '0 auto';
        gradientBar.style.position = 'relative';
        
        // Create the color gradient matching the terrain colors
        let gradientColors = '';
        gradientColors += 'linear-gradient(to top,';
        gradientColors += ' rgb(33, 84, 20) 0%,';    // Forest green
        gradientColors += ' rgb(77, 140, 38) 20%,';   // Olive green
        gradientColors += ' rgb(230, 179, 0) 40%,';   // Yellow
        gradientColors += ' rgb(230, 76, 0) 60%,';    // Orange
        gradientColors += ' rgb(230, 25, 25) 80%,';   // Red
        gradientColors += ' rgb(60, 0, 153) 100%)';   // Purple (highest)
        
        gradientBar.style.background = gradientColors;
        legend.appendChild(gradientBar);
        
        // Add value labels
        const valueContainer = document.createElement('div');
        valueContainer.style.display = 'flex';
        valueContainer.style.flexDirection = 'column';
        valueContainer.style.justifyContent = 'space-between';
        valueContainer.style.height = '200px';
        valueContainer.style.position = 'absolute';
        valueContainer.style.top = '10px';
        valueContainer.style.left = '60px';
        
        // Add elevation values starting from bottom (min height) to top (max height)
        const numLabels = 6;
        for (let i = numLabels - 1; i >= 0; i--) {
            const value = minHeight + (maxHeight - minHeight) * (i / (numLabels - 1));
            const valueLabel = document.createElement('div');
            valueLabel.textContent = Math.round(value);
            valueLabel.style.fontSize = '13px';
            valueLabel.style.color = 'white';
            valueLabel.style.fontWeight = 'bold';
            valueLabel.style.textShadow = '1px 1px 2px rgba(0, 0, 0, 0.8)';
            valueLabel.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
            valueLabel.style.padding = '3px 6px';
            valueLabel.style.borderRadius = '4px';
            valueLabel.style.marginLeft = '5px';
            valueContainer.appendChild(valueLabel);
        }
        
        legend.appendChild(valueContainer);
        
        // Add legend to document body
        document.body.appendChild(legend);
        
        // Store reference to legend element
        this.legendElement = legend;
    }
    
    // Stub methods to maintain compatibility with existing code
    setWaterVisualizationData() {}
    setStreamSpawnPoints() {}
    setStreamPolylines() {}
    setSlopeData() {}
    
    // Clean up resources
    dispose() {
        // Remove elevation legend if it exists
        if (this.legendElement) {
            document.body.removeChild(this.legendElement);
            this.legendElement = null;
        }
        
        if (this.terrainMesh) {
            this.scene.remove(this.terrainMesh);
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.material.dispose();
            this.terrainMesh = null;
        }
        
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
        
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        
        this.scene = null;
        this.camera = null;
    }
}