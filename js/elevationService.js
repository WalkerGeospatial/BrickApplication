/**
 * elevationService.js
 * Reads elevation from Terrarium-format terrain tiles served by AWS open data.
 *
 * URL: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 * Encoding: elevation (m) = (R * 256 + G + B / 256) - 32768
 *
 * Advantages over a REST elevation API:
 *   - No rate limits
 *   - Works from file:// origins (tiles have CORS headers)
 *   - A typical selection needs only 4–25 tile downloads regardless of
 *     how many sample points are requested
 *
 * For each grid cell, 5 sample points are used:
 *   centre + midpoints toward each of the 4 corners
 */

const ElevationService = (() => {
  const TILE_URL  = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const TILE_SIZE = 256;
  const tileCache = {}; // "z/x/y" → ImageData

  // ── Slippy-map tile math ───────────────────────────────────────────────

  function lonToTileX(lon, z) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
  }

  function latToTileY(lat, z) {
    const r = lat * Math.PI / 180;
    return Math.floor(
      (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)
    );
  }

  /** Pixel offset (0–255) within a tile for a given lat/lon. */
  function latLonToPixel(lat, lon, tileX, tileY, z) {
    const n   = Math.pow(2, z);
    const px  = ((lon + 180) / 360 * n - tileX) * TILE_SIZE;
    const r   = lat * Math.PI / 180;
    const py  = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n - tileY) * TILE_SIZE;
    return {
      px: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(px))),
      py: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(py))),
    };
  }

  function terrariumToElevation(r, g, b) {
    return (r * 256 + g + b / 256) - 32768;
  }

  // ── Tile loading ───────────────────────────────────────────────────────

  function loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (tileCache[key]) return Promise.resolve(tileCache[key]);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = TILE_SIZE;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
          tileCache[key] = imageData;
          resolve(imageData);
        } catch (e) {
          // Canvas tainted — CORS headers missing on this tile server
          reject(new Error(`Tile ${key} blocked CORS read. Try a local server (python -m http.server).`));
        }
      };

      img.onerror = () => reject(new Error(`Failed to load elevation tile ${key}`));
      img.src = TILE_URL
        .replace('{z}', z)
        .replace('{x}', x)
        .replace('{y}', y);
    });
  }

  function readElevation(imageData, px, py) {
    const i = (py * TILE_SIZE + px) * 4;
    return terrariumToElevation(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
  }

  // ── Zoom selection ─────────────────────────────────────────────────────

  /**
   * Pick the highest zoom where the area fits in ≤ 8×8 tiles.
   * Higher zoom = finer elevation detail.
   */
  function chooseBestZoom(bounds) {
    const clat    = (bounds.minLat + bounds.maxLat) / 2;
    const latKm   = (bounds.maxLat - bounds.minLat) * 111.32;
    const lonKm   = (bounds.maxLon - bounds.minLon) * 111.32 * Math.cos(clat * Math.PI / 180);
    const sideKm  = Math.max(latKm, lonKm);

    for (let z = 13; z >= 5; z--) {
      const tileKm = 40075 * Math.cos(clat * Math.PI / 180) / Math.pow(2, z);
      if (sideKm / tileKm <= 8) return z;
    }
    return 5;
  }

  // ── 5-point cell sampling ──────────────────────────────────────────────

  function getCellSamplePoints(minLat, minLon, maxLat, maxLon) {
    const cx = (minLat + maxLat) / 2;
    const cy = (minLon + maxLon) / 2;
    return [
      { lat: cx,                 lon: cy                },  // centre
      { lat: (cx + maxLat) / 2,  lon: (cy + minLon) / 2 }, // → NW
      { lat: (cx + maxLat) / 2,  lon: (cy + maxLon) / 2 }, // → NE
      { lat: (cx + minLat) / 2,  lon: (cy + minLon) / 2 }, // → SW
      { lat: (cx + minLat) / 2,  lon: (cy + maxLon) / 2 }, // → SE
    ];
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * @param {object}   bounds     { minLat, maxLat, minLon, maxLon }
   * @param {number}   gridCols
   * @param {number}   gridRows
   * @param {function} onProgress (fraction 0–1, statusText)
   * @returns {Promise<number[][]>} [row][col] average elevation in metres
   */
  async function getGridElevations(bounds, gridCols, gridRows, onProgress) {
    const zoom = chooseBestZoom(bounds);

    const { minLat, maxLat, minLon, maxLon } = bounds;
    const cellLatSize = (maxLat - minLat) / gridRows;
    const cellLonSize = (maxLon - minLon) / gridCols;

    // Build all 5×(32×32) = 5120 sample points + cell mapping
    const allPoints = [];
    const cellMap   = [];

    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const cMinLat = minLat + row * cellLatSize;
        const cMinLon = minLon + col * cellLonSize;
        const pts = getCellSamplePoints(
          cMinLat, cMinLon, cMinLat + cellLatSize, cMinLon + cellLonSize
        );
        cellMap.push({ row, col, startIdx: allPoints.length, count: pts.length });
        allPoints.push(...pts);
      }
    }

    // Find the unique set of tiles required
    const tileSet = new Set();
    for (const pt of allPoints) {
      tileSet.add(`${zoom}/${lonToTileX(pt.lon, zoom)}/${latToTileY(pt.lat, zoom)}`);
    }
    const tileList = [...tileSet];

    onProgress(0, `Downloading ${tileList.length} elevation tile${tileList.length !== 1 ? 's' : ''} (zoom ${zoom})…`);

    // Download all tiles (with simple concurrency cap of 4)
    const CONCURRENCY = 4;
    for (let i = 0; i < tileList.length; i += CONCURRENCY) {
      const batch = tileList.slice(i, i + CONCURRENCY).map(key => {
        const [z, x, y] = key.split('/').map(Number);
        return loadTile(z, x, y);
      });
      await Promise.all(batch);
      onProgress(
        (Math.min(i + CONCURRENCY, tileList.length)) / tileList.length * 0.8,
        `Loaded ${Math.min(i + CONCURRENCY, tileList.length)} / ${tileList.length} tiles…`
      );
    }

    // Sample elevation at every point from the cached tile data
    onProgress(0.85, 'Sampling elevation values…');
    const elevations = allPoints.map(pt => {
      const tx  = lonToTileX(pt.lon, zoom);
      const ty  = latToTileY(pt.lat, zoom);
      const img = tileCache[`${zoom}/${tx}/${ty}`];
      const { px, py } = latLonToPixel(pt.lat, pt.lon, tx, ty, zoom);
      return readElevation(img, px, py);
    });

    // Average the 5 samples per cell
    const grid = Array.from({ length: gridRows }, () => new Array(gridCols).fill(0));
    for (const { row, col, startIdx, count } of cellMap) {
      const samples = elevations.slice(startIdx, startIdx + count);
      const valid   = samples.map(e => Math.max(0, e)); // clamp ocean to 0
      grid[row][col] = valid.reduce((a, b) => a + b, 0) / valid.length;
    }

    onProgress(1, 'Done!');
    return grid;
  }

  return { getGridElevations };
})();
