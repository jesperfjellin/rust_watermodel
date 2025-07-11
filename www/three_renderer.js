import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WaterDetectionAlgorithm } from './water_detection_algorithm.js';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

export class TerrainRenderer {
    constructor(canvas) {
        // Basic properties
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.flyControls = null; // Add FlyControls reference
        this.controlsType = 'orbit'; // Default to orbit controls
        this.terrainMesh = null;
        this.gridHelper = null;
        this.legendElement = null;
        this.rawTerrainData = null;
        this.terrainScale = 1.0;
        this.heightScale = 1.0;
        this.composer = null; // For post-processing
        
        // Initialize the 3D components
        this.init();
        
        // Initialize water detection algorithm
        this.waterDetection = new WaterDetectionAlgorithm(this);
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
            
            // Create advanced renderer with top quality settings
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: true,
                precision: 'highp',
                powerPreference: 'high-performance',
                logarithmicDepthBuffer: true, // Helps with z-fighting on large terrains
                stencil: true
            });
            this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.2;
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            
            // Add orbit controls for camera manipulation with original damping
            this.controls = new OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.25;
            this.controls.rotateSpeed = 0.6;
            this.controls.zoomSpeed = 0.8;
            
            // Setup FlyControls but don't enable yet
            this.flyControls = new FlyControls(this.camera, this.renderer.domElement);
            this.flyControls.movementSpeed = 5000;
            this.flyControls.rollSpeed = 0.5;
            this.flyControls.dragToLook = true;
            this.flyControls.autoForward = false;
            this.flyControls.enabled = false; // Disabled by default
            
            // Add button to toggle between control modes
            this.addControlsToggleButton();
            
            // Add enhanced lighting from original renderer
            this.addLights();
            
            // Add a helper grid for reference
            this.gridHelper = new THREE.GridHelper(1000, 10);
            this.scene.add(this.gridHelper);
            
            // Add axes helper to show X, Y, Z directions
            const axesHelper = new THREE.AxesHelper(100);
            this.scene.add(axesHelper);
            
            // Setup post-processing effects for enhanced visuals
            this.setupPostProcessing();
            
            // Start animation loop
            this.animate();
            
            console.log("TerrainRenderer initialized successfully");
        } catch (error) {
            console.error("Failed to initialize TerrainRenderer:", error);
        }
    }
    
    setupPostProcessing() {
        // Create effect composer for post-processing
        this.composer = new EffectComposer(this.renderer);
        
        // Add basic render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);
        
        // Add SSAO (ambient occlusion) for depth
        const ssaoPass = new SSAOPass(this.scene, this.camera, this.canvas.width, this.canvas.height);
        ssaoPass.kernelRadius = 16;
        ssaoPass.minDistance = 0.005;
        ssaoPass.maxDistance = 0.1;
        this.composer.addPass(ssaoPass);
        
        // Add subtle bloom effect for highlights
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(this.canvas.width, this.canvas.height),
            0.15,  // strength
            0.5,   // radius
            0.85   // threshold
        );
        this.composer.addPass(bloomPass);
    }
    
    addLights() {
        // Add ambient light (soft overall illumination)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        
        // Add hemisphere light for more natural sky/ground illumination
        const hemiLight = new THREE.HemisphereLight(0xfcfcff, 0x8d7c66, 0.3);
        hemiLight.position.set(0, 500, 0);
        this.scene.add(hemiLight);
        
        // Add directional light (sun-like)
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(150, 200, 50);
        dirLight.castShadow = true;
        
        // Configure shadows for better quality
        dirLight.shadow.mapSize.width = 4096;
        dirLight.shadow.mapSize.height = 4096;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 500;
        dirLight.shadow.bias = -0.0003;
        dirLight.shadow.normalBias = 0.04;
        
        // Set up shadow camera frustum to cover terrain
        const shadowExtent = 350;
        dirLight.shadow.camera.left = -shadowExtent;
        dirLight.shadow.camera.right = shadowExtent;
        dirLight.shadow.camera.top = shadowExtent;
        dirLight.shadow.camera.bottom = -shadowExtent;
        
        this.scene.add(dirLight);
        
        // Add a secondary directional light from another angle for more definition
        const secondaryLight = new THREE.DirectionalLight(0xf0e0c0, 0.6);
        secondaryLight.position.set(-90, 40, -70);
        this.scene.add(secondaryLight);
        
        // Add a third light for better terrain detail
        const fillLight = new THREE.DirectionalLight(0xc4d1ff, 0.4);
        fillLight.position.set(50, 60, -120);
        this.scene.add(fillLight);
    }
    
    animate() {
        if (!this.renderer) return;
        
        requestAnimationFrame(() => this.animate());
        
        // Calculate proper delta time for smooth movement
        const now = performance.now();
        if (!this.lastTime) this.lastTime = now;
        const delta = (now - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = now;
        
        // Update the appropriate controls
        if (this.controlsType === 'orbit' && this.controls) {
            this.controls.update();
        } else if (this.controlsType === 'fly' && this.flyControls) {
            this.flyControls.update(delta); // Use actual delta time instead of fixed value
        }
        
        // Update stream Level-of-Detail based on camera position
        this.updateStreamLOD();
        
        // Use composer for advanced rendering if available
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }
    
    resize() {
        if (!this.camera || !this.renderer) return;
        
        this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        
        // Resize composer if it exists
        if (this.composer) {
            this.composer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        }
    }
    
    setTerrainData(terrainData, dimensions) {
        console.log('Setting terrain data:', `${dimensions[0]}x${dimensions[1]}, resolution: ${dimensions[2]}`);
        console.log('🔍 DEBUG - setTerrainData called with:', {
            terrainData_length: terrainData.length,
            dimensions: dimensions,
            expected_vertices: (dimensions[0] + 1) * (dimensions[1] + 1)
        });
        
        // Store terrain data for stream elevation lookup
        this.storedTerrainData = terrainData;
        this.storedDimensions = dimensions;
        
        // Clear existing terrain and streams
        if (this.terrainMesh) {
            this.scene.remove(this.terrainMesh);
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.material.dispose();
            this.terrainMesh = null;
        }
        
        // Clear existing streams when loading new terrain
        this.clearStreams();
        
        // Create new terrain
        this.createUltraDetailTerrain(terrainData, dimensions[0], dimensions[1], dimensions[2], 1);
    }
    
    createUltraDetailTerrain(terrainData, width, height, resolution, scaleDown) {
        // Hide the grid helper now that we're loading a terrain
        if (this.gridHelper) {
            this.gridHelper.visible = false;
        }
        
        // Extremely high detail mesh - push the limits
        const maxVerticesPerDimension = 2048; // Reduced from 3072 to safely stay within WebGL limits
        
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
            meshHeight: meshHeight,
            scaleDown: scaleDown
        };
        
        // ⭐ CUSTOM MESH GENERATION - No more diagonal line artifacts! ⭐
        const geometry = this.createAlternatingTriangleMesh(
            width * resolution * scaleDown,
            height * resolution * scaleDown,
            meshWidth,
            meshHeight
        );
        
        // Find elevation range for proper scaling
        let minHeight = Infinity;
        let maxHeight = -Infinity;
        let validElevations = [];
        
        // First pass: collect valid elevations for precomputed data (already optimized)
        for (let i = 0; i < terrainData.length; i++) {
            const elevation = terrainData[i];
            
            // Only consider valid elevations (not NaN or negative) as in original
            if (!isNaN(elevation) && elevation >= 0) {
                validElevations.push(elevation);
                minHeight = Math.min(minHeight, elevation);
                maxHeight = Math.max(maxHeight, elevation);
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
        
        // Use a simple, consistent, stronger height exaggeration
        // This gives reliable results regardless of terrain characteristics
        const heightScale = 8.5 * scaleDown; // Further increased for dramatic relief
        this.heightScale = heightScale;
        
        console.log(`Using height scale: ${heightScale}`);
        
        // Store height scale and terrain data for stream visualization
        this.heightScale = heightScale;
        this.storedTerrainData = terrainData;
        
        // Create colors array for vertex coloring
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        
        // Create UV coordinates for normal mapping (since we're using custom geometry)
        const uvs = new Float32Array(geometry.attributes.position.count * 2);
        
        // Set elevations and colors using DIRECT mapping for precomputed data
        for (let z = 0; z < meshHeight + 1; z++) {
            for (let x = 0; x < meshWidth + 1; x++) {
                // ⭐ DIRECT MAPPING: Precomputed data is stored as (meshHeight+1) × (meshWidth+1)
                // The precomputed data has exactly the right number of vertices - no clamping needed
                const demX = x;  // Direct mapping 0 to meshWidth
                const demY = meshHeight - z;  // Y-axis flip to correct orientation
                const demIndex = demY * (meshWidth + 1) + demX;
                const vertexIndex = z * (meshWidth + 1) + x;
                
                // Debug coordinate mapping for first few vertices
                if (z < 2 && x < 2) {
                    console.log(`🔍 Vertex [${z},${x}] → demIndex ${demIndex}, elevation ${terrainData[demIndex]}`);
                }
                
                if (vertexIndex >= geometry.attributes.position.count) continue;
                
                // Get elevation and filter out invalid values as in original
                let elevation = terrainData[demIndex];
                
                // Critical: If invalid elevation (negative or NaN), use clearly below minHeight as in original
                if (isNaN(elevation) || elevation < 0) {
                    // Instead of rendering, set clearly below valid terrain to avoid render
                    elevation = minHeight - 10;
                }
                
                // Set Y value (elevation) for this vertex with height exaggeration
                geometry.attributes.position.setY(vertexIndex, elevation * heightScale);
                
                // Set vertex color based on elevation using enhanced gradient
                const i3 = vertexIndex * 3;
                
                // Skip coloring for negative/invalid elevations (will not be visible)
                if (elevation <= 0.0) {
                    // Neutral gray for elevation 0.0
                    colors[i3] = 0.5;     // R
                    colors[i3 + 1] = 0.5; // G
                    colors[i3 + 2] = 0.5; // B
                } else {
                    // High-detail enhanced color gradient for terrain visualization
                    // Normalize elevation within range
                    const normalizedHeight = Math.max(0.01, Math.min(0.99, (elevation - minHeight) / (maxHeight - minHeight)));
                    
                    // Ultra-detailed 7-step gradient for more nuanced visualization
                    if (normalizedHeight < 0.15) {
                        // Deep green to forest green (0.01-0.15)
                        const t = normalizedHeight / 0.15;
                        colors[i3] = 0.11 + t * 0.08;    // R: 0.11 to 0.19
                        colors[i3 + 1] = 0.31 + t * 0.12; // G: 0.31 to 0.43
                        colors[i3 + 2] = 0.06 + t * 0.06; // B: 0.06 to 0.12
                    } else if (normalizedHeight < 0.3) {
                        // Forest green to olive green (0.15-0.3)
                        const t = (normalizedHeight - 0.15) / 0.15;
                        colors[i3] = 0.19 + t * 0.16;    // R: 0.19 to 0.35
                        colors[i3 + 1] = 0.43 + t * 0.17; // G: 0.43 to 0.6
                        colors[i3 + 2] = 0.12 + t * 0.03; // B: 0.12 to 0.15
                    } else if (normalizedHeight < 0.45) {
                        // Olive green to yellow ochre (0.3-0.45)
                        const t = (normalizedHeight - 0.3) / 0.15;
                        colors[i3] = 0.35 + t * 0.55;    // R: 0.35 to 0.9
                        colors[i3 + 1] = 0.6 + t * 0.1;   // G: 0.6 to 0.7
                        colors[i3 + 2] = 0.15 - t * 0.1;  // B: 0.15 to 0.05
                    } else if (normalizedHeight < 0.6) {
                        // Yellow ochre to orange (0.45-0.6)
                        const t = (normalizedHeight - 0.45) / 0.15;
                        colors[i3] = 0.9;                // R: 0.9
                        colors[i3 + 1] = 0.7 - t * 0.35;  // G: 0.7 to 0.35
                        colors[i3 + 2] = 0.05 - t * 0.05; // B: 0.05 to 0
                    } else if (normalizedHeight < 0.75) {
                        // Orange to red (0.6-0.75)
                        const t = (normalizedHeight - 0.6) / 0.15;
                        colors[i3] = 0.9 - t * 0.1;      // R: 0.9 to 0.8
                        colors[i3 + 1] = 0.35 - t * 0.25; // G: 0.35 to 0.1
                        colors[i3 + 2] = 0.0 + t * 0.1;   // B: 0 to 0.1
                    } else if (normalizedHeight < 0.9) {
                        // Red to reddish purple (0.75-0.9)
                        const t = (normalizedHeight - 0.75) / 0.15;
                        colors[i3] = 0.8 - t * 0.2;      // R: 0.8 to 0.6
                        colors[i3 + 1] = 0.1 - t * 0.05;  // G: 0.1 to 0.05
                        colors[i3 + 2] = 0.1 + t * 0.35;  // B: 0.1 to 0.45
                    } else {
                        // Reddish purple to deep purple (0.9-0.99)
                        const t = (normalizedHeight - 0.9) / 0.09;
                        colors[i3] = 0.6 - t * 0.15;     // R: 0.6 to 0.45
                        colors[i3 + 1] = 0.05 - t * 0.05; // G: 0.05 to 0
                        colors[i3 + 2] = 0.45 + t * 0.25; // B: 0.45 to 0.7
                    }
                }
                
                // Enhance UVs for better detail mapping
                const uvIndex = vertexIndex * 2;
                // Scale UVs to repeat normal maps for better detail
                uvs[uvIndex] = (x / meshWidth) * 30;
                uvs[uvIndex + 1] = (z / meshHeight) * 30;
            }
        }
        
        // Add color and UV attributes to geometry
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        
        // Update the geometry
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        
        // Create high-end material with both normal mapping and vertex colors
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            metalness: 0.08,
            roughness: 0.6,
            side: THREE.DoubleSide,
            flatShading: false,
            shadowSide: THREE.FrontSide,
            envMapIntensity: 0.8,
        });
        
        // Create mesh
        this.terrainMesh = new THREE.Mesh(geometry, material);
        // ⭐ REMOVED: No more rotation needed since mesh is generated correctly!
        // this.terrainMesh.rotation.x = -Math.PI / 2; // Rotate to be horizontal
        this.terrainMesh.receiveShadow = true;
        this.terrainMesh.castShadow = true;
        
        // Add to scene
        this.scene.add(this.terrainMesh);
        
        // Create enhanced elevation legend
        this.createElevationLegend(minHeight, maxHeight);
        
        // Setup camera using original positioning logic
        this.setupCamera(width, height, resolution, scaleDown);
    }
    
    /**
     * Create a custom terrain mesh with alternating triangle patterns
     * This eliminates the harsh diagonal lines caused by PlaneGeometry's consistent triangulation
     */
    createAlternatingTriangleMesh(width, height, widthSegments, heightSegments) {
        const geometry = new THREE.BufferGeometry();
        
        // Calculate vertex counts
        const vertexCount = (widthSegments + 1) * (heightSegments + 1);
        const indexCount = widthSegments * heightSegments * 6; // 6 indices per quad (2 triangles)
        
        // Create arrays for vertex data
        const positions = new Float32Array(vertexCount * 3);
        const indices = new Uint32Array(indexCount);
        
        // ⭐ CRITICAL FIX: Generate mesh with correct coordinate system from start
        // X = East-West, Z = North-South, Y = Up-Down (elevation)
        let vertexIndex = 0;
        for (let z = 0; z <= heightSegments; z++) {
            for (let x = 0; x <= widthSegments; x++) {
                // ⭐ REVERT: Use original positioning logic but with correct coordinate system
                // Calculate position (centered around origin)
                const xPos = (x / widthSegments - 0.5) * width;
                const zPos = (0.5 - z / heightSegments) * height;
                const yPos = 0; // Elevation will be set from DEM data
                
                positions[vertexIndex * 3] = xPos;     // X: East-West
                positions[vertexIndex * 3 + 1] = yPos; // Y: Elevation (up-down)
                positions[vertexIndex * 3 + 2] = zPos; // Z: North-South
                
                vertexIndex++;
            }
        }
        
        // Generate indices with alternating triangle patterns to eliminate diagonal artifacts
        let indexIndex = 0;
        for (let z = 0; z < heightSegments; z++) {
            for (let x = 0; x < widthSegments; x++) {
                // Calculate vertex indices for this quad
                const topLeft = z * (widthSegments + 1) + x;
                const topRight = topLeft + 1;
                const bottomLeft = (z + 1) * (widthSegments + 1) + x;
                const bottomRight = bottomLeft + 1;
                
                // ⭐ KEY FIX: Alternate triangle orientation to break up diagonal patterns
                // This creates a checkerboard pattern that eliminates visible seams
                if ((x + z) % 2 === 0) {
                    // Pattern A: Top-left to bottom-right diagonal
                    // Triangle 1: top-left, bottom-left, top-right
                    indices[indexIndex++] = topLeft;
                    indices[indexIndex++] = bottomLeft;
                    indices[indexIndex++] = topRight;
                    
                    // Triangle 2: top-right, bottom-left, bottom-right
                    indices[indexIndex++] = topRight;
                    indices[indexIndex++] = bottomLeft;
                    indices[indexIndex++] = bottomRight;
                } else {
                    // Pattern B: Top-right to bottom-left diagonal
                    // Triangle 1: top-left, bottom-left, bottom-right
                    indices[indexIndex++] = topLeft;
                    indices[indexIndex++] = bottomLeft;
                    indices[indexIndex++] = bottomRight;
                    
                    // Triangle 2: top-left, bottom-right, top-right
                    indices[indexIndex++] = topLeft;
                    indices[indexIndex++] = bottomRight;
                    indices[indexIndex++] = topRight;
                }
            }
        }
        
        // Set the geometry attributes
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        
        console.log(`🎯 Created alternating triangle mesh: ${vertexCount} vertices, ${indexCount/3} triangles`);
        
        return geometry;
    }

    setupCamera(width, height, resolution, scaleDown) {
        // ⭐ REVERT: Use original camera positioning logic
        // Calculate terrain dimensions in real-world units
        const terrainWidth = width * resolution * scaleDown;
        const terrainHeight = height * resolution * scaleDown;
        const terrainSize = Math.max(terrainWidth, terrainHeight);
        
        // Position camera at appropriate distance based on terrain size
        const cameraHeight = terrainSize * 0.8;
        const cameraDistance = terrainSize * 0.7;
        
        // Position camera above and to the side for good viewing angle
        this.camera.position.set(cameraDistance, cameraHeight, cameraDistance);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        
        // Log camera information
        console.log("🎯 Fixed Camera positioned at:", this.camera.position);
        console.log("Looking at target:", this.controls.target);
        console.log("Terrain dimensions:", width, "x", height);
        console.log("Terrain size (real-world):", terrainSize);
        console.log("Scale factor applied:", scaleDown);
    }
    
    // Create elevation legend from original renderer with enhanced appearance
    createElevationLegend(minHeight, maxHeight) {
        // Remove existing legend if any
        if (this.legendElement) {
            document.body.removeChild(this.legendElement);
        }
        
        // Create legend container with original styling
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
        
        // Create updated color gradient matching the new terrain colors
        let gradientColors = '';
        gradientColors += 'linear-gradient(to top,';
        gradientColors += ' rgb(28, 79, 15) 0%,';     // Deep green
        gradientColors += ' rgb(49, 110, 31) 15%,';   // Forest green
        gradientColors += ' rgb(89, 153, 38) 30%,';   // Olive green
        gradientColors += ' rgb(230, 179, 13) 45%,';  // Yellow ochre
        gradientColors += ' rgb(230, 89, 0) 60%,';    // Orange
        gradientColors += ' rgb(204, 26, 26) 75%,';   // Red
        gradientColors += ' rgb(115, 0, 179) 100%)';  // Deep purple
        
        gradientBar.style.background = gradientColors;
        legend.appendChild(gradientBar);
        
        // Add value labels with original styling
        const valueContainer = document.createElement('div');
        valueContainer.style.display = 'flex';
        valueContainer.style.flexDirection = 'column';
        valueContainer.style.justifyContent = 'space-between';
        valueContainer.style.height = '200px';
        valueContainer.style.position = 'absolute';
        valueContainer.style.top = '10px';
        valueContainer.style.left = '60px';
        
        // Add elevation values starting from bottom (min height) to top (max height)
        const numLabels = 6;  // Return to original number
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
    
    // Add a button to switch between orbit and fly controls
    addControlsToggleButton() {
        const button = document.createElement('button');
        button.textContent = 'Toggle Flight Mode';
        button.style.position = 'absolute';
        button.style.top = '10px';
        button.style.right = '10px';
        button.style.zIndex = '1000';
        button.style.padding = '8px 12px';
        button.style.backgroundColor = '#444';
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        
        button.addEventListener('click', () => this.toggleControlsMode());
        
        document.body.appendChild(button);
        this.controlsButton = button;
    }
    
    // Toggle between orbit and fly controls
    toggleControlsMode() {
        if (this.controlsType === 'orbit') {
            // Switch to fly controls
            this.controlsType = 'fly';
            this.controls.enabled = false;
            this.flyControls.enabled = true;
            this.controlsButton.textContent = 'Switch to Orbit Mode';
        } else {
            // Switch to orbit controls
            this.controlsType = 'orbit';
            this.flyControls.enabled = false;
            this.controls.enabled = true;
            this.controlsButton.textContent = 'Switch to Flight Mode';
        }
    }
    
    // Stream visualization methods with Level-of-Detail (LOD)
    setStreamPolylines(streams, flowAccumulation, meshWidth, meshHeight, resolution) {
        // Store flow data for water body detection
        this.flowData = {
            flowAccumulation,
            slopes: this.slopeData, // Will be set when available
            meshWidth,
            meshHeight
        };
        console.log('🌊 Setting stream polylines:', {
            detailed_streams: streams.detailed?.length || 0,
            medium_streams: streams.medium?.length || 0,
            major_streams: streams.major?.length || 0
        });
        
        // Store stream data for LOD switching
        this.streamData = {
            streams,
            flowAccumulation,
            meshWidth,
            meshHeight,
            resolution
        };
        
        // Clear existing streams
        this.clearStreams();
        
        // Create stream group with LOD containers
        this.streamGroup = new THREE.Group();
        this.scene.add(this.streamGroup);
        
        // Create separate groups for each stream level
        this.majorStreamGroup = new THREE.Group();
        this.majorStreamGroup.name = 'major_streams';
        this.streamGroup.add(this.majorStreamGroup);
        
        this.mediumStreamGroup = new THREE.Group();
        this.mediumStreamGroup.name = 'medium_streams';
        this.streamGroup.add(this.mediumStreamGroup);
        
        this.detailedStreamGroup = new THREE.Group();
        this.detailedStreamGroup.name = 'detailed_streams';
        this.streamGroup.add(this.detailedStreamGroup);
        
        // Render all stream levels but initially hide based on distance
        if (streams.major && streams.major.length > 0) {
            this.renderStreamLevel(streams.major, flowAccumulation, meshWidth, meshHeight, resolution, 'major', this.majorStreamGroup);
        }
        if (streams.medium && streams.medium.length > 0) {
            this.renderStreamLevel(streams.medium, flowAccumulation, meshWidth, meshHeight, resolution, 'medium', this.mediumStreamGroup);
        }
        if (streams.detailed && streams.detailed.length > 0) {
            this.renderStreamLevel(streams.detailed, flowAccumulation, meshWidth, meshHeight, resolution, 'detailed', this.detailedStreamGroup);
        }
        
        // Set initial LOD based on camera position
        this.updateStreamLOD();
    }
    
    renderStreamLevel(polylines, flowAccumulation, meshWidth, meshHeight, resolution, level, targetGroup) {
        const streamColor = new THREE.Color(0x1e88e5); // Nice blue color
        
        // Different thickness ranges for different stream levels
        const thicknessConfig = {
            'major': { min: 8.0, max: 15.0, opacity: 0.9 },
            'medium': { min: 4.0, max: 10.0, opacity: 0.8 },
            'detailed': { min: 1.5, max: 6.0, opacity: 0.7 }
        };
        
        const config = thicknessConfig[level];
        
        // Limit stream count for performance
        let streamLimit;
        switch(level) {
            case 'major': streamLimit = polylines.length; break;  // Render all major streams
            case 'medium': streamLimit = Math.min(polylines.length, 2500); break;  // Limit medium streams
            case 'detailed': streamLimit = Math.min(polylines.length, 8000); break;  // Heavily limit detailed streams
        }
        
        const limitedPolylines = polylines.slice(0, streamLimit);
        console.log(`🌊 Rendering ${limitedPolylines.length} of ${polylines.length} ${level} streams (performance limited)`);
        
        for (let i = 0; i < limitedPolylines.length; i++) {
            const polyline = limitedPolylines[i];
            if (polyline.length < 2) continue;
            
            // Debug first few streams
            if (i < 2) {
                console.log(`🔍 Stream ${i} first point: [${polyline[0][0]}, ${polyline[0][1]}]`);
            }
            
            // Calculate average flow accumulation for this stream
            let totalFlow = 0;
            let validPoints = 0;
            
            for (const [x, y] of polyline) {
                if (x < meshWidth && y < meshHeight) {
                    const flowIndex = y * meshWidth + x;
                    if (flowIndex < flowAccumulation.length) {
                        totalFlow += flowAccumulation[flowIndex];
                        validPoints++;
                    }
                }
            }
            
            const avgFlow = validPoints > 0 ? totalFlow / validPoints : 1.0;
            
            // Create 3D path points
            const points = [];
            for (const [x, y] of polyline) {
                // ⭐ FIXED: Convert grid coordinates to match terrain coordinate system exactly
                // The terrain uses normalized coordinates: (x / meshWidth - 0.5) * (meshWidth * resolution * scaleDown)
                // We need to store scaleDown from terrain creation
                const scaleDown = this.terrainMetadata?.scaleDown || 1.0;
                
                // Match the terrain coordinate system exactly
                const normalizedX = (x / meshWidth - 0.5);
                const normalizedZ = (0.5 - y / meshHeight); // Y-axis flip to match terrain
                
                const worldX = normalizedX * (meshWidth * resolution * scaleDown);
                const worldZ = normalizedZ * (meshHeight * resolution * scaleDown);
                
                // ⭐ FIXED: Get elevation using SAME indexing as terrain (Y-axis flip)
                let elevation = 0;
                if (x < meshWidth && y < meshHeight) {
                    // Must match terrain's coordinate system: demY = meshHeight - z
                    // For streams: demY = meshHeight - y (same Y-axis flip as terrain)
                    const demX = x;
                    const demY = meshHeight - y; // Y-axis flip to match terrain indexing
                    const elevIndex = demY * (meshWidth + 1) + demX;
                    elevation = this.getElevationAtIndex(elevIndex);
                    
                    // Debug elevation lookup for first few points
                    if (i < 2 && points.length <= 2) {
                        const arraySize = this.storedTerrainData ? this.storedTerrainData.length : 'unknown';
                        console.log(`🔍 Elevation lookup [${x},${y}] → demY=${demY}, demX=${demX}, elevIndex=${elevIndex} (arraySize=${arraySize}), elevation=${elevation}`);
                    }
                }
                
                points.push(new THREE.Vector3(worldX, elevation + 5, worldZ)); // Slightly above terrain
                
                // Debug first few coordinate transformations
                if (i < 2 && points.length <= 2) {
                    console.log(`🔍 Stream ${i} point [${x},${y}] → world [${worldX.toFixed(1)}, ${elevation.toFixed(1)}, ${worldZ.toFixed(1)}]`);
                }
            }
            
            if (points.length < 2) continue;
            
            // Create curve from points
            const curve = new THREE.CatmullRomCurve3(points);
            
            // Normalize flow for thickness calculation (logarithmic scale for better visual range)
            const normalizedFlow = Math.log(Math.max(1, avgFlow)) / Math.log(100); // Log scale 
            const thickness = config.min + (config.max - config.min) * Math.min(1, normalizedFlow);
            
            // Create tube geometry
            const tubeGeometry = new THREE.TubeGeometry(curve, Math.max(16, points.length * 2), thickness, 8, false);
            const tubeMaterial = new THREE.MeshBasicMaterial({
                color: streamColor,
                transparent: true,
                opacity: config.opacity
            });
            
            const streamMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
            streamMesh.userData = { type: 'stream', level: level, flow: avgFlow };
            
            // Add to the target group instead of the main streamGroup
            targetGroup.add(streamMesh);
        }
    }
    
    // Update stream Level-of-Detail based on camera distance
    updateStreamLOD() {
        if (!this.majorStreamGroup || !this.mediumStreamGroup || !this.detailedStreamGroup) {
            return; // Stream groups not initialized yet
        }
        
        // Calculate camera distance from terrain center
        const terrainCenter = new THREE.Vector3(0, 0, 0);
        const cameraDistance = this.camera.position.distanceTo(terrainCenter);
        
        // Define distance thresholds for LOD switching
        const lodThresholds = {
            detailed: 15000,  // Show detailed streams when camera is very close
            medium: 35000,    // Show medium streams when camera is at medium distance  
            major: 80000      // Always show major streams (up to far distance)
        };
        
        // Determine which stream levels to show based on distance
        const showDetailed = cameraDistance < lodThresholds.detailed;
        const showMedium = cameraDistance < lodThresholds.medium;
        const showMajor = cameraDistance < lodThresholds.major;
        
        // Update visibility
        this.detailedStreamGroup.visible = showDetailed;
        this.mediumStreamGroup.visible = showMedium;
        this.majorStreamGroup.visible = showMajor;
        
        // Log LOD changes for debugging
        if (this.lastLODState !== `${showMajor}-${showMedium}-${showDetailed}`) {
            console.log(`🔍 Stream LOD Update - Distance: ${Math.round(cameraDistance)} | Major: ${showMajor} | Medium: ${showMedium} | Detailed: ${showDetailed}`);
            this.lastLODState = `${showMajor}-${showMedium}-${showDetailed}`;
        }
    }
    
    clearStreams() {
        if (this.streamGroup) {
            // Dispose of geometries and materials
            this.streamGroup.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                }
            });
            
            this.scene.remove(this.streamGroup);
            this.streamGroup = null;
        }
        
        // Clear LOD groups
        this.majorStreamGroup = null;
        this.mediumStreamGroup = null;
        this.detailedStreamGroup = null;
    }
    
    getElevationAtIndex(index) {
        // Helper to get elevation from stored terrain data
        if (this.storedTerrainData && index < this.storedTerrainData.length) {
            const elevation = this.storedTerrainData[index];
            if (!isNaN(elevation) && elevation >= 0) {
                // Apply the same height scaling as the terrain
                return elevation * this.heightScale || elevation * 8.5; // Default scale
            }
        }
        return 0;
    }

    


    

    

    
    // Get elevation at specific coordinates with proper indexing
    getElevationAtCoords(x, y, meshWidth, meshHeight) {
        if (x >= meshWidth || y >= meshHeight) return 0;
        
        // Use same coordinate system as terrain
        const demX = x;
        const demY = meshHeight - y; // Y-axis flip to match terrain
        const elevIndex = demY * (meshWidth + 1) + demX;
        
        return this.getElevationAtIndex(elevIndex);
    }
    

    

    

    


    // Detect water bodies and apply blue coloring to terrain mesh
    detectAndApplyWaterBodies(flowAccumulation, slopes, meshWidth, meshHeight) {
        console.log('🌊 Starting water body detection and terrain recoloring');
        
        // Detect water bodies using the new dedicated algorithm
        const waterMask = this.waterDetection.detectWaterBodies(flowAccumulation, slopes, meshWidth, meshHeight);
        
        // Apply water coloring to the terrain mesh
        this.waterDetection.applyWaterColoring(waterMask, meshWidth, meshHeight);
    }
    

    


    // Compatibility stubs for other visualization data
    setWaterVisualizationData() {}
    setStreamSpawnPoints() {}
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
        
        if (this.controlsButton) {
            document.body.removeChild(this.controlsButton);
            this.controlsButton = null;
        }
        
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
        
        if (this.flyControls) {
            this.flyControls.dispose();
            this.flyControls = null;
        }
        
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }
        
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        
        this.scene = null;
        this.camera = null;
    }
}