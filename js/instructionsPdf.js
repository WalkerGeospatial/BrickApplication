/**
 * instructionsPdf.js
 * Generates a printable layer-by-layer PDF build guide.
 *
 * Each page covers one horizontal build layer:
 *   • Brick layers  (floor(plates/3) layers from the base up)
 *   • Intermediate plates (cells with plates%3 == 2, one plate below top)
 *   • Top plates    (cells with plates%3 >= 1, topmost plate)
 *
 * Pieces are packed with the same greedy 2-D rectangle algorithm used by
 * partsExport.js so the grid diagrams match what the builder actually needs.
 */

const InstructionsPdf = (() => {

  const N    = 32;   // grid size
  const CELL = 16;   // canvas pixels per stud

  // ── Part name display strings ────────────────────────────────────────────

  const PART_NAMES = {
    '3005':'1×1 Brick',  '3004':'1×2 Brick',  '3622':'1×3 Brick',
    '3010':'1×4 Brick',  '3009':'1×6 Brick',  '3008':'1×8 Brick',
    '3003':'2×2 Brick',  '3002':'2×3 Brick',  '3001':'2×4 Brick',
    '2456':'2×6 Brick',  '3007':'2×8 Brick',
    '3024':'1×1 Plate',  '3023':'1×2 Plate',  '3623':'1×3 Plate',
    '3710':'1×4 Plate',  '3666':'1×6 Plate',  '3460':'1×8 Plate',
    '3022':'2×2 Plate',  '3021':'2×3 Plate',  '3020':'2×4 Plate',
    '3795':'2×6 Plate',  '3034':'2×8 Plate',
    '3031':'4×4 Plate',  '3032':'4×6 Plate',  '3035':'4×8 Plate',
    '3958':'6×6 Plate',  '3036':'6×8 Plate',
    '3811':'32×32 Baseplate',
  };

  // ── Piece size tables and helpers (shared from partsExport.js) ──────────

  const BRICK_SIZES = PartsExport.BRICK_SIZES;
  const PLATE_SIZES = PartsExport.PLATE_SIZES;
  const hexToRgb    = PartsExport.hexToRgb;

  function darken(hex, amt) {
    const n   = parseInt(hex.replace('#', ''), 16);
    const clamp = v => Math.max(0, Math.min(255, v));
    const r = clamp((n >> 16)       - amt);
    const g = clamp(((n >> 8) & 255) - amt);
    const b = clamp((n & 255)        - amt);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  // ── Greedy 2-D packer (returns positioned pieces, not counts) ───────────

  function packPos(eligible, sizes) {
    const ROWS = eligible.length;
    const COLS = eligible[0].length;
    const used  = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
    const pieces = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (used[r][c] || !eligible[r][c]) continue;
        const { blId, hex } = eligible[r][c];

        for (const [dR, dC, partId] of sizes) {
          if (r + dR > ROWS || c + dC > COLS) continue;
          let fits = true;
          outer: for (let dr = 0; dr < dR; dr++) {
            for (let dc = 0; dc < dC; dc++) {
              const cell = eligible[r + dr][c + dc];
              if (used[r + dr][c + dc] || !cell || cell.blId !== blId) {
                fits = false; break outer;
              }
            }
          }
          if (fits) {
            for (let dr = 0; dr < dR; dr++)
              for (let dc = 0; dc < dC; dc++)
                used[r + dr][c + dc] = 1;
            pieces.push({ r, c, dR, dC, partId, hex });
            break;
          }
        }
      }
    }
    return pieces;
  }

  // ── Layer builder ────────────────────────────────────────────────────────

  function buildLayers(plateGrid, colorGrid) {
    const ROWS = plateGrid.length;
    const COLS = plateGrid[0].length;

    const blIds = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => {
        const { r: pr, g: pg, b: pb } = hexToRgb(colorGrid[r][c]);
        return ImageryService.snapToBlId(pr, pg, pb);
      })
    );

    const brickCnt = plateGrid.map(row => row.map(p => Math.floor(p / 3)));
    const remPlate = plateGrid.map(row => row.map(p => p % 3));
    const maxBricks = Math.max(...brickCnt.flat());

    const layers = [];

    // Brick layers
    for (let layer = 1; layer <= maxBricks; layer++) {
      const eligible = Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) =>
          brickCnt[r][c] >= layer
            ? { blId: blIds[r][c], hex: colorGrid[r][c] } : null
        )
      );
      layers.push({
        label: `Brick Layer ${layer} of ${maxBricks}`,
        type:  'brick',
        pieces: packPos(eligible, BRICK_SIZES),
      });
    }

    // Intermediate plate layer (remPlate == 2, grouped by brickCnt for height alignment)
    const bcForRem2 = new Set();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (remPlate[r][c] === 2) bcForRem2.add(brickCnt[r][c]);

    const rem2Pieces = [];
    for (const bc of bcForRem2) {
      const eligible = Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) =>
          (remPlate[r][c] === 2 && brickCnt[r][c] === bc)
            ? { blId: blIds[r][c], hex: colorGrid[r][c] } : null
        )
      );
      rem2Pieces.push(...packPos(eligible, PLATE_SIZES));
    }
    if (rem2Pieces.length)
      layers.push({ label: 'Intermediate Plates', type: 'plate', pieces: rem2Pieces });

    // Top plate layer (remPlate >= 1, grouped by total height)
    const heightsForTop = new Set();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (remPlate[r][c] >= 1) heightsForTop.add(plateGrid[r][c]);

    const topPieces = [];
    for (const h of heightsForTop) {
      const eligible = Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) =>
          (remPlate[r][c] >= 1 && plateGrid[r][c] === h)
            ? { blId: blIds[r][c], hex: colorGrid[r][c] } : null
        )
      );
      topPieces.push(...packPos(eligible, PLATE_SIZES));
    }
    if (topPieces.length)
      layers.push({ label: 'Top Plates', type: 'plate', pieces: topPieces });

    return layers;
  }

  // ── Canvas rendering ─────────────────────────────────────────────────────

  function renderOverview(colorGrid) {
    const canvas = document.createElement('canvas');
    canvas.width  = N * CELL;
    canvas.height = N * CELL;
    const ctx = canvas.getContext('2d');

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        ctx.fillStyle = colorGrid[r][c];
        ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 1, CELL - 1);
      }
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth   = 0.5;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0);         ctx.lineTo(i * CELL, N * CELL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL);         ctx.lineTo(N * CELL, i * CELL); ctx.stroke();
    }

    return canvas.toDataURL('image/png');
  }

  function renderLayer(pieces, prevPieces) {
    const canvas = document.createElement('canvas');
    canvas.width  = N * CELL;
    canvas.height = N * CELL;
    const ctx = canvas.getContext('2d');

    // Empty cell background
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Previously built pieces — dimmed
    ctx.globalAlpha = 0.22;
    for (const { r, c, dR, dC, hex } of prevPieces) {
      ctx.fillStyle = hex;
      ctx.fillRect(c * CELL + 1, r * CELL + 1, dC * CELL - 2, dR * CELL - 2);
    }
    ctx.globalAlpha = 1;

    // Current layer pieces — full color
    for (const { r, c, dR, dC, hex } of pieces) {
      // Fill
      ctx.fillStyle = hex;
      ctx.fillRect(c * CELL + 1, r * CELL + 1, dC * CELL - 2, dR * CELL - 2);

      // Stud circles
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      for (let dr = 0; dr < dR; dr++) {
        for (let dc = 0; dc < dC; dc++) {
          ctx.beginPath();
          ctx.arc(
            (c + dc) * CELL + CELL / 2,
            (r + dr) * CELL + CELL / 2,
            CELL * 0.21, 0, Math.PI * 2
          );
          ctx.fill();
        }
      }

      // Piece border
      ctx.strokeStyle = darken(hex, 55);
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(c * CELL + 1.75, r * CELL + 1.75, dC * CELL - 3.5, dR * CELL - 3.5);
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(0,0,0,0.09)';
    ctx.lineWidth   = 0.5;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0);         ctx.lineTo(i * CELL, N * CELL); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,         i * CELL); ctx.lineTo(N * CELL, i * CELL); ctx.stroke();
    }

    return canvas.toDataURL('image/png');
  }

  // ── HTML builders ─────────────────────────────────────────────────────────

  function partsListHtml(pieces) {
    const counts = {};
    for (const { partId, hex } of pieces) {
      const key = `${partId}:${hex.toUpperCase()}`;
      if (!counts[key]) counts[key] = { partId, hex, qty: 0 };
      counts[key].qty++;
    }
    const rows = Object.values(counts)
      .sort((a, b) => b.qty - a.qty)
      .map(({ partId, hex, qty }) =>
        `<div class="part-row">
          <div class="swatch" style="background:${hex}"></div>
          <span>${qty}&times; ${PART_NAMES[partId] || partId}</span>
        </div>`
      ).join('');
    return `<h3>Parts for this step</h3><div class="part-rows">${rows}</div>`;
  }

  function pageHtml(stepNum, totalSteps, label, imgSrc, pieces, isOverview) {
    const badge = isOverview
      ? `<div class="step-badge overview-badge">Reference</div>`
      : `<div class="step-badge">Step ${stepNum} / ${totalSteps}</div>`;

    const sidebar = isOverview
      ? `<div class="parts-list overview-note">
           Use this page as a colour reference throughout the build.<br><br>
           Dimmed cells on each step page show pieces already placed in previous steps.
         </div>`
      : `<div class="parts-list">${partsListHtml(pieces)}</div>`;

    return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="app-name">BRICK ELEVATION MAP BUILDER</div>
          <div class="layer-name">${label}</div>
        </div>
        ${badge}
      </div>
      <div class="page-body">
        <img class="grid-img" src="${imgSrc}" width="${N * CELL}" height="${N * CELL}">
        ${sidebar}
      </div>
    </div>`;
  }

  // ── CSS ───────────────────────────────────────────────────────────────────

  const CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #111; }
    .page {
      width: 210mm; padding: 12mm 14mm;
      page-break-after: always; break-after: page;
      display: flex; flex-direction: column; gap: 12px;
    }
    .page-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 2.5px solid #e3000b; padding-bottom: 8px;
    }
    .app-name  { font-size: 9px; color: #aaa; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 3px; }
    .layer-name { font-size: 20px; font-weight: 800; }
    .step-badge {
      background: #e3000b; color: #fff; font-weight: 700;
      padding: 5px 12px; border-radius: 4px; font-size: 13px;
      white-space: nowrap; align-self: center;
    }
    .overview-badge { background: #444; }
    .page-body { display: flex; gap: 18px; align-items: flex-start; }
    .grid-img  { border: 1px solid #ccc; image-rendering: pixelated; flex-shrink: 0; }
    .parts-list { flex: 1; }
    .parts-list h3 { font-size: 12px; font-weight: 700; color: #555; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .part-rows { display: flex; flex-direction: column; gap: 4px; }
    .part-row  { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .swatch    { width: 16px; height: 16px; border: 1px solid rgba(0,0,0,0.2); flex-shrink: 0; border-radius: 2px; }
    .overview-note { font-size: 12px; color: #555; line-height: 1.7; padding-top: 4px; }
    @media print {
      .page { page-break-after: always; }
      body  { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  // ── Main export ───────────────────────────────────────────────────────────

  function generate(brickData) {
    const { plateGrid, colorGrid } = brickData;
    const layers = buildLayers(plateGrid, colorGrid);

    // Overview page
    const overviewImg = renderOverview(colorGrid);
    const totalSteps  = layers.length;

    const pages = [
      pageHtml(0, totalSteps, 'Colour Reference — Complete Map', overviewImg, [], true),
    ];

    // One page per layer
    layers.forEach((layer, i) => {
      const prevPieces = layers.slice(0, i).flatMap(l => l.pieces);
      const img = renderLayer(layer.pieces, prevPieces);
      pages.push(pageHtml(i + 1, totalSteps, layer.label, img, layer.pieces, false));
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Build Instructions — Brick Elevation Map</title>
  <style>${CSS}</style>
</head>
<body>
  ${pages.join('\n')}
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to generate the PDF instructions.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }

  return { generate };
})();
