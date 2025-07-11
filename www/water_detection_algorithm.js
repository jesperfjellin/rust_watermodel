/**
 * Advanced Water Body Detection Algorithm
 * 
 * Uses flow accumulation + slope analysis to identify actual water bodies:
 * - High flow accumulation = water naturally flows there
 * - Very low slope = flat enough for water to pool/flow slowly
 * - Connected patches = real water bodies are continuous
 * 
 * This approach identifies real rivers and lakes, not artificial depressions.
 */
export class WaterDetectionAlgorithm {
    constructor(renderer) {
        this.renderer = renderer;
        this.debugMode = true;
    }

    /**
     * Main water body detection using flow accumulation + slope analysis
     */
    detectWaterBodies(flowAccumulation, slopes, meshWidth, meshHeight) {
        console.log('🌊 Starting water body detection using Flow + Slope method');
        
        // Get raw elevation data (no vertical exaggeration)
        const rawElevData = this.renderer.storedTerrainData;
        if (!rawElevData || rawElevData.length === 0) {
            console.error('❌ No raw terrain data available');
            return new Array(meshWidth * meshHeight).fill(false);
        }

        // Calculate terrain statistics from raw data
        const terrainStats = this.calculateTerrainStats(rawElevData);
        console.log('🏔️ Raw elevation stats:', {
            min: terrainStats.min.toFixed(1),
            max: terrainStats.max.toFixed(1),
            mean: terrainStats.mean.toFixed(1)
        });

        // Calculate flow accumulation statistics
        const flowStats = this.calculateFlowStats(flowAccumulation);
        console.log('🌊 Flow accumulation stats:', {
            min: flowStats.min.toFixed(1),
            max: flowStats.max.toFixed(1),
            mean: flowStats.mean.toFixed(1),
            threshold95: flowStats.threshold95.toFixed(1),
            threshold99: flowStats.threshold99.toFixed(1)
        });

        // Step 1: Identify high-flow + low-slope cells
        console.log('🌊 Step 1: Identifying high-flow + low-slope cells...');
        const waterMask = this.identifyWaterCells(
            flowAccumulation, 
            slopes, 
            rawElevData, 
            meshWidth, 
            meshHeight, 
            flowStats, 
            terrainStats
        );

        const initialWaterCount = waterMask.filter(cell => cell).length;
        console.log('🌊 Initial water candidates:', initialWaterCount, 'cells');

        // Step 2: Filter by connected components (remove tiny patches)
        console.log('🌊 Step 2: Filtering by connected components...');
        const filteredMask = this.filterByConnectedComponents(waterMask, meshWidth, meshHeight);
        const filteredCount = filteredMask.filter(cell => cell).length;
        console.log('🌊 Connected component filter:', (initialWaterCount - filteredCount), 'cells removed,', filteredCount, 'remaining');

        // Step 3: Apply morphological closing (fill small gaps)
        console.log('🌊 Step 3: Applying morphological closing...');
        const finalMask = this.morphologicalClosing(filteredMask, meshWidth, meshHeight);
        const finalCount = finalMask.filter(cell => cell).length;
        console.log('🌊 Morphological closing:', filteredCount, '→', finalCount, 'cells');

        console.log('🌊 Final water detection:', finalCount, 'cells marked as water');
        return finalMask;
    }

    /**
     * Calculate terrain statistics from raw elevation data
     */
    calculateTerrainStats(elevationData) {
        const validElevations = elevationData.filter(val => val > 0 && !isNaN(val));
        const min = Math.min(...validElevations);
        const max = Math.max(...validElevations);
        const mean = validElevations.reduce((a, b) => a + b, 0) / validElevations.length;
        const range = max - min;
        
        return { min, max, mean, range };
    }

    /**
     * Calculate flow accumulation statistics
     */
    calculateFlowStats(flowAccumulation) {
        const validFlow = flowAccumulation.filter(val => val > 0 && !isNaN(val));
        const min = Math.min(...validFlow);
        const max = Math.max(...validFlow);
        const mean = validFlow.reduce((a, b) => a + b, 0) / validFlow.length;
        
        // Calculate percentile thresholds
        const sortedFlow = [...validFlow].sort((a, b) => a - b);
        const threshold95 = sortedFlow[Math.floor(sortedFlow.length * 0.95)];
        const threshold99 = sortedFlow[Math.floor(sortedFlow.length * 0.99)];
        
        return { min, max, mean, threshold95, threshold99 };
    }

    /**
     * Identify water cells using primarily flatness, with flow accumulation as secondary criteria
     */
    identifyWaterCells(flowAccumulation, slopes, elevationData, width, height, flowStats, terrainStats) {
        const waterMask = new Array(width * height).fill(false);
        
        // FLATNESS is the primary indicator of water bodies
        const extremeFlatSlope = 0.005;  // Extremely flat (0.5% grade) - likely water
        const veryFlatSlope = 0.01;      // Very flat (1% grade) - possible water
        const flatSlope = 0.02;          // Flat (2% grade) - rivers only
        
        // Flow accumulation thresholds (much more conservative)
        const moderateFlowThreshold = flowStats.mean * 1.5; // 50% above average
        const highFlowThreshold = flowStats.threshold95;     // Top 5% for rivers
        
        let lakeCount = 0;
        let riverCount = 0;
        let flatAreaCount = 0;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const flow = flowAccumulation[idx];
                const slope = slopes[idx];
                const elevation = elevationData[idx];
                
                // Skip invalid cells
                if (flow <= 0 || slope < 0 || elevation <= 0 || isNaN(flow) || isNaN(slope) || isNaN(elevation)) {
                    continue;
                }
                
                // Criterion 1: Extremely flat areas (likely lakes/reservoirs)
                // These have very low slopes and don't need high flow accumulation
                if (slope <= extremeFlatSlope) {
                    // Additional checks to avoid flat mountain tops
                    const isLowElevation = elevation < (terrainStats.min + terrainStats.range * 0.7);
                    const hasMinimalFlow = flow >= Math.max(2, flowStats.mean * 0.5); // At least some flow
                    
                    if (isLowElevation && hasMinimalFlow) {
                        waterMask[idx] = true;
                        lakeCount++;
                        continue;
                    }
                }
                
                // Criterion 2: Very flat areas with moderate flow (valley lakes)
                if (slope <= veryFlatSlope && flow >= moderateFlowThreshold) {
                    const isLowElevation = elevation < (terrainStats.min + terrainStats.range * 0.5);
                    
                    if (isLowElevation) {
                        waterMask[idx] = true;
                        flatAreaCount++;
                        continue;
                    }
                }
                
                // Criterion 3: Rivers (higher flow + moderate flatness)
                // Only for clearly flowing water, not pooling water
                if (flow >= highFlowThreshold && slope <= flatSlope) {
                    // Make sure it's not just a steep drainage channel
                    const isNotTooSteep = slope >= 0.005; // At least 0.5% slope to ensure it's flowing
                    
                    if (isNotTooSteep) {
                        waterMask[idx] = true;
                        riverCount++;
                        continue;
                    }
                }
            }
        }
        
        console.log('🌊 Water cell breakdown:', {
            lakes: lakeCount,
            flatAreas: flatAreaCount,
            rivers: riverCount,
            total: lakeCount + flatAreaCount + riverCount
        });
        
        return waterMask;
    }

    /**
     * Filter out small disconnected patches using connected component analysis
     */
    filterByConnectedComponents(waterMask, width, height) {
        const visited = new Array(width * height).fill(false);
        const filteredMask = new Array(width * height).fill(false);
        
        // Minimum size for water bodies (adjust based on resolution)
        const minWaterBodySize = 6; // At least 6 connected cells
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                if (waterMask[idx] && !visited[idx]) {
                    // Find connected component using flood fill
                    const component = this.floodFillComponent(waterMask, visited, x, y, width, height);
                    
                    // Keep component if it's large enough
                    if (component.length >= minWaterBodySize) {
                        for (const cellIdx of component) {
                            filteredMask[cellIdx] = true;
                        }
                    }
                }
            }
        }
        
        return filteredMask;
    }

    /**
     * Flood fill to find connected component
     */
    floodFillComponent(waterMask, visited, startX, startY, width, height) {
        const component = [];
        const stack = [{x: startX, y: startY}];
        
        while (stack.length > 0) {
            const {x, y} = stack.pop();
            const idx = y * width + x;
            
            if (x < 0 || x >= width || y < 0 || y >= height || visited[idx] || !waterMask[idx]) {
                continue;
            }
            
            visited[idx] = true;
            component.push(idx);
            
            // Add 8-connected neighbors
            stack.push({x: x+1, y: y});
            stack.push({x: x-1, y: y});
            stack.push({x: x, y: y+1});
            stack.push({x: x, y: y-1});
            stack.push({x: x+1, y: y+1});
            stack.push({x: x-1, y: y-1});
            stack.push({x: x+1, y: y-1});
            stack.push({x: x-1, y: y+1});
        }
        
        return component;
    }

    /**
     * Apply morphological closing to fill small gaps in water bodies
     */
    morphologicalClosing(waterMask, width, height) {
        // First apply dilation, then erosion
        const dilated = this.morphologicalDilation(waterMask, width, height);
        const closed = this.morphologicalErosion(dilated, width, height);
        return closed;
    }

    /**
     * Morphological dilation (expand water areas)
     */
    morphologicalDilation(waterMask, width, height) {
        const dilated = [...waterMask];
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                
                if (!waterMask[idx]) {
                    // Check if any neighbor is water
                    const hasWaterNeighbor = [
                        [-1, -1], [-1, 0], [-1, 1],
                        [0, -1],           [0, 1],
                        [1, -1],  [1, 0],  [1, 1]
                    ].some(([dx, dy]) => {
                        const nx = x + dx;
                        const ny = y + dy;
                        const nIdx = ny * width + nx;
                        return waterMask[nIdx];
                    });
                    
                    if (hasWaterNeighbor) {
                        dilated[idx] = true;
                    }
                }
            }
        }
        
        return dilated;
    }

    /**
     * Morphological erosion (shrink water areas)
     */
    morphologicalErosion(waterMask, width, height) {
        const eroded = [...waterMask];
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                
                if (waterMask[idx]) {
                    // Check if all neighbors are water
                    const allNeighborsWater = [
                        [-1, -1], [-1, 0], [-1, 1],
                        [0, -1],           [0, 1],
                        [1, -1],  [1, 0],  [1, 1]
                    ].every(([dx, dy]) => {
                        const nx = x + dx;
                        const ny = y + dy;
                        const nIdx = ny * width + nx;
                        return waterMask[nIdx];
                    });
                    
                    if (!allNeighborsWater) {
                        eroded[idx] = false;
                    }
                }
            }
        }
        
        return eroded;
    }

    /**
     * Apply water coloring to the terrain mesh
     */
    applyWaterColoring(waterMask, meshWidth, meshHeight) {
        if (!this.renderer.terrainMesh || !this.renderer.terrainMesh.geometry) {
            console.error('❌ No terrain geometry available for water coloring');
            return;
        }

        const geometry = this.renderer.terrainMesh.geometry;
        const colors = geometry.attributes.color;
        
        if (!colors) {
            console.error('❌ No color attribute found on terrain geometry');
            return;
        }

        let waterVerticesCount = 0;
        
        // Apply water coloring to vertices
        for (let y = 0; y < meshHeight; y++) {
            for (let x = 0; x < meshWidth; x++) {
                const maskIdx = y * meshWidth + x;
                const vertexIdx = y * (meshWidth + 1) + x;
                
                if (waterMask[maskIdx]) {
                    // Apply blue water color
                    colors.setXYZ(vertexIdx, 0.2, 0.5, 1.0); // Bright blue
                    waterVerticesCount++;
                }
            }
        }
        
        // Update the geometry
        colors.needsUpdate = true;
        
        console.log('🌊 Applied water coloring to', waterVerticesCount, 'vertices');
    }
} 