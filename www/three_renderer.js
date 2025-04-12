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
        this.particleSystem = null;
        this.streamLines = null;
        
        // Stats
        this.dimensions = null;
        this.flowData = null;
        this.streamData = null;
        this.slopeData = null;
        this.velocityData = null;
        this.spawnPoints = null;
        
        // Animation
        this.isAnimating = false;
        this.particleLifecycles = null;
        this.particleLifetime = 300; // frames
        this.flowSpeed = 1.0; // speed multiplier
        this.particleDensity = 10000; // desired number of particles
        this.showWater = true; // whether water particles are visible
        
        // Setup resize handler
        window.addEventListener('resize', () => this.resize());
        
        // Start render loop
        this.animate();
    }
    
    addLights() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);
        
        // Directional light (sun)
        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(1, 1, 1);
        directional.castShadow = true;
        directional.shadow.mapSize.width = 2048;
        directional.shadow.mapSize.height = 2048;
        this.scene.add(directional);
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
        
        // Update particle positions if we have a flow model
        if (this.isAnimating && this.particleSystem && this.showWater) {
            try {
                this.updateParticles();
            } catch (error) {
                console.error("Animation error:", error);
                // Disable animation on error to prevent endless error logs
                this.isAnimating = false;
            }
        }
        
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
        
        for (let y = 0; y < meshHeight; y++) {
            for (let x = 0; x < meshWidth; x++) {
                // Map mesh coordinates to original DEM coordinates
                const demX = Math.min(width - 1, x * skipFactor);
                const demY = Math.min(height - 1, y * skipFactor);
                const demIndex = demY * width + demX;
                const vertexIndex = y * (meshWidth + 1) + x;
                
                // Get elevation and update min/max
                const elevation = terrainData[demIndex];
                if (!isNaN(elevation)) {
                    minHeight = Math.min(minHeight, elevation);
                    maxHeight = Math.max(maxHeight, elevation);
                }
                
                // Set Z value for this vertex (using stronger height exaggeration)
                if (vertexIndex < geometry.attributes.position.count) {
                    // Increase the height exaggeration factor significantly for better visibility
                    const heightScale = 2.0 * scaleDown; // 10x increased from previous 0.2
                    geometry.attributes.position.setZ(vertexIndex, elevation * heightScale);
                }
            }
        }
        
        console.log(`Terrain elevation range: ${minHeight} to ${maxHeight}`);
        
        // Update the geometry
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        
        // Create terrain material
        const material = new THREE.MeshStandardMaterial({
            color: 0x859970,
            metalness: 0.0,
            roughness: 0.8,
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
        
        // Store scale factor for particles and other elements
        this.terrainScale = scaleDown;
        this.heightScale = 2.0 * scaleDown; // Update the heightScale to match the exaggeration
    }
    
    // Set comprehensive water visualization data
    setWaterVisualizationData(waterData) {
        try {
            // Check water data structure and assign properties safely
            this.flowData = waterData.flow_accumulation || [];
            this.slopeData = waterData.slopes || [];
            
            // Handle velocities data which might be in a different format
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
            
            // Create particles for water flow visualization
            this.createParticleSystem();
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
        
        // Clean up previous lines
        if (this.streamLines) {
            this.scene.remove(this.streamLines);
            this.streamLines = null;
        }
        
        const [width, height, resolution] = this.dimensions;
        const scaleDown = this.terrainScale || 1.0;
        const heightScale = this.heightScale || 0.2 * scaleDown;
        
        // Create a group for all stream lines
        this.streamLines = new THREE.Group();
        
        // Material for stream lines
        const material = new THREE.LineBasicMaterial({
            color: 0x0088ff,
            linewidth: 1,
            opacity: 0.8,
            transparent: true
        });
        
        // Create a line for each stream polyline
        for (const polyline of polylines) {
            const points = [];
            
            // Convert from grid coordinates to world coordinates and add points
            for (let i = 0; i < polyline.length; i++) {
                const [x, y] = polyline[i];
                
                // Get the corresponding point on the terrain
                const worldX = (x / width) * width * resolution * scaleDown - (width * resolution * scaleDown / 2);
                const worldZ = (y / height) * height * resolution * scaleDown - (height * resolution * scaleDown / 2);
                
                // Get the height at this position
                const terrainX = Math.floor(x);
                const terrainY = Math.floor(y);
                const terrainIndex = terrainY * width + terrainX;
                let terrainHeight = 0;
                
                if (terrainIndex >= 0 && terrainIndex < this.dimensions[0] * this.dimensions[1]) {
                    // Get height from terrain data if available
                    if (this.terrainMesh && this.terrainMetadata) {
                        // Calculate the corresponding vertex in our decimated mesh
                        const skipFactor = this.terrainMetadata.skipFactor || 1;
                        const meshX = Math.floor(terrainX / skipFactor);
                        const meshY = Math.floor(terrainY / skipFactor);
                        const meshWidth = this.terrainMetadata.meshWidth;
                        const vertexIndex = meshY * (meshWidth + 1) + meshX;
                        
                        if (vertexIndex < this.terrainMesh.geometry.attributes.position.count) {
                            terrainHeight = this.terrainMesh.geometry.attributes.position.getZ(vertexIndex) + 0.5;
                        }
                    }
                }
                
                // Add the point with a small offset above the terrain
                points.push(new THREE.Vector3(worldX, terrainHeight, worldZ));
            }
            
            // Create the line geometry
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, material);
            
            // Add to the group
            this.streamLines.add(line);
        }
        
        // Add all stream lines to the scene
        this.scene.add(this.streamLines);
        console.log(`Created ${polylines.length} stream lines`);
    }
    
    // For backward compatibility
    setFlowData(flowData) {
        this.flowData = flowData;
        
        if (!this.velocityData) {
            // Create a simplified velocity field based on flow only
            this.velocityData = flowData.map(flow => Math.log1p(flow) * 0.1);
        }
        
        // Create particles for water flow visualization
        this.createParticleSystem();
    }
    
    // For backward compatibility
    setStreamNetwork(streamData) {
        this.streamData = streamData;
        
        // Visualize streams as blue lines
        this.createStreamLines();
    }
    
    // Toggle water visibility
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
            ctx.beginPath();
            ctx.arc(16, 16, 14, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
            
            const texture = new THREE.CanvasTexture(canvas);
            
            // Create material for particles
            const material = new THREE.PointsMaterial({
                size: 4,
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
        
        // Prefer spawning at stream spawn points if available
        if (this.spawnPoints && this.spawnPoints.length > 0 && Math.random() < 0.8) {
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
        let flow = 0;
        if (flowIndex >= 0 && flowIndex < this.flowData.length) {
            flow = this.flowData[flowIndex];
        }
        
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
                        worldY = this.terrainMesh.geometry.attributes.position.getZ(vertexIndex) + 5.0;
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
        
        // Set color (blue water)
        colors[i3] = 0.3;
        colors[i3 + 1] = 0.7;
        colors[i3 + 2] = 1.0;
        
        // Set size
        const normalizedFlow = Math.min(1.0, flow / (maxFlow * 0.1));
        sizes[index] = 2.0 + normalizedFlow * 4.0;
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
        
        // Update a random subset of particles each frame for better performance
        const updateCount = Math.min(1000, particleCount);
        
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
            
            // Simplified flow calculation - just move downhill
            let velocityX = 0;
            let velocityZ = 0;
            let speed = 0.1;  // default speed
            
            // Find neighboring cell with lowest elevation
            let lowestNeighborX = gridX;
            let lowestNeighborZ = gridZ;
            let lowestElevation = Infinity;
            
            // Check cardinal directions
            const directions = [
                {dx: 0, dz: 1},   // North
                {dx: 1, dz: 0},   // East
                {dx: 0, dz: -1},  // South
                {dx: -1, dz: 0},  // West
            ];
            
            // Find lowest neighbor
            for (const {dx, dz} of directions) {
                const neighborX = gridX + dx;
                const neighborZ = gridZ + dz;
                
                if (neighborX < 0 || neighborX >= width || neighborZ < 0 || neighborZ >= height) continue;
                
                const meshX = Math.floor(neighborX / skipFactor);
                const meshY = Math.floor(neighborZ / skipFactor);
                const meshWidth = this.terrainMetadata?.meshWidth || width;
                const vertexIndex = meshY * (meshWidth + 1) + meshX;
                
                if (vertexIndex < this.terrainMesh.geometry.attributes.position.count) {
                    const elevation = this.terrainMesh.geometry.attributes.position.getZ(vertexIndex);
                    
                    if (elevation < lowestElevation) {
                        lowestElevation = elevation;
                        lowestNeighborX = neighborX;
                        lowestNeighborZ = neighborZ;
                    }
                }
            }
            
            // Calculate movement direction
            velocityX = (lowestNeighborX - gridX);
            velocityZ = (lowestNeighborZ - gridZ);
            
            // Normalize direction
            const length = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);
            if (length > 0) {
                velocityX /= length;
                velocityZ /= length;
            }
            
            // Move the particle
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
                    const height = this.terrainMesh.geometry.attributes.position.getZ(vertexIndex);
                    positions[i3 + 1] = height + 5.0;
                }
            }
        }
        
        // Update the geometry
        this.particleSystem.geometry.attributes.position.needsUpdate = true;
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