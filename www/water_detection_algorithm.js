/**
 * Topographically-Aware Water Detection Algorithm  ─  strict 0.2 m rule
 *
 *  • Seed: vertices whose 8 neighbours differ ≤ 0.2 m **and**
 *          local slope ≤ 2 % (≈1 m / 50 m).
 *  • Grow: flood-fill only to neighbours that are
 *          – not uphill (dElev ≤ 0),
 *          – |dElev| ≤ 0.2 m,
 *          – slope ≤ 2 %.
 *
 *  DEM grid spacing is assumed to be 100 m (change CELL_SIZE if different).
 *  Works directly on raw DEM vertices stored as (meshH+1) × (meshW+1).
 */

console.log('✅ Loading strict topographic water-detection algorithm');

const FLAT_THRESHOLD = 0.2;      // metres
const CELL_SIZE      = 100;      // metres per grid step (DEM resolution)
const MAX_SLOPE      = 0.02;     // 2 % grade  (= 0.02 = 0.02 m / 1 m)

function vIdx(x, y, w, h) {        // consistent y-flip helper
  return (h - y) * w + x;
}

/**
 * Detect water bodies and return an array of vertex indices.
 */
function detectWaterBodiesTopographic(flowAccum, slopes,
                                      elevationData,
                                      meshWidth, meshHeight) {

  const W = meshWidth  + 1;
  const H = meshHeight + 1;

  if (!elevationData || elevationData.length !== W * H) {
    console.error('❌ Invalid elevation array');
    return [];
  }

  const seeds = findFlatSeeds(elevationData, W, H);
  const water = new Set();

  seeds.forEach(seed => growWater(seed));

  console.log(`💧 Detected ${water.size} water vertices in ${seeds.length} seed patches`);
  return Array.from(water);

  /* ---------- helpers ---------- */

  /** find seed vertices that satisfy flatness + slope */
  function findFlatSeeds(elev, w, h) {
    const out = [];
    for (let y = 3; y < h - 3; ++y)
      for (let x = 3; x < w - 3; ++x) {

        const cIdx = vIdx(x, y, w, h);
        const cZ   = elev[cIdx];
        let ok = true;

        for (let dy = -1; dy <= 1 && ok; ++dy)
          for (let dx = -1; dx <= 1 && ok; ++dx) {
            if (!dx && !dy) continue;
            const nIdx = vIdx(x + dx, y + dy, w, h);
            const nZ   = elev[nIdx];
            const dZ   = Math.abs(cZ - nZ);
            const slope = dZ / CELL_SIZE;
            if (dZ > FLAT_THRESHOLD || slope > MAX_SLOPE) ok = false;
          }

        if (ok) out.push({ x, y, idx: cIdx, elevation: cZ });
      }
    console.log(`🔍 Flat seeds: ${out.length}`);
    return out;
  }

  /** flood-fill outward under strict downhill/flat criteria */
  function growWater(start) {
    const q     = [start];
    const seen  = new Set();
    const local = [];

    while (q.length) {
      const v   = q.shift();
      const key = `${v.x},${v.y}`;
      if (seen.has(key) || water.has(v.idx)) continue;
      seen.add(key);

      const cZ = elevationData[v.idx];
      water.add(v.idx);
      local.push(v.idx);

      for (let dy = -1; dy <= 1; ++dy)
        for (let dx = -1; dx <= 1; ++dx) {
          if (!dx && !dy) continue;

          const nx = v.x + dx, ny = v.y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;

          const nIdx = vIdx(nx, ny, W, H);
          if (seen.has(`${nx},${ny}`) || water.has(nIdx)) continue;

          const nZ     = elevationData[nIdx];
          const dZ     = nZ - cZ;              // neighbour minus current
          const slope  = Math.abs(dZ) / CELL_SIZE;

          if (dZ > 0)                continue; // uphill not allowed
          if (Math.abs(dZ) > FLAT_THRESHOLD) continue;
          if (slope > MAX_SLOPE)      continue;

          q.push({ x: nx, y: ny, idx: nIdx, elevation: nZ });
        }
    }

    if (local.length >= 5)
      console.log(`🌊 water body grown → ${local.length} vertices`);
    else
      local.forEach(idx => water.delete(idx));  // discard tiny puddles
  }
}

/* ----------------------------------------------------------------- */
/* module / browser export                                           */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectWaterBodiesTopographic };
} else {
  window.detectWaterBodiesTopographic = detectWaterBodiesTopographic;
}
