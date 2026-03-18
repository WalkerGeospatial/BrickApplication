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

  // ── Official brick colour palette (193 solid colors from Rebrickable) ──
  // Excludes: trans, chrome, pearl, metallic, glow-in-dark, glitter, speckle
  // [r, g, b, hex]
  const BRICK_PALETTE = [
    [  0,  51, 178, '#0033B2'], // [Unknown]
    [  5,  19,  29, '#05131D'], // Black
    [  0,  85, 191, '#0055BF'], // Blue
    [ 35, 120,  65, '#237841'], // Green
    [  0, 143, 155, '#008F9B'], // Dark Turquoise
    [201,  26,   9, '#C91A09'], // Red
    [200, 112, 160, '#C870A0'], // Dark Pink
    [ 88,  57,  39, '#583927'], // Brown
    [155, 161, 157, '#9BA19D'], // Light Gray
    [109, 110,  92, '#6D6E5C'], // Dark Gray
    [180, 210, 227, '#B4D2E3'], // Light Blue
    [ 75, 159,  74, '#4B9F4A'], // Bright Green
    [ 85, 165, 175, '#55A5AF'], // Light Turquoise
    [242, 112,  94, '#F2705E'], // Salmon
    [252, 151, 172, '#FC97AC'], // Pink
    [242, 205,  55, '#F2CD37'], // Yellow
    [255, 255, 255, '#FFFFFF'], // White
    [194, 218, 184, '#C2DAB8'], // Light Green
    [251, 230, 150, '#FBE696'], // Light Yellow
    [228, 205, 158, '#E4CD9E'], // Tan
    [201, 202, 226, '#C9CAE2'], // Light Violet
    [129,   0, 123, '#81007B'], // Purple
    [ 32,  50, 176, '#2032B0'], // Dark Blue-Violet
    [254, 138,  24, '#FE8A18'], // Orange
    [146,  57, 120, '#923978'], // Magenta
    [187, 233,  11, '#BBE90B'], // Lime
    [149, 138, 115, '#958A73'], // Dark Tan
    [228, 173, 200, '#E4ADC8'], // Bright Pink
    [172, 120, 186, '#AC78BA'], // Medium Lavender
    [225, 213, 237, '#E1D5ED'], // Lavender
    [243, 207, 155, '#F3CF9B'], // Very Light Orange
    [205,  98, 152, '#CD6298'], // Light Purple
    [ 88,  42,  18, '#582A12'], // Reddish Brown
    [160, 165, 169, '#A0A5A9'], // Light Bluish Gray
    [108, 110, 104, '#6C6E68'], // Dark Bluish Gray
    [ 90, 147, 219, '#5A93DB'], // Medium Blue
    [115, 220, 161, '#73DCA1'], // Medium Green
    [254, 204, 207, '#FECCCF'], // Light Pink
    [246, 215, 179, '#F6D7B3'], // Light Nougat
    [255, 255, 255, '#FFFFFF'], // Milky White
    [170, 125,  85, '#AA7D55'], // Medium Nougat
    [ 63,  54, 145, '#3F3691'], // Dark Purple
    [124,  80,  58, '#7C503A'], // Light Brown
    [ 76,  97, 219, '#4C61DB'], // Royal Blue
    [208, 145, 104, '#D09168'], // Nougat
    [254, 186, 189, '#FEBABD'], // Light Salmon
    [ 67,  84, 163, '#4354A3'], // Violet
    [104, 116, 202, '#6874CA'], // Medium Bluish Violet
    [199, 210,  60, '#C7D23C'], // Medium Lime
    [179, 215, 209, '#B3D7D1'], // Aqua
    [217, 228, 167, '#D9E4A7'], // Light Lime
    [249, 186,  97, '#F9BA61'], // Light Orange
    [174, 122,  89, '#AE7A59'], // Copper
    [230, 227, 224, '#E6E3E0'], // Very Light Bluish Gray
    [223, 238, 165, '#DFEEA5'], // Yellowish Green
    [180, 132,  85, '#B48455'], // Flat Dark Gold
    [137, 135, 136, '#898788'], // Flat Silver
    [248, 187,  61, '#F8BB3D'], // Bright Light Orange
    [159, 195, 233, '#9FC3E9'], // Bright Light Blue
    [179,  16,   4, '#B31004'], // Rust
    [255, 240,  58, '#FFF03A'], // Bright Light Yellow
    [125, 191, 221, '#7DBFDD'], // Sky Blue
    [ 10,  52,  99, '#0A3463'], // Dark Blue
    [ 24,  70,  50, '#184632'], // Dark Green
    [ 53,  33,   0, '#352100'], // Dark Brown
    [ 53, 146, 195, '#3592C3'], // Maersk Blue
    [114,  14,  15, '#720E0F'], // Dark Red
    [  7, 139, 201, '#078BC9'], // Dark Azure
    [ 54, 174, 191, '#36AEBF'], // Medium Azure
    [173, 195, 192, '#ADC3C0'], // Light Aqua
    [155, 154,  90, '#9B9A5A'], // Olive Green
    [214, 117, 114, '#D67572'], // Sand Red
    [247, 133, 177, '#F785B1'], // Medium Dark Pink
    [250, 156,  28, '#FA9C1C'], // Earth Orange
    [132,  94, 132, '#845E84'], // Sand Purple
    [160, 188, 172, '#A0BCAC'], // Sand Green
    [ 96, 116, 161, '#6074A1'], // Sand Blue
    [182, 123,  80, '#B67B50'], // Fabuland Brown
    [255, 167,  11, '#FFA70B'], // Medium Orange
    [169,  85,   0, '#A95500'], // Dark Orange
    [230, 227, 218, '#E6E3DA'], // Very Light Gray
    [147, 145, 228, '#9391E4'], // Medium Violet
    [142,  85, 151, '#8E5597'], // Reddish Lilac
    [  3, 156, 189, '#039CBD'], // Vintage Blue
    [ 30,  96,  30, '#1E601E'], // Vintage Green
    [202,  31,   8, '#CA1F08'], // Vintage Red
    [243, 195,   5, '#F3C305'], // Vintage Yellow
    [239, 145,  33, '#EF9121'], // Fabuland Orange
    [244, 244, 244, '#F4F4F4'], // Modulex White
    [175, 181, 199, '#AFB5C7'], // Modulex Light Bluish Gray
    [156, 156, 156, '#9C9C9C'], // Modulex Light Gray
    [ 89,  93,  96, '#595D60'], // Modulex Charcoal Gray
    [107,  90,  90, '#6B5A5A'], // Modulex Tile Gray
    [ 77,  76,  82, '#4D4C52'], // Modulex Black
    [ 92,  80,  48, '#5C5030'], // Modulex Terracotta
    [144, 116,  80, '#907450'], // Modulex Brown
    [222, 198, 156, '#DEC69C'], // Modulex Buff
    [181,  44,  32, '#B52C20'], // Modulex Red
    [244,  92,  64, '#F45C40'], // Modulex Pink Red
    [244, 123,  48, '#F47B30'], // Modulex Orange
    [247, 173,  99, '#F7AD63'], // Modulex Light Orange
    [255, 227, 113, '#FFE371'], // Modulex Light Yellow
    [254, 213,  87, '#FED557'], // Modulex Ochre Yellow
    [189, 198,  24, '#BDC618'], // Modulex Lemon
    [125, 181,  56, '#7DB538'], // Modulex Pastel Green
    [124, 144,  81, '#7C9051'], // Modulex Olive Green
    [ 39, 134, 126, '#27867E'], // Modulex Aqua Green
    [ 70, 112, 131, '#467083'], // Modulex Teal Blue
    [  0,  87, 166, '#0057A6'], // Modulex Tile Blue
    [ 97, 175, 255, '#61AFFF'], // Modulex Medium Blue
    [104, 174, 206, '#68AECE'], // Modulex Pastel Blue
    [189, 125, 133, '#BD7D85'], // Modulex Violet
    [247, 133, 177, '#F785B1'], // Modulex Pink
    [255, 104, 143, '#FF688F'], // Coral
    [ 90, 196, 218, '#5AC4DA'], // Pastel Blue
    [235, 216,   0, '#EBD800'], // Vibrant Yellow
    [172, 130,  71, '#AC8247'], // Reddish Gold
    [221, 152,  46, '#DD982E'], // Curry
    [173,  97,  64, '#AD6140'], // Dark Nougat
    [238,  84,  52, '#EE5434'], // Bright Reddish Orange
    [  0, 158, 206, '#009ECE'], // Duplo Blue
    [ 62, 149, 182, '#3E95B6'], // Duplo Medium Blue
    [255, 242,  48, '#FFF230'], // Duplo Lime
    [120, 252, 120, '#78FC78'], // Fabuland Lime
    [ 70, 138,  95, '#468A5F'], // Duplo Medium Green
    [ 96, 186, 118, '#60BA76'], // Duplo Light Green
    [243, 201, 136, '#F3C988'], // Light Tan
    [135,  43,  23, '#872B17'], // Rust Orange
    [254, 120, 176, '#FE78B0'], // Clikits Pink
    [255, 135, 156, '#FF879C'], // Duplo Pink
    [117,  89,  69, '#755945'], // Medium Brown
    [204, 163, 115, '#CCA373'], // Warm Tan
    [ 63, 182, 158, '#3FB69E'], // Duplo Turquoise
    [255, 203, 120, '#FFCB78'], // Warm Yellowish Orange
    [145, 149, 202, '#9195CA'], // Light Lilac
    [255, 207,  11, '#FFCF0B'], // Clikits Yellow
    [ 95,  39, 170, '#5F27AA'], // Duplo Dark Purple
    [179, 215, 209, '#B3D7D1'], // HO Aqua
    [ 21, 145, 203, '#1591CB'], // HO Azure
    [ 91, 152, 179, '#5B98B3'], // HO Cyan
    [167, 220, 207, '#A7DCCF'], // HO Dark Aqua
    [178, 185,  85, '#B2B955'], // HO Dark Lime
    [ 99,  19,  20, '#631314'], // HO Dark Red
    [ 98, 122,  98, '#627A62'], // HO Dark Sand Green
    [ 16, 146, 157, '#10929D'], // HO Dark Turquoise
    [187, 119,  27, '#BB771B'], // HO Earth Orange
    [180, 167, 116, '#B4A774'], // HO Gold
    [163, 209, 192, '#A3D1C0'], // HO Light Aqua
    [150,  83,  54, '#965336'], // HO Light Brown
    [205, 194, 152, '#CDC298'], // HO Light Gold
    [249, 241, 199, '#F9F1C7'], // HO Light Tan
    [245, 250, 183, '#F5FAB7'], // HO Light Yellow
    [115, 150, 200, '#7396C8'], // HO Medium Blue
    [192,  17,  17, '#C01111'], // HO Medium Red
    [208,  98,  98, '#D06262'], // HO Rose
    [110, 138, 166, '#6E8AA6'], // HO Sand Blue
    [202,  76,  11, '#CA4C0B'], // Reddish Orange
    [145,  92,  60, '#915C3C'], // Sienna Brown
    [ 94,  63,  51, '#5E3F33'], // Umber Brown
    [236,  70,  18, '#EC4612'], // Neon Orange
    [210, 252,  67, '#D2FC43'], // Neon Green
    [ 93,  92,  54, '#5D5C36'], // Dark Olive Green
    [221, 158,  71, '#DD9E47'], // Ochre Yellow
    [246, 183, 191, '#F6B7BF'], // Warm Pink
    [163, 169, 255, '#A3A9FF'], // Blue Violet
  ];

  // ── Bricklink color ID lookup (hex → BL colour ID) ──────────────────────
  // IDs sourced from Bricklink's public colour catalogue.
  // Entries not listed here fall back to 0 ("Any Colour") in the export.
  const BL_ID_BY_HEX = {
    '#05131D': 11,  '#0055BF':  7,  '#237841':  6,  '#008F9B': 39,
    '#C91A09':  5,  '#C870A0': 47,  '#583927':  8,  '#9BA19D':  9,
    '#6D6E5C': 10,  '#B4D2E3': 62,  '#4B9F4A': 36,  '#55A5AF': 40,
    '#F2705E': 25,  '#FC97AC': 23,  '#F2CD37':  3,  '#FFFFFF':  1,
    '#C2DAB8': 38,  '#FBE696': 103, '#E4CD9E':  2,  '#C9CAE2': 44,
    '#81007B': 24,  '#2032B0': 109, '#FE8A18':  4,
    '#923978': 71,  '#BBE90B': 34,  '#958A73': 69,  '#E4ADC8': 104,
    '#AC78BA': 157, '#E1D5ED': 154, '#F3CF9B': 96,  '#CD6298': 93,
    '#582A12': 88,  '#A0A5A9': 86,  '#6C6E68': 85,  '#5A93DB': 72,
    '#73DCA1': 37,  '#FECCCF': 56,  '#F6D7B3': 90,
    '#AA7D55': 150, '#3F3691': 89,
    '#7C503A': 91,  '#D09168': 28,  '#FEBABD': 26,  '#4354A3': 43,
    '#6874CA': 73,  '#C7D23C': 76,  '#B3D7D1': 107, '#D9E4A7': 35,
    '#AE7A59': 84,  '#E6E3E0': 99,  '#DFEEA5': 158,
    '#B48455': 81,  '#898788': 95,  '#F8BB3D': 110,
    '#9FC3E9': 105, '#B31004': 27,  '#FFF03A': 226, '#7DBFDD': 87,
    '#0A3463': 63,  '#184632': 80,  '#352100': 120,
    '#720E0F': 59,  '#078BC9': 153, '#36AEBF': 156, '#ADC3C0': 152,
    '#9B9A5A': 155, '#D67572': 58,  '#F785B1': 94,
    '#FA9C1C': 29,  '#845E84': 54,  '#A0BCAC': 48,  '#6074A1': 55,
    '#FFA70B': 31,  '#A95500': 68,  '#E6E3DA': 49,  '#FF688F': 220,
    '#2E5A27': 80,  '#9C9C9C': 85,
  };

  // ── Colour snapping (weighted RGB) ───────────────────────────────────
  // Redmean approximation — weights R/G/B channels by perceived luminance.
  // Better than plain Euclidean without any color-space conversion.

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
   * @returns {Promise<string[][]>} [row][col] hex colour strings
   */
  async function getGridColors(bounds, gridCols, gridRows, brickSnap, onProgress) {
    const zoom = chooseBestZoom(bounds);

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

  return { getGridColors, snapToBlId };
})();
