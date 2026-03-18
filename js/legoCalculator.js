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
  const MIN_PLATES         = 2;
  const DEFAULT_MAX_PLATES = 18; // 6 bricks

  // All colours are official LEGO brick hex values where possible.
  const PALETTES = {

    'terrain': {
      label: 'Classic Terrain',
      stops: [
        { threshold: 0.00, hex: '#0055BF', label: 'Ocean / Water'    }, // Blue
        { threshold: 0.12, hex: '#E4CD9E', label: 'Beach / Sand'     }, // Tan
        { threshold: 0.28, hex: '#4B9F4A', label: 'Lowland / Grass'  }, // Bright Green
        { threshold: 0.50, hex: '#237841', label: 'Forest / Hills'   }, // Green
        { threshold: 0.68, hex: '#9BA19D', label: 'Rock / Alpine'    }, // Light Gray
        { threshold: 0.85, hex: '#FFFFFF', label: 'Snow / Ice'       }, // White
      ],
    },

    'terrain-land': {
      label: 'Terrain (No Water)',
      stops: [
        { threshold: 0.00, hex: '#4B9F4A', label: 'Lowland / Grass'  }, // Bright Green
        { threshold: 0.30, hex: '#237841', label: 'Forest / Hills'   }, // Green
        { threshold: 0.55, hex: '#9B9A5A', label: 'Rocky Highland'   }, // Olive Green
        { threshold: 0.75, hex: '#A0A5A9', label: 'Alpine Rock'      }, // Light Bluish Gray
        { threshold: 0.90, hex: '#FFFFFF', label: 'Snow / Ice'       }, // White
      ],
    },

    'mordor': {
      label: 'Mordor',
      stops: [
        { threshold: 0.00, hex: '#720E0F', label: 'Deep Lava'          }, // Dark Red
        { threshold: 0.12, hex: '#C91A09', label: 'Active Lava'        }, // Red
        { threshold: 0.22, hex: '#FE8A18', label: 'Cooling Embers'     }, // Orange
        { threshold: 0.32, hex: '#212121', label: 'Ash / Volcanic Rock' }, // Black (LDraw)
        { threshold: 0.62, hex: '#646464', label: 'Dark Stone Peaks'   }, // Dark Bluish Gray (LDraw)
      ],
    },

    'arctic': {
      label: 'Arctic',
      stops: [
        { threshold: 0.00, hex: '#0A3463', label: 'Deep Ocean'         }, // Dark Blue
        { threshold: 0.20, hex: '#0055BF', label: 'Frozen Sea'         }, // Blue
        { threshold: 0.40, hex: '#5A93DB', label: 'Glacier'            }, // Medium Blue
        { threshold: 0.60, hex: '#A0A5A9', label: 'Frozen Rock'        }, // Light Bluish Gray
        { threshold: 0.80, hex: '#FFFFFF', label: 'Snow / Ice Peaks'   }, // White
      ],
    },

    'desert': {
      label: 'Desert Canyon',
      stops: [
        { threshold: 0.00, hex: '#A95500', label: 'Deep Canyon'        }, // Dark Orange
        { threshold: 0.25, hex: '#582A12', label: 'Canyon Walls'       }, // Reddish Brown
        { threshold: 0.48, hex: '#D09168', label: 'Sandstone'          }, // Nougat
        { threshold: 0.70, hex: '#E4CD9E', label: 'Sandy Plateau'      }, // Tan
        { threshold: 0.88, hex: '#A0A5A9', label: 'Rocky Cliffs'       }, // Light Bluish Gray
      ],
    },

    'tropical': {
      label: 'Tropical',
      stops: [
        { threshold: 0.00, hex: '#0055BF', label: 'Ocean'              }, // Blue
        { threshold: 0.12, hex: '#F2CD37', label: 'Sandy Beach'        }, // Yellow
        { threshold: 0.28, hex: '#BBE90B', label: 'Tropical Coast'     }, // Lime
        { threshold: 0.50, hex: '#4B9F4A', label: 'Jungle'             }, // Bright Green
        { threshold: 0.72, hex: '#237841', label: 'Dense Jungle'       }, // Green
        { threshold: 0.88, hex: '#184632', label: 'Highland Jungle'    }, // Dark Green
      ],
    },

    'mars': {
      label: 'Mars',
      stops: [
        { threshold: 0.00, hex: '#352100', label: 'Deep Crater'        }, // Dark Brown
        { threshold: 0.20, hex: '#582A12', label: 'Crater Walls'       }, // Reddish Brown
        { threshold: 0.42, hex: '#A95500', label: 'Iron Oxide Plains'  }, // Dark Orange
        { threshold: 0.62, hex: '#D67572', label: 'Dusty Flats'        }, // Sand Red
        { threshold: 0.80, hex: '#E4CD9E', label: 'Light Dust'         }, // Tan
        { threshold: 0.92, hex: '#F6D7B3', label: 'High Ridge Dust'    }, // Light Nougat
      ],
    },

    'autumn': {
      label: 'Autumn',
      stops: [
        { threshold: 0.00, hex: '#0A3463', label: 'Valley Stream'      }, // Dark Blue
        { threshold: 0.15, hex: '#FE8A18', label: 'Fall Foliage'       }, // Orange
        { threshold: 0.35, hex: '#C91A09', label: 'Peak Fall Colour'   }, // Red
        { threshold: 0.55, hex: '#F2CD37', label: 'Golden Canopy'      }, // Yellow
        { threshold: 0.72, hex: '#583927', label: 'Bare Upper Forest'  }, // Brown
        { threshold: 0.88, hex: '#A0A5A9', label: 'Rocky Peak'         }, // Light Bluish Gray
      ],
    },

    'neon': {
      label: 'Neon / Synthwave',
      stops: [
        { threshold: 0.00, hex: '#212121', label: 'Dark Grid'          }, // Black
        { threshold: 0.20, hex: '#81007B', label: 'Deep Neon'          }, // Purple
        { threshold: 0.40, hex: '#0055BF', label: 'Electric Blue'      }, // Blue
        { threshold: 0.58, hex: '#36AEBF', label: 'Cyan Glow'          }, // Medium Azure
        { threshold: 0.75, hex: '#BBE90B', label: 'Neon Green'         }, // Lime
        { threshold: 0.90, hex: '#FC97AC', label: 'Hot Pink Peak'      }, // Pink
      ],
    },

  };

  function getColor(normalised, stops) {
    let chosen = stops[0];
    for (const s of stops) {
      if (normalised >= s.threshold) chosen = s;
    }
    return chosen.hex;
  }

  /**
   * Convert elevation grid → { plateGrid, colorGrid, stats }
   * @param {number[][]} elevGrid    - [row][col] elevation in metres
   * @param {number}     maxPlates   - tallest column height in plates
   * @param {string}     paletteName - key from PALETTES (default 'terrain')
   */
  function convert(elevGrid, maxPlates = DEFAULT_MAX_PLATES, paletteName = 'terrain') {
    const palette = PALETTES[paletteName] || PALETTES['terrain'];
    const stops   = palette.stops;

    const flat    = elevGrid.flat();
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
        colorGrid[r].push(getColor(norm, stops));
        totalPlates += plates;
      }
    }

    return {
      plateGrid,
      colorGrid,
      stats: {
        minElev:     Math.round(minElev),
        maxElev:     Math.round(maxElev),
        minPlates:   MIN_PLATES,
        maxPlates,
        totalPlates,
        totalBricks: Math.ceil(totalPlates / 3),
        cells:       rows * cols,
      },
    };
  }

  /** Returns legend entries for the given palette */
  function getLegend(paletteName = 'terrain') {
    const palette = PALETTES[paletteName] || PALETTES['terrain'];
    return palette.stops.map(s => ({ hex: s.hex, label: s.label }));
  }

  /** Returns all palette keys + labels for building UI */
  function getPalettes() {
    return Object.entries(PALETTES).map(([key, p]) => ({ key, label: p.label }));
  }

  return { convert, getLegend, getPalettes };
})();
