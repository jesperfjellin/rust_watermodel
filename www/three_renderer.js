import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class TerrainRenderer {
    constructor(canvas) {
        // Initialize Three.js components
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf0f0f0);
        
        // Camera setup
        this.camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100000);
        this.camera.position.set(0, 200, 400);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.shadowMap.enabled = true;
        
        // Controls for camera
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.25;
        
        // Lighting
        this.addLights();
        
        // Data storage
        this.terrainMesh = null;
        this.particleSystem = null; // We keep this reference but won't create it
        this.streamLines = null;
        
        // Stats
        this.dimensions = null;
        this.flowData = null;
        this.streamData = null;
        this.slopeData = null;
        this.velocityData = null;
        this.spawnPoints = null;
        
        // Animation - we disable particle animation
        this.isAnimating = false;
        this.showWater = false;
        
        // Stream pulse animation
        this.pulseObjects = [];
        this.pulseAnimations = [];
        this.flowSpeed = 1.0; // speed multiplier
        
        // Setup resize handler
        window.addEventListener('resize', () => this.resize());
        
        // Start render loop
        this.animate();
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
        const shadowExtent = 100;
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
    
    resize() {
        if (!this.renderer) return;
        
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        // Update controls
        this.controls.update();
        
        // We no longer update pulses
        
        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }
    
    setTerrainData(terrainData, dimensions) {
        // Store dimensions
        this.dimensions = dimensions;
        const [width, height, resolution] = dimensions;
        
        // Clear previous terrain
        if (this.terrainMesh) {
            this.scene.remove(this.terrainMesh);
        }
        
        // Scale factor to make large terrains manageable
        const scaleDown = Math.max(width, height) > 1000 ? 0.1 : 1.0;
        console.log(`Using scale factor: ${scaleDown} for terrain of size ${width}x${height}`);
        
        // For very large DEMs, we need to subsample to avoid WebGL limitations
        // WebGL can only handle about 16 million indices in most implementations
        const maxVerticesPerDimension = 1000; // Limit to 1000x1000 grid max (1M vertices)
        
        // Calculate how many vertices to use based on DEM size
        let meshWidth = width;
        let meshHeight = height;
        let skipFactor = 1;
        
        // If DEM is too large, calculate a skip factor to reduce resolution
        if (width > maxVerticesPerDimension || height > maxVerticesPerDimension) {
            skipFactor = Math.ceil(Math.max(width, height) / maxVerticesPerDimension);
            meshWidth = Math.floor(width / skipFactor);
            meshHeight = Math.floor(height / skipFactor);
            console.log(`DEM too large for WebGL, using ${meshWidth}x${meshHeight} vertices with skip factor ${skipFactor}`);
        }
        
        // Create terrain geometry with appropriate detail level
        const geometry = new THREE.PlaneGeometry(
            width * resolution * scaleDown, 
            height * resolution * scaleDown,
            meshWidth,
            meshHeight
        );
        
        // Set proper elevation using the DEM data with subsampling if needed
        let minHeight = Infinity;
        let maxHeight = -Infinity;
        
        // Find an average elevation to use as a base level for no-data areas
        let validElevations = [];
        let avgElevation = 0;
        
        // First pass: collect valid elevations
        for (let y = 0; y < meshHeight; y++) {
            for (let x = 0; x < meshWidth; x++) {
                // Map mesh coordinates to original DEM coordinates
                const demX = Math.min(width - 1, x * skipFactor);
                const demY = Math.min(height - 1, y * skipFactor);
                const demIndex = demY * width + demX;
                
                // Get elevation
                const elevation = terrainData[demIndex];
                
                // Only consider valid elevations (not NaN or negative)
                if (!isNaN(elevation) && elevation >= 0) {
                    validElevations.push(elevation);
                    minHeight = Math.min(minHeight, elevation);
                    maxHeight = Math.max(maxHeight, elevation);
                }
            }
        }
        
        // Calculate average elevation from valid values
        if (validElevations.length > 0) {
            avgElevation = validElevations.reduce((a, b) => a + b, 0) / validElevations.length;
        } else {
            // Fallback if no valid elevations found
            avgElevation = 0;
            minHeight = 0;
            maxHeight = 0;
        }
        
        console.log(`Terrain elevation range: ${minHeight} to ${maxHeight}`);
        console.log(`Average elevation: ${avgElevation}`);
        
        // Create colors array for vertex coloring
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        
        // Second pass: set elevations and colors, replacing invalid values with slightly below the min valid height
        for (let y = 0; y < meshHeight; y++) {
            for (let x = 0; x < meshWidth; x++) {
                // Map mesh coordinates to original DEM coordinates
                const demX = Math.min(width - 1, x * skipFactor);
                const demY = Math.min(height - 1, y * skipFactor);
                const demIndex = demY * width + demX;
                const vertexIndex = y * (meshWidth + 1) + x;
                
                // Get elevation and filter out invalid values
                let elevation = terrainData[demIndex];
                
                // If invalid elevation (negative or NaN), use slightly below minHeight
                if (isNaN(elevation) || elevation < 0) {
                    elevation = minHeight - 10; // Set clearly below valid terrain
                }
                
                // Set Z value for this vertex (using stronger height exaggeration)
                if (vertexIndex < geometry.attributes.position.count) {
                    // Increase the height exaggeration factor significantly for better visibility
                    const heightScale = 2.0 * scaleDown; 
                    geometry.attributes.position.setZ(vertexIndex, elevation * heightScale);
                    
                    // Set vertex color based on elevation
                    const i3 = vertexIndex * 3;
                    
                    if (elevation <= 0.0) {
                        // Neutral gray for elevation 0.0
                        colors[i3] = 0.5;     // R
                        colors[i3 + 1] = 0.5; // G
                        colors[i3 + 2] = 0.5; // B
                    } else {
                        // Create a gradient for elevation values > 0.1
                        // Normalize elevation within range
                        const normalizedHeight = Math.max(0.1, Math.min(1.0, (elevation - 0.1) / (maxHeight - 0.1)));
                        
                        // Create a warm-to-cool gradient with more muted greens (avoiding blue)
                        // Colors transition: forest green -> olive green -> yellow -> orange -> red -> purple
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
        }
        
        // Add color attribute to geometry
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        // Update the geometry
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        
        // Create terrain material with vertex colors
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
        
        // Store metadata for later use
        this.terrainMetadata = {
            skipFactor: skipFactor,
            minHeight: minHeight,
            maxHeight: maxHeight,
            meshWidth: meshWidth,
            meshHeight: meshHeight
        };
        
        // Add to scene
        this.scene.add(this.terrainMesh);
        
        // Center camera on terrain
        const centerX = 0;
        const centerZ = 0;
        this.controls.target.set(centerX, 0, centerZ);
        
        // Position camera at an angle to see terrain better
        const cameraDistance = Math.max(width, height) * resolution * scaleDown * 0.8;
        this.camera.position.set(
            centerX, 
            cameraDistance * 1.2, // Higher above terrain for better overview
            centerZ + cameraDistance // Distance back from center
        );
        
        // Update controls immediately and log camera position
        this.controls.update();
        console.log("Camera positioned at:", this.camera.position);
        console.log("Looking at target:", this.controls.target);
        console.log("Terrain dimensions:", width * resolution * scaleDown, "x", height * resolution * scaleDown);
        console.log("Scale factor applied:", scaleDown);
        
        // Store scale factor for other elements
        this.terrainScale = scaleDown;
        this.heightScale = 2.0 * scaleDown; // Update the heightScale to match the exaggeration
    }
    
    // Set comprehensive water visualization data
    setWaterVisualizationData(waterData) {
        try {
            // Check water data structure and assign properties safely
            this.flowData = waterData.flow_accumulation || [];
            this.slopeData = waterData.slopes || [];
            
            // Store velocities data but don't create particles
            if (waterData.velocities) {
                // Make sure velocities data is an array
                if (Array.isArray(waterData.velocities)) {
                    this.velocityData = waterData.velocities;
                } else {
                    console.warn("Velocities data is not in expected format");
                    this.velocityData = [];
                }
            } else {
                this.velocityData = [];
            }
            
            // We no longer create particles - pulses are our primary animation
            // this.createParticleSystem();
        } catch (error) {
            console.error("Error processing water visualization data:", error);
        }
    }
    
    // Set slope data for visualization
    setSlopeData(slopeData) {
        this.slopeData = slopeData;
    }
    
    // Set stream spawn points for better particle placement
    setStreamSpawnPoints(spawnPointsData) {
        if (!spawnPointsData || spawnPointsData.length === 0) return;
        
        // Convert flat array [x1, y1, x2, y2, ...] to array of points [{x, y}, ...]
        this.spawnPoints = [];
        for (let i = 0; i < spawnPointsData.length; i += 2) {
            this.spawnPoints.push({
                x: spawnPointsData[i],
                y: spawnPointsData[i + 1]
            });
        }
        
        console.log(`Got ${this.spawnPoints.length} stream spawn points`);
    }
    
    // Set stream polylines for better visualization
    setStreamPolylines(polylines) {
        if (!polylines || !this.dimensions) return;
        
        // Clean up previous lines and pulses
        if (this.streamLines) {
            this.scene.remove(this.streamLines);
            this.streamLines = null;
        }
        
        // Clean up animation timers
        if (this.pulseAnimations) {
            for (const timer of this.pulseAnimations) {
                clearInterval(timer);
            }
            this.pulseAnimations = [];
        }
        
        // Clear any existing pulse objects
        for (const pulse of this.pulseObjects || []) {
            if (pulse.mesh) {
                this.scene.remove(pulse.mesh);
                pulse.mesh.geometry.dispose();
                pulse.mesh.material.dispose();
            }
        }
        this.pulseObjects = [];
        
        const [width, height, resolution] = this.dimensions;
        const scaleDown = this.terrainScale || 1.0;
        
        // Create a group for all stream lines
        this.streamLines = new THREE.Group();
        
        // Material for stream lines - blue for better visibility
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x0088ff,
            linewidth: 3.0,
            opacity: 1,
            transparent: true
        });
        
        // Store stream path data (but we won't use it for pulses)
        this.streamPathData = [];
        
        // Create a line for each stream polyline
        for (const polyline of polylines) {
            if (polyline.length < 2) continue; // Skip empty lines
            
            const points = [];
            const worldPoints = []; // Store for reference only
            
            // Convert from grid coordinates to world coordinates and add points
            for (let i = 0; i < polyline.length; i++) {
                const [x, y] = polyline[i];
                
                // Get the corresponding point on the terrain
                const worldX = (x / width) * width * resolution * scaleDown - (width * resolution * scaleDown / 2);
                const worldZ = (y / height) * height * resolution * scaleDown - (height * resolution * scaleDown / 2);
                
                // Get the height at this position
                const terrainX = Math.floor(x);
                const terrainY = Math.floor(y);
                let terrainHeight = 0;
                
                if (this.terrainMesh && this.terrainMetadata) {
                    try {
                        // Calculate vertex in decimated mesh
                        const skipFactor = this.terrainMetadata.skipFactor || 1;
                        const meshX = Math.floor(terrainX / skipFactor);
                        const meshY = Math.floor(terrainY / skipFactor);
                        const meshWidth = this.terrainMetadata.meshWidth;
                        const vertexIndex = meshY * (meshWidth + 1) + meshX;
                        
                        if (vertexIndex < this.terrainMesh.geometry.attributes.position.count) {
                            terrainHeight = this.terrainMesh.geometry.attributes.position.getZ(vertexIndex) + 0.5;
                        }
                    } catch (e) {
                        // Just use default height
                    }
                }
                
                // Create the point
                const point = new THREE.Vector3(worldX, terrainHeight, worldZ);
                points.push(point);
                worldPoints.push({x: worldX, y: terrainHeight, z: worldZ});
            }
            
            // Create the line geometry for the stream
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, lineMaterial);
            
            // Add to the group
            this.streamLines.add(line);
            
            // Store path data for reference
            this.streamPathData.push(worldPoints);
        }
        
        // Add all stream lines to the scene
        this.scene.add(this.streamLines);
        console.log(`Created ${polylines.length} stream lines`);
        
        // We no longer call setupStreamPulses()
    }
    
    // This method is now empty - no pulse animations
    setupStreamPulses() {
        // Disabled - no animations
        console.log("Pulse animations disabled");
    }
    
    // Toggle flow animation visibility - simplified to just show/hide stream lines
    toggleFlowAnimation(visible) {
        if (this.streamLines) {
            this.streamLines.visible = visible;
        }
        
        // Clean up any existing timers just to be safe
        if (this.pulseAnimations) {
            for (const timer of this.pulseAnimations) {
                clearInterval(timer);
            }
            this.pulseAnimations = [];
        }
    }
    
    // Toggle water visibility (keeping for backward compatibility)
    toggleWaterVisibility(visible) {
        this.showWater = visible;
        if (this.particleSystem) {
            this.particleSystem.visible = visible;
        }
    }
    
    // Set flow speed
    setFlowSpeed(speed) {
        this.flowSpeed = speed;
    }
    
    // Set particle density
    setParticleDensity(density) {
        this.particleDensity = density;
        // Recreate particle system if it already exists
        if (this.particleSystem && this.isAnimating) {
            this.createParticleSystem();
        }
    }
    
    // Find max value in array without using spread operator
    findMaxValue(array) {
        if (!array || array.length === 0) return 0.1;
        
        let max = 0.1; // Start with small positive value to avoid division by zero
        const len = array.length;
        
        // Process in chunks to avoid call stack issues
        const chunkSize = 10000;
        
        for (let i = 0; i < len; i += chunkSize) {
            const endIdx = Math.min(i + chunkSize, len);
            
            // Find max in this chunk
            for (let j = i; j < endIdx; j++) {
                const val = array[j];
                if (!isNaN(val) && isFinite(val) && val > max) {
                    max = val;
                }
            }
        }
        
        return max;
    }
    
    createParticleSystem() {
        if (!this.dimensions || !this.flowData) return;
        
        // Clean up existing particle system
        if (this.particleSystem) {
            this.scene.remove(this.particleSystem);
            this.particleSystem = null;
        }
        
        try {
            const [width, height, resolution] = this.dimensions;
            const scaleDown = this.terrainScale || 1.0;
            const heightScale = this.heightScale || 2.0 * scaleDown; // Match the terrain height exaggeration
            
            // Number of particles - reduce for performance
            const maxParticles = 10000; // Lower max particles
            const particleCount = Math.min(this.particleDensity || 5000, maxParticles);
            
            // Create array of particle positions, colors, and sizes
            const positions = new Float32Array(particleCount * 3);
            const colors = new Float32Array(particleCount * 3);
            const sizes = new Float32Array(particleCount);
            
            // Pre-calculate maximum flow value safely without spread operator
            const maxFlow = this.findMaxValue(this.flowData);
            console.log(`Maximum flow value: ${maxFlow}`);
            
            // Initialize particles with error handling
            for (let i = 0; i < particleCount; i++) {
                try {
                    // Initialize particle at a random position
                    this.initializeParticle(i, positions, colors, sizes, width, height, resolution, maxFlow);
                } catch (particleError) {
                    console.warn(`Error initializing particle ${i}:`, particleError);
                    
                    // Set safe defaults for this particle
                    const i3 = i * 3;
                    positions[i3] = 0;
                    positions[i3 + 1] = 0; 
                    positions[i3 + 2] = 0;
                    colors[i3] = 0.3;
                    colors[i3 + 1] = 0.7;
                    colors[i3 + 2] = 1.0;
                    sizes[i] = 2.0;
                }
            }
            
            // Create life cycles
            this.particleLifecycles = new Float32Array(particleCount);
            for (let i = 0; i < particleCount; i++) {
                this.particleLifecycles[i] = Math.random() * this.particleLifetime;
            }
            
            // Create particle geometry
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            
            // Create a simple circle texture for particles instead of loading an external image
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');
            
            // Create a radial gradient for a more water-like appearance
            const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
            gradient.addColorStop(0, 'rgba(50, 150, 255, 1.0)'); // Bright blue center
            gradient.addColorStop(0.5, 'rgba(30, 100, 255, 0.8)'); // Mid blue
            gradient.addColorStop(1, 'rgba(0, 50, 255, 0)'); // Transparent edges
            
            ctx.beginPath();
            ctx.arc(16, 16, 16, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
            
            const texture = new THREE.CanvasTexture(canvas);
            
            // Create material for particles
            const material = new THREE.PointsMaterial({
                size: 6, // Slightly larger particles for better visibility
                map: texture,
                blending: THREE.AdditiveBlending,
                depthTest: true,
                transparent: true,
                vertexColors: true
            });
            
            // Create the particle system
            this.particleSystem = new THREE.Points(geometry, material);
            this.particleSystem.frustumCulled = false; // Disable frustum culling for better performance
            
            // Add to scene
            this.scene.add(this.particleSystem);
            
            // Start animation
            this.isAnimating = true;
            
            // Store max flow for later use
            this.maxFlowValue = maxFlow;
            
            console.log(`Created particle system with ${particleCount} particles`);
        } catch (error) {
            console.error("Error creating particle system:", error, error.stack);
            // Don't try to create a minimal particle system - just disable water
            this.isAnimating = false;
            console.log("Disabled water animation due to errors");
        }
    }
    
    // Initialize a single particle at a random position
    initializeParticle(index, positions, colors, sizes, width, height, resolution, maxFlow) {
        const scaleDown = this.terrainScale || 1.0;
        const i3 = index * 3;
        
        let x, y;
        let flow = 0;
        let attempts = 0;
        const maxAttempts = 5; // Try a few times to find a good flow spot
        
        // Try to find a spot with good flow
        do {
            // Prefer spawning at stream spawn points with very high probability
            if (this.spawnPoints && this.spawnPoints.length > 0 && Math.random() < 0.9) {
                // Pick a random spawn point
                const spawnPoint = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
                x = spawnPoint.x;
                y = spawnPoint.y;
            } else {
                // Random position across the entire terrain
                x = Math.floor(Math.random() * width);
                y = Math.floor(Math.random() * height);
            }
            
            // Get flow at this position
            const flowIndex = y * width + x;
            if (flowIndex >= 0 && flowIndex < this.flowData.length) {
                flow = this.flowData[flowIndex];
            }
            
            attempts++;
        } while (flow < maxFlow * 0.01 && attempts < maxAttempts);
        
        // Convert to world coordinates centered on the terrain
        const worldX = (x / width) * width * resolution * scaleDown - (width * resolution * scaleDown / 2);
        const worldZ = (y / height) * height * resolution * scaleDown - (height * resolution * scaleDown / 2);
        
        // Set a default height above terrain
        let worldY = 5.0;
        
        // If we have terrain, get the actual height at this position
        if (this.terrainMesh && this.terrainMetadata) {
            try {
                const skipFactor = this.terrainMetadata.skipFactor || 1;
                const meshX = Math.floor(x / skipFactor);
                const meshY = Math.floor(y / skipFactor);
                const meshWidth = this.terrainMetadata.meshWidth;
                
                if (meshX >= 0 && meshX < this.terrainMetadata.meshWidth && 
                    meshY >= 0 && meshY < this.terrainMetadata.meshHeight) {
                    const vertexIndex = meshY * (meshWidth + 1) + meshX;
                    
                    if (vertexIndex < this.terrainMesh.geometry.attributes.position.count) {
                        worldY = this.terrainMesh.geometry.attributes.position.getZ(vertexIndex) + 4.0;
                    }
                }
            } catch (error) {
                // Just use default height
            }
        }
        
        // Set position
        positions[i3] = worldX;
        positions[i3 + 1] = worldY;
        positions[i3 + 2] = worldZ;
        
        // Set color based on flow intensity
        const flowIntensity = Math.min(1.0, Math.log(flow + 1) / Math.log(maxFlow + 1));
        colors[i3] = 0.2 + flowIntensity * 0.2;     // Red component
        colors[i3 + 1] = 0.5 + flowIntensity * 0.3;  // Green component
        colors[i3 + 2] = 0.8 + flowIntensity * 0.2;  // Blue component
        
        // Set size based on flow with a better scale
        const normalizedFlow = Math.min(1.0, flow / (maxFlow * 0.05)); // More sensitivity to flow differences
        sizes[index] = 3.0 + normalizedFlow * 6.0; // Base size 3.0, max growth to 9.0
    }
    
    updateParticles() {
        if (!this.particleSystem || !this.flowData || !this.dimensions) return;
        
        const [width, height, resolution] = this.dimensions;
        const scaleDown = this.terrainScale || 1.0;
        const skipFactor = this.terrainMetadata?.skipFactor || 1;
        
        // Get particle system properties
        const positions = this.particleSystem.geometry.attributes.position.array;
        const colors = this.particleSystem.geometry.attributes.color.array;
        const sizes = this.particleSystem.geometry.attributes.size.array;
        
        // Use the stored max flow value instead of recalculating
        const maxFlow = this.maxFlowValue || 0.1;
        
        const particleCount = positions.length / 3;
        const speedMultiplier = this.flowSpeed || 1.0;
        
        // Update a subset of particles each frame for better performance
        // But update more of them for smoother animation
        const updateCount = Math.min(2000, particleCount);
        
        for (let i = 0; i < updateCount; i++) {
            // Pick a random particle to update
            const particleIndex = Math.floor(Math.random() * particleCount);
            const i3 = particleIndex * 3;
            
            // Update lifecycle
            this.particleLifecycles[particleIndex] -= 1;
            
            // If particle has reached end of life, respawn it
            if (this.particleLifecycles[particleIndex] <= 0) {
                this.initializeParticle(particleIndex, positions, colors, sizes, width, height, resolution, maxFlow);
                this.particleLifecycles[particleIndex] = this.particleLifetime;
                continue;
            }
            
            // Get current position
            const worldX = positions[i3];
            const worldY = positions[i3 + 1];
            const worldZ = positions[i3 + 2];
            
            // Convert to grid coordinates
            const gridX = Math.round(((worldX / (width * resolution * scaleDown)) * width) + (width / 2));
            const gridZ = Math.round(((worldZ / (height * resolution * scaleDown)) * height) + (height / 2));
            
            // Skip if out of bounds
            if (gridX < 0 || gridX >= width || gridZ < 0 || gridZ >= height) {
                this.initializeParticle(particleIndex, positions, colors, sizes, width, height, resolution, maxFlow);
                this.particleLifecycles[particleIndex] = this.particleLifetime;
                continue;
            }
            
            // Get flow accumulation at this location
            const flowIndex = gridZ * width + gridX;
            let flow = 0;
            if (flowIndex >= 0 && flowIndex < this.flowData.length) {
                flow = this.flowData[flowIndex];
            }
            
            // If very low flow, increase chances of respawning (helps concentrate particles on streams)
            if (flow < maxFlow * 0.01 && Math.random() < 0.1) {
                this.initializeParticle(particleIndex, positions, colors, sizes, width, height, resolution, maxFlow);
                this.particleLifecycles[particleIndex] = this.particleLifetime;
                continue;
            }
            
            // Find vector to lowest neighbor for flow direction
            let velocityX = 0;
            let velocityZ = 0;
            let speed = 0.2 + (flow / maxFlow) * 0.8;  // Faster in high-flow areas
            
            // Find lowest neighboring cell for flow direction
            let lowestNeighborX = gridX;
            let lowestNeighborZ = gridZ;
            let lowestElevation = Infinity;
            
            // Check all 8 neighboring directions for better flow
            const directions = [
                {dx: 0, dz: 1},   // N
                {dx: 1, dz: 1},   // NE
                {dx: 1, dz: 0},   // E
                {dx: 1, dz: -1},  // SE
                {dx: 0, dz: -1},  // S
                {dx: -1, dz: -1}, // SW
                {dx: -1, dz: 0},  // W
                {dx: -1, dz: 1},  // NW
            ];
            
            // Find lowest neighbor, with slight random variation
            for (const {dx, dz} of directions) {
                const neighborX = gridX + dx;
                const neighborZ = gridZ + dz;
                
                if (neighborX < 0 || neighborX >= width || neighborZ < 0 || neighborZ >= height) continue;
                
                const meshX = Math.floor(neighborX / skipFactor);
                const meshY = Math.floor(neighborZ / skipFactor);
                const meshWidth = this.terrainMetadata?.meshWidth || width;
                const vertexIndex = meshY * (meshWidth + 1) + meshX;
                
                if (vertexIndex < this.terrainMesh.geometry.attributes.position.count) {
                    // Add small random variation to prevent all particles following same exact path
                    const elevation = this.terrainMesh.geometry.attributes.position.getZ(vertexIndex) + 
                                     (Math.random() * 0.5 - 0.25); // +/- 0.25 random jitter
                    
                    if (elevation < lowestElevation) {
                        lowestElevation = elevation;
                        lowestNeighborX = neighborX;
                        lowestNeighborZ = neighborZ;
                    }
                }
            }
            
            // Calculate movement direction with some randomness for visual variation
            velocityX = (lowestNeighborX - gridX) + (Math.random() * 0.4 - 0.2);
            velocityZ = (lowestNeighborZ - gridZ) + (Math.random() * 0.4 - 0.2);
            
            // Normalize direction vector
            const length = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);
            if (length > 0) {
                velocityX /= length;
                velocityZ /= length;
            }
            
            // Move the particle - adjust speed based on flow accumulation
            positions[i3] += velocityX * speed * speedMultiplier;
            positions[i3 + 2] += velocityZ * speed * speedMultiplier;
            
            // Update height at the new position
            const newGridX = Math.round(((positions[i3] / (width * resolution * scaleDown)) * width) + (width / 2));
            const newGridZ = Math.round(((positions[i3 + 2] / (height * resolution * scaleDown)) * height) + (height / 2));
            
            if (newGridX >= 0 && newGridX < width && newGridZ >= 0 && newGridZ < height) {
                const meshX = Math.floor(newGridX / skipFactor);
                const meshY = Math.floor(newGridZ / skipFactor);
                const meshWidth = this.terrainMetadata?.meshWidth || width;
                const vertexIndex = meshY * (meshWidth + 1) + meshX;
                
                if (vertexIndex < this.terrainMesh.geometry.attributes.position.count) {
                    const terrainHeight = this.terrainMesh.geometry.attributes.position.getZ(vertexIndex);
                    positions[i3 + 1] = terrainHeight + 4.0; // Keep close to terrain for visibility
                }
            }
            
            // Adjust color based on flow intensity
            if (flow > 0) {
                const flowIntensity = Math.min(1.0, Math.log(flow + 1) / Math.log(maxFlow + 1));
                colors[i3] = 0.2 + flowIntensity * 0.2; // More red in higher flow
                colors[i3 + 1] = 0.5 + flowIntensity * 0.3; // More green in higher flow
                colors[i3 + 2] = 0.8 + flowIntensity * 0.2; // More blue in higher flow
            }
        }
        
        // Update the geometry attributes
        this.particleSystem.geometry.attributes.position.needsUpdate = true;
        this.particleSystem.geometry.attributes.color.needsUpdate = true; // Update colors
    }
    
    createStreamLines() {
        if (!this.streamData || !this.dimensions) return;
        
        // Clean up previous lines
        if (this.streamLines) {
            this.scene.remove(this.streamLines);
            this.streamLines = null;
        }
        
        const [width, height, resolution] = this.dimensions;
        const scaleDown = this.terrainScale || 1.0;
        
        // Create a group for all stream lines
        this.streamLines = new THREE.Group();
        
        // Create line geometry for streams
        const streamPoints = [];
        for (let i = 0; i < this.streamData.length; i += 2) {
            const x = this.streamData[i];
            const y = this.streamData[i + 1];
            
            const position = new THREE.Vector3(
                x * resolution * scaleDown,
                5 * scaleDown, // Slightly above terrain
                y * resolution * scaleDown
            );
            
            streamPoints.push(position);
        }
        
        // Create a line geometry
        const geometry = new THREE.BufferGeometry().setFromPoints(streamPoints);
        
        // Create line material
        const material = new THREE.LineBasicMaterial({
            color: 0x0088ff,
            linewidth: 2,
        });
        
        // Create line mesh
        const line = new THREE.Line(geometry, material);
        this.streamLines.add(line);
        
        // Add to scene
        this.scene.add(this.streamLines);
    }
}