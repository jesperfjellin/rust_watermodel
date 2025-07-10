# Rust Water Model

**Interactive 3D Hydrological Flow Visualization from Digital Elevation Models**

Transform raw elevation data into comprehensive 3D water flow models that reveal how water moves through catchments. This tool processes Digital Elevation Models (DEMs) through a complete hydrological analysis pipeline, generating interactive browser-based visualizations.

## Methodology

### Process: From DEM to Hydrological Model

Our analysis transforms raw elevation data through a systematic hydrological processing pipeline:

#### 1. **DEM Preprocessing & Optimization**
```
Raw GeoTIFF (10m resolution) → Downsampled DEM (100m resolution)
```

- **Input**: GeoTIFF Digital Elevation Model at native resolution (typically 10m)
- **Downsampling**: Systematic reduction to 100m resolution using averaging
  - Reduces data volume by ~100x (25M cells → 256K cells)
  - Maintains hydrological integrity while enabling browser performance
  - Example: 5051×5051 grid → 506×506 grid
- **Quality Control**: Removal of negative elevations and invalid data points
- **Coordinate System**: Preserves original geospatial referencing

#### 2. **Hydrological Conditioning**
```
Raw DEM → Sink-Filled DEM → Hydrologically Correct Surface
```

- **Sink Identification**: Detection of artificial depressions in elevation data
- **Priority-Flood Algorithm**: Systematic filling of sinks to ensure continuous drainage
  - Processes cells in elevation order (lowest to highest)
  - Raises sink cells to create minimal drainage paths
  - Maintains realistic topographic gradients
- **Drainage Enforcement**: Ensures every cell can route water to catchment outlets

#### 3. **Flow Direction Analysis (D8 Method)**
```
Conditioned DEM → Flow Direction Grid → Drainage Network Topology
```

- **D8 Algorithm**: Single-direction flow routing to steepest downslope neighbor
  - Evaluates all 8 adjacent cells (cardinal + diagonal directions)
  - Calculates slope: `(elevation_drop / distance)`
  - Diagonal distances adjusted for √2 factor
- **Flow Codes**: Each cell assigned direction code (1=E, 2=SE, 4=S, 8=SW, 16=W, 32=NW, 64=N, 128=NE)
- **Slope Calculation**: Gradient magnitude stored for velocity modeling

#### 4. **Flow Accumulation Computation**
```
Flow Directions → Drainage Area Analysis → Flow Volume Distribution
```

- **Topological Sorting**: Processes cells from ridges to valleys
- **Accumulation Algorithm**: Each cell accumulates flow from all upstream cells
  - Starts with initial value of 1 (representing unit rainfall)
  - Recursively sums contributions from upslope neighbors
  - Results in drainage area for each cell
- **Network Identification**: High accumulation values identify stream channels

#### 5. **Multi-Scale Stream Extraction**
```
Flow Accumulation → Threshold Analysis → Hierarchical Stream Networks
```

- **Threshold-Based Classification**:
  - **Detailed streams** (1% threshold): Minor tributaries and headwaters
  - **Medium streams** (5% threshold): Secondary drainage channels  
  - **Major streams** (10% threshold): Primary rivers and main stems
- **Polyline Generation**: Connected stream segments traced downstream
- **Topology Preservation**: Maintains confluence relationships and drainage hierarchy

#### 6. **Water Flow Visualization Modeling**
```
Hydrological Analysis → Particle Motion Parameters → 3D Flow Animation
```

- **Velocity Field Generation**: 
  - Base velocity from slope: `v ∝ slope^0.5` (Manning's equation approximation)
  - Flow enhancement: `v_factor ∝ (flow_accumulation)^0.4`
  - Direction vectors from flow direction grid
- **Spawn Point Selection**: Strategic placement of particle origins
  - Junction points where tributaries meet
  - High-accumulation cells (significant drainage area)
  - Distributed sampling every ~20 cells along streams
- **Motion Physics**: Simplified particle advection following flow vectors

#### 7. **3D Terrain Visualization**
```
Elevation Data → Mesh Generation → Photorealistic 3D Model
```

- **Mesh Optimization**: Adaptive vertex density based on terrain complexity
  - Target: ≤2048 vertices per dimension for WebGL compatibility
  - Skip factor calculation for large DEMs
  - Maintains critical topographic features
- **Elevation Mapping**: Vertical exaggeration (8.5x) for visual clarity
  - **Note**: Exaggeration is purely visual; all hydrological calculations use true geometry
- **Color Gradients**: 7-step elevation-based coloring:
  - **Deep valleys**: Deep green (low elevation)
  - **Hills**: Olive to yellow ochre (medium elevation)  
  - **Mountains**: Orange to red (high elevation)
  - **Peaks**: Purple (highest elevation)
- **Lighting Model**: Multi-directional lighting for topographic definition

#### 8. **Data Export & Optimization**
```
Processed Model → JSON Serialization → Browser-Ready Assets
```

- **Structured Output**: Comprehensive data package including:
  - Optimized terrain mesh data (elevation + color vertices)
  - Flow analysis results (directions, accumulation, slopes)
  - Multi-resolution stream networks
  - Particle spawn points and velocity fields
  - Catchment metadata and bounds
- **File Optimization**: ~30MB JSON files (vs 3GB raw data)
- **Browser Compatibility**: Direct loading in web browsers (2-5 second load times)

### Key Innovations

1. **Performance-Optimized Hydrology**: 100m resolution provides excellent flow representation while maintaining browser compatibility
2. **Multi-Scale Stream Networks**: Hierarchical detail levels enable zoom-appropriate visualization
3. **Real-Time 3D Rendering**: WebGL-optimized meshes with elevation-based coloring
4. **Complete Pipeline**: End-to-end processing from raw DEM to interactive model

### Output Specifications

**File Format**: JSON with structured hydrological data
**Typical File Size**: 20-50MB per catchment (100x smaller than raw data)
**Load Time**: 2-5 seconds in modern browsers
**Supported DEM Formats**: GeoTIFF (.tif, .tiff)
**Resolution Range**: Optimized for 10m-100m source data

## Usage

### Pre-computation
```bash
# Process all DEMs in directory
./scripts/precompute.sh ./data/dems ./www/precomputed

# View results
npm start
# Open: http://localhost:3000/precomputed_viewer.html
```

### Real-time Processing
```bash
npm start
# Open: http://localhost:3000/
# Drag & drop GeoTIFF files directly in browser
```
