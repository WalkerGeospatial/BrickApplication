/**
 * partsExport.js
 * Converts a completed brick elevation map into a downloadable parts list.
 *
 * Build model per stud column:
 *   Body  — floor(plates / 3) brick layers, packed with widest available bricks
 *   Mid   — 1 plate  if plates % 3 == 2  (bottom remainder plate)
 *   Top   — 1 plate  if plates % 3 >= 1  (topmost remainder plate)
 *   Base  — one 32×32 baseplate (Light Bluish Gray)
 *
 * Packing: greedy 2-D rectangle scan (largest piece first) groups adjacent
 * same-colour cells into larger pieces, reducing total part count.
 *
 * Correctness constraint: two cells may only share a piece if they sit at
 * the same absolute height at that layer.
 *   • Brick layers are anchored from the base → all cells eligible for
 *     layer L are at the same height, so no extra check needed.
 *   • Remainder plates / top tiles vary with brick count → cells are grouped
 *     by total plate height before packing.
 */

const PartsExport = (() => {

  // ── Piece catalogues ────────────────────────────────────────────────────────
  // Each entry: [rows, cols, bricklinkPartId]
  // Both orientations listed for non-square pieces.
  // Sorted by area (rows × cols) descending — greedy tries largest first.

  const BRICK_SIZES = [
    // Standard LEGO bricks max out at 2 studs wide.
    [2,8,'3007'],[8,2,'3007'],   // 2×8  — 16 studs
    [2,6,'2456'],[6,2,'2456'],   // 2×6  — 12 studs
    [1,8,'3008'],[8,1,'3008'],   // 1×8  —  8 studs
    [2,4,'3001'],[4,2,'3001'],   // 2×4  —  8 studs
    [1,6,'3009'],[6,1,'3009'],   // 1×6  —  6 studs
    [2,3,'3002'],[3,2,'3002'],   // 2×3  —  6 studs
    [2,2,'3003'],                // 2×2  —  4 studs
    [1,4,'3010'],[4,1,'3010'],   // 1×4  —  4 studs
    [1,3,'3622'],[3,1,'3622'],   // 1×3  —  3 studs
    [1,2,'3004'],[2,1,'3004'],   // 1×2  —  2 studs
    [1,1,'3005'],                // 1×1  —  1 stud
  ];

  const PLATE_SIZES = [
    [6,8,'3036'],[8,6,'3036'],   // 6×8  — 48 studs
    [6,6,'3958'],                // 6×6  — 36 studs
    [4,8,'3035'],[8,4,'3035'],   // 4×8  — 32 studs
    [4,6,'3032'],[6,4,'3032'],   // 4×6  — 24 studs
    [4,4,'3031'],                // 4×4  — 16 studs
    [2,8,'3034'],[8,2,'3034'],   // 2×8  — 16 studs
    [2,6,'3795'],[6,2,'3795'],   // 2×6  — 12 studs
    [1,8,'3460'],[8,1,'3460'],   // 1×8  —  8 studs
    [2,4,'3020'],[4,2,'3020'],   // 2×4  —  8 studs
    [1,6,'3666'],[6,1,'3666'],   // 1×6  —  6 studs
    [2,3,'3021'],[3,2,'3021'],   // 2×3  —  6 studs
    [2,2,'3022'],                // 2×2  —  4 studs
    [1,4,'3710'],[4,1,'3710'],   // 1×4  —  4 studs
    [1,3,'3623'],[3,1,'3623'],   // 1×3  —  3 studs
    [1,2,'3023'],[2,1,'3023'],   // 1×2  —  2 studs
    [1,1,'3024'],                // 1×1  —  1 stud
  ];

  const PART_BASEPLATE = '3811';
  const BL_GRAY        = 86;   // Light Bluish Gray

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // ── Greedy 2-D rectangle packer ─────────────────────────────────────────────
  /**
   * Scan the grid left-to-right, top-to-bottom.
   * At each unused eligible cell, try each piece size (largest first) and
   * place the first one that fits — all cells in the rectangle must be
   * unused, eligible, and share the same blId.
   *
   * @param {Array<Array<{blId:number}|null>>} eligible
   * @param {Array<[number,number,string]>}    sizes
   * @param {function(string,number,number)}   add
   */
  function packLayer(eligible, sizes, add) {
    const ROWS = eligible.length;
    const COLS = eligible[0].length;
    const used = Array.from({ length: ROWS }, () => new Uint8Array(COLS));

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (used[r][c] || !eligible[r][c]) continue;
        const blId = eligible[r][c].blId;

        for (const [dR, dC, partId] of sizes) {
          if (r + dR > ROWS || c + dC > COLS) continue;

          let fits = true;
          outer: for (let dr = 0; dr < dR; dr++) {
            for (let dc = 0; dc < dC; dc++) {
              const cell = eligible[r + dr][c + dc];
              if (used[r + dr][c + dc] || !cell || cell.blId !== blId) {
                fits = false;
                break outer;
              }
            }
          }

          if (fits) {
            for (let dr = 0; dr < dR; dr++)
              for (let dc = 0; dc < dC; dc++)
                used[r + dr][c + dc] = 1;
            add(partId, blId, 1);
            break;
          }
        }
      }
    }
  }

  // ── Aggregate ────────────────────────────────────────────────────────────────

  function aggregate(plateGrid, colorGrid) {
    const ROWS = plateGrid.length;
    const COLS = plateGrid[0].length;
    const counts = {};

    const add = (partId, blColorId, qty) => {
      const key = `${partId}:${blColorId}`;
      if (!counts[key]) counts[key] = { partId, blColorId, qty: 0 };
      counts[key].qty += qty;
    };

    // Precompute BrickLink colour IDs
    const blIds = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => {
        const { r: pr, g: pg, b: pb } = hexToRgb(colorGrid[r][c]);
        return ImageryService.snapToBlId(pr, pg, pb);
      })
    );

    const brickCnt = plateGrid.map(row => row.map(p => Math.floor(p / 3)));
    const remPlate = plateGrid.map(row => row.map(p => p % 3));
    const maxBricks = Math.max(...brickCnt.flat());

    // ── Brick layers ──────────────────────────────────────────────────────────
    // Layer L is anchored at the same absolute height for all cells,
    // so eligibility is simply brickCnt >= L. No height grouping needed.
    for (let layer = 1; layer <= maxBricks; layer++) {
      const eligible = Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) =>
          brickCnt[r][c] >= layer ? { blId: blIds[r][c] } : null
        )
      );
      packLayer(eligible, BRICK_SIZES, add);
    }

    // ── Intermediate plate layer ──────────────────────────────────────────────
    // Only cells with remPlate == 2 contribute a plate at this layer.
    // These cells' plates sit at height (brickCnt * 3) from the base — which
    // varies per cell — so we group by brickCnt to ensure height alignment.
    const bcForRem2 = new Set();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (remPlate[r][c] === 2) bcForRem2.add(brickCnt[r][c]);

    for (const bc of bcForRem2) {
      const eligible = Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) =>
          (remPlate[r][c] === 2 && brickCnt[r][c] === bc)
            ? { blId: blIds[r][c] } : null
        )
      );
      packLayer(eligible, PLATE_SIZES, add);
    }

    // ── Top plate layer ───────────────────────────────────────────────────────
    // Any cell with remPlate >= 1 gets one plate at the very top.
    // The plate sits at height (total plates - 1) from the base — which equals
    // (plateGrid[r][c] - 1) — so we group by total plate count.
    const heightsForTop = new Set();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (remPlate[r][c] >= 1) heightsForTop.add(plateGrid[r][c]);

    for (const h of heightsForTop) {
      const eligible = Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) =>
          (remPlate[r][c] >= 1 && plateGrid[r][c] === h)
            ? { blId: blIds[r][c] } : null
        )
      );
      packLayer(eligible, PLATE_SIZES, add);
    }

    // ── Baseplate ─────────────────────────────────────────────────────────────
    add(PART_BASEPLATE, BL_GRAY, 1);

    return Object.values(counts)
      .sort((a, b) => a.partId.localeCompare(b.partId) || a.blColorId - b.blColorId);
  }

  // ── Formatters ───────────────────────────────────────────────────────────────

  function toBricklinkXml(parts) {
    const items = parts.map(({ partId, blColorId, qty }) =>
      `  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${partId}</ITEMID>\n    <COLOR>${blColorId}</COLOR>\n    <MINQTY>${qty}</MINQTY>\n    <CONDITION>N</CONDITION>\n  </ITEM>`
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${items}\n</INVENTORY>`;
  }

  function toCsv(parts) {
    const rows = parts.map(({ partId, blColorId, qty }) =>
      `${partId},${blColorId},${qty}`
    );
    return 'Part Number,BL Color ID,Quantity\n' + rows.join('\n');
  }

  function triggerDownload(content, filename, type) {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportBricklink(brickData) {
    const parts = aggregate(brickData.plateGrid, brickData.colorGrid);
    triggerDownload(toBricklinkXml(parts), 'brick_elevation_map.xml', 'application/xml');
  }

  function exportCsv(brickData) {
    const parts = aggregate(brickData.plateGrid, brickData.colorGrid);
    triggerDownload(toCsv(parts), 'brick_elevation_map.csv', 'text/csv');
  }

  return { exportBricklink, exportCsv };
})();
