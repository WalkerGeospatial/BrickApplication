/**
 * imageryService.js
 * Samples per-cell colours from ESRI World Imagery satellite tiles.
 *
 * Tile URL (note ESRI uses z/y/x order):
 *   https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
 *
 * For each grid cell the centre + 4 midpoints toward corners are sampled,
 * then the RGB values are averaged to give one representative colour per cell.
 * Optionally the colour is snapped to the nearest official brick colour.
 */

const ImageryService = (() => {
  const TILE_URL  = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const TILE_SIZE = 256;
  const tileCache = {};

  // ── Brick colour palette — colours available as 1×1 plate (BL part 3024) ──
  // Source: BrickLink catalogColors.asp?itemType=P&itemNo=3024
  // Hex values from Rebrickable. [r, g, b, hex]
  const BRICK_PALETTE = [
    // Grays & White
    [255, 255, 255, '#FFFFFF'],  // White
    [230, 227, 218, '#E6E3DA'],  // Very Light Gray
    [230, 227, 224, '#E6E3E0'],  // Very Light Bluish Gray
    [160, 165, 169, '#A0A5A9'],  // Light Bluish Gray
    [155, 161, 157, '#9BA19D'],  // Light Gray
    [109, 110,  92, '#6D6E5C'],  // Dark Gray
    [108, 110, 104, '#6C6E68'],  // Dark Bluish Gray
    [ 33,  33,  33, '#212121'],  // Black
    // Reds
    [114,  14,  15, '#720E0F'],  // Dark Red
    [201,  26,   9, '#C91A09'],  // Red
    [202,  76,  11, '#CA4C0B'],  // Reddish Orange
    [255, 104, 143, '#FF688F'],  // Coral
    [214, 117, 114, '#D67572'],  // Sand Red
    // Browns & Tans
    [ 53,  33,   0, '#352100'],  // Dark Brown
    [ 88,  57,  39, '#583927'],  // Brown
    [ 88,  42,  18, '#582A12'],  // Reddish Brown
    [124,  80,  58, '#7C503A'],  // Light Brown
    [149, 138, 115, '#958A73'],  // Dark Tan
    [228, 205, 158, '#E4CD9E'],  // Tan
    [246, 215, 179, '#F6D7B3'],  // Light Nougat
    [208, 145, 104, '#D09168'],  // Nougat
    [170, 125,  85, '#AA7D55'],  // Medium Nougat
    // Oranges & Yellows
    [169,  85,   0, '#A95500'],  // Dark Orange
    [254, 138,  24, '#FE8A18'],  // Orange
    [255, 167,  11, '#FFA70B'],  // Medium Orange
    [248, 187,  61, '#F8BB3D'],  // Bright Light Orange
    [243, 207, 155, '#F3CF9B'],  // Very Light Orange
    [242, 205,  55, '#F2CD37'],  // Yellow
    [255, 240,  58, '#FFF03A'],  // Bright Light Yellow
    // Greens
    [217, 228, 167, '#D9E4A7'],  // Light Lime
    [223, 238, 165, '#DFEEA5'],  // Yellowish Green
    [199, 210,  60, '#C7D23C'],  // Medium Lime
    [187, 233,  11, '#BBE90B'],  // Lime
    [155, 154,  90, '#9B9A5A'],  // Olive Green
    [ 24,  70,  50, '#184632'],  // Dark Green
    [ 35, 120,  65, '#237841'],  // Green
    [ 75, 159,  74, '#4B9F4A'],  // Bright Green
    [115, 220, 161, '#73DCA1'],  // Medium Green
    [194, 218, 184, '#C2DAB8'],  // Light Green
    [160, 188, 172, '#A0BCAC'],  // Sand Green
    // Teals & Blues
    [  0, 143, 155, '#008F9B'],  // Dark Turquoise
    [173, 195, 192, '#ADC3C0'],  // Light Aqua
    [ 10,  52,  99, '#0A3463'],  // Dark Blue
    [  0,  85, 191, '#0055BF'],  // Blue
    [  7, 139, 201, '#078BC9'],  // Dark Azure
    [ 53, 146, 195, '#3592C3'],  // Maersk Blue
    [ 54, 174, 191, '#36AEBF'],  // Medium Azure
    [ 90, 147, 219, '#5A93DB'],  // Medium Blue
    [159, 195, 233, '#9FC3E9'],  // Bright Light Blue
    [ 96, 116, 161, '#6074A1'],  // Sand Blue
    // Purples & Pinks
    [163, 169, 255, '#A3A9FF'],  // Blue Violet
    [147, 145, 228, '#9391E4'],  // Medium Violet
    [ 63,  54, 145, '#3F3691'],  // Dark Purple
    [129,   0, 123, '#81007B'],  // Purple
    [172, 120, 186, '#AC78BA'],  // Medium Lavender
    [225, 213, 237, '#E1D5ED'],  // Lavender
    [146,  57, 120, '#923978'],  // Magenta
    [200, 112, 160, '#C870A0'],  // Dark Pink
    [228, 173, 200, '#E4ADC8'],  // Bright Pink
    [252, 151, 172, '#FC97AC'],  // Pink
  ];

  // ── Bricklink color ID lookup (hex → BL colour ID) ──────────────────────
  // Used for parts-list export. Missing entries fall back to 0 ("Any Colour").
  const BL_ID_BY_HEX = {
    // Grays & White
    '#FFFFFF':   1,  '#E6E3DA':  49,  '#E6E3E0':  99,  '#A0A5A9':  86,
    '#9BA19D':   9,  '#6D6E5C':  10,  '#6C6E68':  85,  '#212121':  11,
    // Reds
    '#720E0F':  59,  '#C91A09':   5,  '#CA4C0B': 176,  '#FF688F': 220,
    '#D67572':  58,
    // Browns & Tans
    '#352100': 120,  '#583927':   8,  '#582A12':  88,  '#7C503A':  91,
    '#958A73':  69,  '#E4CD9E':   2,  '#F6D7B3':  90,  '#D09168':  28,
    '#AA7D55': 150,
    // Oranges & Yellows
    '#A95500':  68,  '#FE8A18':   4,  '#FFA70B':  31,  '#F8BB3D': 110,
    '#F3CF9B':  96,  '#F2CD37':   3,  '#FFF03A': 226,
    // Greens
    '#D9E4A7':  35,  '#DFEEA5': 158,  '#C7D23C':  76,  '#BBE90B':  34,
    '#9B9A5A': 155,  '#184632':  80,  '#237841':   6,  '#4B9F4A':  36,
    '#73DCA1':  37,  '#C2DAB8':  38,  '#A0BCAC':  48,
    // Teals & Blues
    '#008F9B':  39,  '#ADC3C0': 152,  '#0A3463':  63,  '#0055BF':   7,
    '#078BC9': 153,  '#3592C3':  72,  '#36AEBF': 156,  '#5A93DB':  42,
    '#9FC3E9': 105,  '#6074A1':  55,
    // Purples & Pinks
    '#A3A9FF':  97,  '#9391E4':  73,  '#3F3691':  89,  '#81007B':  24,
    '#AC78BA': 157,  '#E1D5ED': 154,  '#923978':  71,  '#C870A0':  47,
    '#E4ADC8': 104,  '#FC97AC':  23,
  };

  // ── Colour snapping (weighted RGB) ───────────────────────────────────
  // Redmean approximation — weights R/G/B channels by perceived luminance.

  function snapToBrick(r, g, b) {
    let minDist = Infinity, bestHex = BRICK_PALETTE[0][3];
    for (const [pr, pg, pb, hex] of BRICK_PALETTE) {
      const rm = (r + pr) / 2;
      const dR = r - pr, dG = g - pg, dB = b - pb;
      const d = (2 + rm / 256) * dR * dR + 4 * dG * dG + (2 + (255 - rm) / 256) * dB * dB;
      if (d < minDist) { minDist = d; bestHex = hex; }
    }
    return bestHex;
  }

  function snapToBlId(r, g, b) {
    return BL_ID_BY_HEX[snapToBrick(r, g, b).toUpperCase()] || 0;
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // ── Tile math (same as elevationService) ──────────────────────────────
  function lonToTileX(lon, z) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
  }
  function latToTileY(lat, z) {
    const r = lat * Math.PI / 180;
    return Math.floor(
      (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)
    );
  }
  function latLonToPixel(lat, lon, tileX, tileY, z) {
    const n  = Math.pow(2, z);
    const px = ((lon + 180) / 360 * n - tileX) * TILE_SIZE;
    const r  = lat * Math.PI / 180;
    const py = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n - tileY) * TILE_SIZE;
    return {
      px: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(px))),
      py: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(py))),
    };
  }

  function chooseBestZoom(bounds) {
    const clat   = (bounds.minLat + bounds.maxLat) / 2;
    const latKm  = (bounds.maxLat - bounds.minLat) * 111.32;
    const lonKm  = (bounds.maxLon - bounds.minLon) * 111.32 * Math.cos(clat * Math.PI / 180);
    const sideKm = Math.max(latKm, lonKm);
    for (let z = 15; z >= 5; z--) {
      const tileKm = 40075 * Math.cos(clat * Math.PI / 180) / Math.pow(2, z);
      if (sideKm / tileKm <= 8) return z;
    }
    return 5;
  }

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
          reject(new Error(`Imagery tile ${key} blocked CORS. Try running via a local server.`));
        }
      };
      img.onerror = () => reject(new Error(`Failed to load imagery tile ${key}`));
      // ESRI uses z/y/x
      img.src = TILE_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x);
    });
  }

  function getCellSamplePoints(minLat, minLon, maxLat, maxLon) {
    const cx = (minLat + maxLat) / 2;
    const cy = (minLon + maxLon) / 2;
    return [
      { lat: cx,                 lon: cy                },
      { lat: (cx + maxLat) / 2,  lon: (cy + minLon) / 2 },
      { lat: (cx + maxLat) / 2,  lon: (cy + maxLon) / 2 },
      { lat: (cx + minLat) / 2,  lon: (cy + minLon) / 2 },
      { lat: (cx + minLat) / 2,  lon: (cy + maxLon) / 2 },
    ];
  }

  /**
   * @param {object}   bounds     { minLat, maxLat, minLon, maxLon }
   * @param {number}   gridCols
   * @param {number}   gridRows
   * @param {boolean}  brickSnap   snap colours to nearest brick palette entry
   * @param {function} onProgress (fraction 0–1, statusText)
   * @param {number}   [mapZoom]   actual Leaflet map zoom — if provided, used
   *                               directly so imagery matches what the user sees
   * @returns {Promise<string[][]>} [row][col] hex colour strings
   */
  async function getGridColors(bounds, gridCols, gridRows, brickSnap, onProgress, mapZoom) {
    const zoom = (mapZoom != null) ? mapZoom : chooseBestZoom(bounds);

    const { minLat, maxLat, minLon, maxLon } = bounds;
    const cellLatSize = (maxLat - minLat) / gridRows;
    const cellLonSize = (maxLon - minLon) / gridCols;

    // Collect all sample points
    const allPoints = [];
    const cellMap   = [];
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const cMinLat = minLat + row * cellLatSize;
        const cMinLon = minLon + col * cellLonSize;
        const pts = getCellSamplePoints(cMinLat, cMinLon, cMinLat + cellLatSize, cMinLon + cellLonSize);
        cellMap.push({ row, col, startIdx: allPoints.length, count: pts.length });
        allPoints.push(...pts);
      }
    }

    // Find unique tiles
    const tileSet = new Set();
    for (const pt of allPoints) {
      tileSet.add(`${zoom}/${lonToTileX(pt.lon, zoom)}/${latToTileY(pt.lat, zoom)}`);
    }
    const tileList = [...tileSet];

    onProgress(0, `Downloading ${tileList.length} imagery tile${tileList.length !== 1 ? 's' : ''} (zoom ${zoom})…`);

    // Fetch tiles 4 at a time
    const CONCURRENCY = 4;
    for (let i = 0; i < tileList.length; i += CONCURRENCY) {
      const batch = tileList.slice(i, i + CONCURRENCY).map(key => {
        const [z, x, y] = key.split('/').map(Number);
        return loadTile(z, x, y);
      });
      await Promise.all(batch);
      onProgress(
        Math.min(i + CONCURRENCY, tileList.length) / tileList.length * 0.85,
        `Loaded ${Math.min(i + CONCURRENCY, tileList.length)} / ${tileList.length} imagery tiles…`
      );
    }

    // Sample colours
    onProgress(0.9, 'Sampling colours…');
    const colorGrid = Array.from({ length: gridRows }, () => new Array(gridCols).fill('#000000'));

    for (const { row, col, startIdx, count } of cellMap) {
      let rSum = 0, gSum = 0, bSum = 0;
      for (let i = startIdx; i < startIdx + count; i++) {
        const pt  = allPoints[i];
        const tx  = lonToTileX(pt.lon, zoom);
        const ty  = latToTileY(pt.lat, zoom);
        const img = tileCache[`${zoom}/${tx}/${ty}`];
        const { px, py } = latLonToPixel(pt.lat, pt.lon, tx, ty, zoom);
        const idx = (py * TILE_SIZE + px) * 4;
        rSum += img.data[idx];
        gSum += img.data[idx + 1];
        bSum += img.data[idx + 2];
      }
      const r = Math.round(rSum / count);
      const g = Math.round(gSum / count);
      const b = Math.round(bSum / count);
      colorGrid[row][col] = brickSnap ? snapToBrick(r, g, b) : rgbToHex(r, g, b);
    }

    onProgress(1, 'Done!');
    return colorGrid;
  }

  function snapGridColors(colorGrid) {
    return colorGrid.map(row => row.map(hex => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return snapToBrick(r, g, b);
    }));
  }

  function getPalette() {
    return BRICK_PALETTE.map(([, , , hex]) => hex);
  }

  return { getGridColors, snapToBlId, snapGridColors, getPalette };
})();
