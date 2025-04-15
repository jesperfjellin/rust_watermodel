import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class LandingScene {
    constructor(canvas) {
        console.log("Initializing LandingScene with canvas:", canvas);
        
        // Initialize Three.js components
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf0f0f0); // Light background matching terrain visualization
        
        // Camera setup - moved further back for the larger room
        this.camera = new THREE.PerspectiveCamera(
            60, 
            canvas.clientWidth / canvas.clientHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(0, 15, 40); // Position further back and higher
        this.camera.lookAt(0, 0, 0);
        
        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ 
            canvas, 
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Controls for camera
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.2; // Slower rotation
        
        // Initialize animation properties
        this.clock = new THREE.Clock();
        
        // Setup empty room
        this.createEmptyRoom();
        
        // Add lighting matching the terrain visualization
        this.setupLightingMatchingTerrain();
        
        // Add event listeners
        window.addEventListener('resize', () => this.resize());
        
        // Start animation
        this.animate();
    }
    
    createEmptyRoom() {
        // Create a simple grid floor - make it subtle but visible
        const gridSize = 80; // Larger grid
        const divisions = 80; // More divisions for a finer grid
        const gridColor = 0xcccccc; // Light gray grid
        
        const gridHelper = new THREE.GridHelper(gridSize, divisions, 0x999999, gridColor);
        gridHelper.position.y = 0.01; // Slight offset to prevent z-fighting with floor
        this.scene.add(gridHelper);
        
        // Create floor - light colored to match terrain scene
        const floorGeometry = new THREE.PlaneGeometry(80, 80); // Larger floor to match grid
        const floorMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xe0e0e0, // Light floor matching terrain scene
            roughness: 0.9,
            metalness: 0.1,
            transparent: false,
            opacity: 1.0
        });
        
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);
        
        // Create subtle wall outlines
        this.createLightWalls();
    }
    
    createLightWalls() {
        // Create minimalist wall outlines with lighter colors
        const wallSize = 80; // Match the larger floor size
        const wallHeight = 40; // Taller walls for larger room
        
        // Add subtle grid lines to define the wall boundaries with light color
        const lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0xaaaaaa, // Light gray lines
            transparent: true, 
            opacity: 0.3 
        });
        
        // Create just the perimeter 
        const points = [
            // Back wall perimeter
            [
                new THREE.Vector3(-wallSize/2, 0, -wallSize/2),
                new THREE.Vector3(-wallSize/2, wallHeight, -wallSize/2),
                new THREE.Vector3(wallSize/2, wallHeight, -wallSize/2),
                new THREE.Vector3(wallSize/2, 0, -wallSize/2),
                new THREE.Vector3(-wallSize/2, 0, -wallSize/2)
            ],
            // Left wall perimeter
            [
                new THREE.Vector3(-wallSize/2, 0, -wallSize/2),
                new THREE.Vector3(-wallSize/2, wallHeight, -wallSize/2),
                new THREE.Vector3(-wallSize/2, wallHeight, wallSize/2),
                new THREE.Vector3(-wallSize/2, 0, wallSize/2),
                new THREE.Vector3(-wallSize/2, 0, -wallSize/2)
            ],
            // Right wall perimeter
            [
                new THREE.Vector3(wallSize/2, 0, -wallSize/2),
                new THREE.Vector3(wallSize/2, wallHeight, -wallSize/2),
                new THREE.Vector3(wallSize/2, wallHeight, wallSize/2),
                new THREE.Vector3(wallSize/2, 0, wallSize/2),
                new THREE.Vector3(wallSize/2, 0, -wallSize/2)
            ]
        ];
        
        points.forEach(wallPoints => {
            const lineGeometry = new THREE.BufferGeometry().setFromPoints(wallPoints);
            const line = new THREE.Line(lineGeometry, lineMaterial);
            this.scene.add(line);
        });
        
        // Add a few subtle grid lines
        const spacing = 20; // Large spacing for minimal lines
        for (let i = -wallSize/2 + spacing; i < wallSize/2; i += spacing) {
            // Minimal lines on back wall
            const backLineGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(i, 0, -wallSize/2 + 0.1),
                new THREE.Vector3(i, wallHeight, -wallSize/2 + 0.1)
            ]);
            const backLine = new THREE.Line(backLineGeometry, lineMaterial);
            this.scene.add(backLine);
            
            // Minimal lines on side walls
            const sideLineGeometry1 = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-wallSize/2 + 0.1, 0, i),
                new THREE.Vector3(-wallSize/2 + 0.1, wallHeight, i)
            ]);
            const sideLine1 = new THREE.Line(sideLineGeometry1, lineMaterial);
            this.scene.add(sideLine1);
            
            // Horizontal lines - very minimal
            if (i % (spacing * 2) === 0) {
                const horizHeight = i + wallHeight/2; // Position in the middle
                if (horizHeight > 0 && horizHeight < wallHeight) {
                    const horizLineGeometry = new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(-wallSize/2, horizHeight, -wallSize/2 + 0.1),
                        new THREE.Vector3(wallSize/2, horizHeight, -wallSize/2 + 0.1)
                    ]);
                    const horizLine = new THREE.Line(horizLineGeometry, lineMaterial);
                    this.scene.add(horizLine);
                }
            }
        }
    }
    
    setupLightingMatchingTerrain() {
        // Add ambient light - brighter to match terrain visualization
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);
        
        // Add directional light (sun-like) similar to terrain visualization
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(30, 40, 30);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.1;
        directionalLight.shadow.camera.far = 100;
        directionalLight.shadow.camera.left = -30;
        directionalLight.shadow.camera.right = 30;
        directionalLight.shadow.camera.top = 30;
        directionalLight.shadow.camera.bottom = -30;
        this.scene.add(directionalLight);
        
        // Add a secondary light for better definition
        const secondaryLight = new THREE.DirectionalLight(0xf0e0c0, 0.4); // Warm secondary light
        secondaryLight.position.set(-20, 30, -20);
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
        // Skip animation if we're already disposed
        if (!this.clock || !this.scene || !this.renderer) {
            console.log("Skipping animation - LandingScene disposed");
            return;
        }
        
        // Store animation frame ID so we can cancel it when disposed
        this._animationFrameId = requestAnimationFrame(() => this.animate());
        
        const delta = this.clock.getDelta();
        
        // Update controls if they exist
        if (this.controls) {
            this.controls.update();
        }
        
        // Skip rendering if renderer is missing or context lost
        if (!this.renderer) return;
        
        try {
            // Render the scene
            this.renderer.render(this.scene, this.camera);
        } catch (error) {
            console.error("Error in LandingScene animation loop:", error);
        }
    }
    
    dispose() {
        // Clean up resources when no longer needed
        console.log("Disposing LandingScene completely");
        
        // Remove event listeners
        window.removeEventListener('resize', this.resize);
        
        // Dispose of all Three.js resources
        this.disposeThreeJsResources();
        
        // Explicitly release references
        this.scene = null;
        this.camera = null;
        this.clock = null;
        this.controls = null;
    }
    
    disposeThreeJsResources() {
        // Stop animation loop
        if (this._animationFrameId) {
            cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }
        
        // Dispose of all scene objects
        if (this.scene) {
            this.scene.traverse(object => {
                // Dispose geometries
                if (object.geometry) {
                    object.geometry.dispose();
                }
                
                // Dispose materials
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        for (const material of object.material) {
                            this.disposeMaterial(material);
                        }
                    } else {
                        this.disposeMaterial(object.material);
                    }
                }
            });
        }
        
        // Dispose controls
        if (this.controls) {
            this.controls.dispose();
        }
        
        // Properly dispose renderer last
        if (this.renderer) {
            console.log("Disposing WebGL renderer");
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            const gl = this.renderer.getContext();
            if (gl) {
                const extension = gl.getExtension('WEBGL_lose_context');
                if (extension) extension.loseContext();
            }
            this.renderer = null;
        }
    }
    
    disposeMaterial(material) {
        if (material.map) material.map.dispose();
        if (material.lightMap) material.lightMap.dispose();
        if (material.bumpMap) material.bumpMap.dispose();
        if (material.normalMap) material.normalMap.dispose();
        if (material.specularMap) material.specularMap.dispose();
        if (material.envMap) material.envMap.dispose();
        material.dispose();
    }
} 