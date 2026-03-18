/**
 * legoCalculator.js
 * Converts a 2D elevation grid (metres) into plate heights and colours.
 *
 * Physical brick reference:
 *   1 stud   = 8 mm
 *   1 plate  = 3.2 mm  (= 0.4 studs tall)
 *   1 brick  = 9.6 mm  (= 3 plates)
 */

const BrickCalculator = (() => {
  const MIN_PLATES     = 2;   // every cell gets at least 2 plates
  const DEFAULT_MAX_PLATES = 18; // 6 bricks

  // Terrain colour palette (colour, label, threshold 0–1)
  const TERRAIN_COLORS = [
    { threshold: 0.00, hex: '#0055BF', label: 'Ocean / Water'   }, // Blue
    { threshold: 0.12, hex: '#E4CD9E', label: 'Beach / Sand'    }, // Tan
    { threshold: 0.28, hex: '#4B9F4A', label: 'Lowland / Grass' }, // Bright Green
    { threshold: 0.50, hex: '#2E5A27', label: 'Forest / Hills'  }, // Dark Green
    { threshold: 0.68, hex: '#9C9C9C', label: 'Rock / Alpine'   }, // Stone Grey
    { threshold: 0.85, hex: '#F2F3F2', label: 'Snow / Ice'      }, // White
  ];

  function getColor(normalised) {
    let chosen = TERRAIN_COLORS[0];
    for (const t of TERRAIN_COLORS) {
      if (normalised >= t.threshold) chosen = t;
    }
    return chosen.hex;
  }

  /**
   * Convert elevation grid → { plateGrid, colorGrid, stats }
   * @param {number[][]} elevGrid  - [row][col] elevation in metres
   * @param {number}     maxPlates - tallest column height in plates (controls exaggeration)
   * @returns {{ plateGrid: number[][], colorGrid: string[][], stats: object }}
   */
  function convert(elevGrid, maxPlates = DEFAULT_MAX_PLATES) {
    const flat = elevGrid.flat();
    const minElev = Math.min(...flat);
    const maxElev = Math.max(...flat);
    const range   = maxElev - minElev || 1;

    const rows = elevGrid.length;
    const cols = elevGrid[0].length;

    const plateGrid = [];
    const colorGrid = [];
    let totalPlates = 0;

    for (let r = 0; r < rows; r++) {
      plateGrid.push([]);
      colorGrid.push([]);
      for (let c = 0; c < cols; c++) {
        const norm   = (elevGrid[r][c] - minElev) / range;
        const plates = Math.round(MIN_PLATES + norm * (maxPlates - MIN_PLATES));
        plateGrid[r].push(plates);
        colorGrid[r].push(getColor(norm));
        totalPlates += plates;
      }
    }

    const bricks = Math.ceil(totalPlates / 3);

    return {
      plateGrid,
      colorGrid,
      stats: {
        minElev: Math.round(minElev),
        maxElev: Math.round(maxElev),
        minPlates: MIN_PLATES,
        maxPlates,
        totalPlates,
        totalBricks: bricks,
        cells: rows * cols,
      },
    };
  }

  /** Returns the terrain colour legend entries */
  function getLegend() {
    return TERRAIN_COLORS.map(t => ({ hex: t.hex, label: t.label }));
  }

  return { convert, getLegend };
})();
