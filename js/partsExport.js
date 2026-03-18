/**
 * partsExport.js
 * Converts a completed brick elevation map into a downloadable parts list.
 *
 * Pieces used per stud column:
 *   3005 — 1×1 Brick  (floor(plates / 3) per column)
 *   3024 — 1×1 Plate  (plates % 3 per column)
 *   3811 — 32×32 Baseplate (1 total, Light Bluish Gray)
 *
 * Export formats:
 *   • Bricklink Wanted List XML — import directly at bricklink.com → Wanted List → Upload
 *   • CSV — human-readable summary for reference
 */

const PartsExport = (() => {

  const PART_BRICK     = '3005';
  const PART_PLATE     = '3024';
  const PART_BASEPLATE = '3811';
  const BL_GRAY        = 86;    // Light Bluish Gray baseplate

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function aggregate(plateGrid, colorGrid) {
    const counts = {};

    const add = (partId, blColorId, qty) => {
      const key = `${partId}:${blColorId}`;
      if (!counts[key]) counts[key] = { partId, blColorId, qty: 0 };
      counts[key].qty += qty;
    };

    const rows = plateGrid.length;
    const cols = plateGrid[0].length;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const plates = plateGrid[r][c];
        const { r: pr, g: pg, b: pb } = hexToRgb(colorGrid[r][c]);
        const blId = ImageryService.snapToBlId(pr, pg, pb);

        const bricks    = Math.floor(plates / 3);
        const remPlates = plates % 3;

        if (bricks > 0)    add(PART_BRICK, blId, bricks);
        if (remPlates > 0) add(PART_PLATE, blId, remPlates);
      }
    }

    add(PART_BASEPLATE, BL_GRAY, 1);

    return Object.values(counts)
      .sort((a, b) => a.partId.localeCompare(b.partId) || a.blColorId - b.blColorId);
  }

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
