# Pre-computation Guide

This guide explains how to use the pre-computation system to create optimized assets for your hydrological visualization tool.

## Overview

The pre-computation system processes your GeoTIFF DEM files once and creates optimized binary assets that can be loaded instantly in the web viewer. This eliminates the need to process DEMs on-the-fly for each user.

## Architecture

```
Raw GeoTIFF DEMs → Pre-computation Tool → Optimized Binary Assets → Web Viewer
```

### What Gets Pre-computed

1. **Terrain Data**: Optimized elevation data with mesh optimization
2. **Flow Analysis**: Flow directions, accumulation, and slopes
3. **Stream Networks**: Multiple detail levels (detailed, medium, major)
4. **Water Visualization**: Spawn points, velocities, and flow data
5. **Metadata**: Catchment information and processing timestamps

## Setup

### 1. Prepare Your DEM Files

Place your GeoTIFF DEM files in a directory structure like this:

```
data/
├── dems/
│   ├── catchment_01.tif
│   ├── catchment_02.tif
│   ├── catchment_03.tif
│   └── ...
```

### 2. Run Pre-computation

Use the provided script to process all your DEMs:

```bash
# Make the script executable
chmod +x scripts/precompute.sh

# Run pre-computation
./scripts/precompute.sh ./data/dems ./www/precomputed
```

Or run manually:

```bash
# Build the tool
cargo build --release --bin precompute

# Run pre-computation
./target/release/precompute ./data/dems ./www/precomputed
```

### 3. Serve the Web Viewer

```bash
cd www
python3 -m http.server 8000
```

Then visit: `http://localhost:8000/precomputed_viewer.html`

## Output Structure

After pre-computation, you'll have:

```
www/
├── precomputed/
│   ├── catchment_index.json          # Index of all catchments
│   ├── catchment_01.bin             # Binary data for catchment 1
│   ├── catchment_02.bin             # Binary data for catchment 2
│   └── ...
├── precomputed_viewer.html          # Web viewer
└── precomputed_viewer.js            # Viewer logic
```

## Integration with Hydrological Toolbox

To integrate this with your existing hydrological toolbox:

### Option 1: Embed the Viewer

Add an iframe to your toolbox:

```html
<iframe src="/path/to/precomputed_viewer.html" 
        width="100%" 
        height="600px"
        style="border: none;">
</iframe>
```

### Option 2: API Integration

Modify the viewer to accept parameters:

```javascript
// Load specific catchment programmatically
window.loadCatchmentById('catchment_01');
```

### Option 3: Custom Integration

Use the pre-computed data directly in your existing application:

```javascript
// Load pre-computed data
const response = await fetch('./precomputed/catchment_01.bin');
const data = await deserializeCatchmentData(await response.arrayBuffer());

// Use the data in your existing visualization
```

## Performance Benefits

### Before Pre-computation
- **DEM Processing**: 5-30 seconds per catchment
- **Flow Analysis**: 10-60 seconds per catchment
- **Total Load Time**: 15-90 seconds per user

### After Pre-computation
- **Asset Loading**: 1-5 seconds per catchment
- **Rendering**: Instant
- **Total Load Time**: 1-5 seconds per user

## File Sizes

Typical file sizes for a 1000x1000 DEM:

- **Raw GeoTIFF**: ~4 MB
- **Pre-computed Binary**: ~8-12 MB (includes all analysis)
- **Compressed Binary**: ~2-4 MB (with gzip compression)

## Updating Pre-computed Data

When you get new DEM data:

1. Replace the old GeoTIFF files
2. Re-run the pre-computation script
3. The new data will be automatically available

## Troubleshooting

### Common Issues

1. **"No GeoTIFF files found"**
   - Check file extensions (.tif or .tiff)
   - Ensure files are readable

2. **"GDAL features not available"**
   - Build with native features: `cargo build --features native`

3. **Large file sizes**
   - Consider using compression
   - Implement progressive loading for very large catchments

### Performance Optimization

1. **For very large DEMs**: Implement tiling
2. **For many catchments**: Use lazy loading
3. **For slow networks**: Add compression and caching headers

## Advanced Usage

### Custom Processing Parameters

Modify `src/precompute.rs` to change processing parameters:

```rust
// Change sink filling method
dem.process_sinks(crate::dem::SinkTreatmentMethod::Combined(0.1, 10));

// Change stream thresholds
let detailed_streams = generate_high_quality_streams(&flow_model, 0.005);
```

### Batch Processing

For automated processing, create a cron job:

```bash
# Add to crontab
0 2 * * * /path/to/scripts/precompute.sh /data/dems /www/precomputed
```

### Monitoring

Add logging to track processing:

```bash
./scripts/precompute.sh ./data/dems ./www/precomputed 2>&1 | tee precompute.log
```

## Next Steps

1. **Implement binary deserialization** in the web viewer
2. **Add stream visualization** to the 3D renderer
3. **Add water flow animation** using pre-computed data
4. **Implement progressive loading** for large datasets
5. **Add compression** for network optimization 