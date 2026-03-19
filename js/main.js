/**
 * main.js
 * Orchestrates the Brick Elevation Map Builder application.
 *
 * Flow:
 *   1. User draws a square on the map
 *   2. "Generate" fetches elevation + optional satellite imagery
 *   3. 3D preview renders the terrain as a LEGO plate-stack model
 *   4. User can snap colours to the brick palette, edit individually,
 *      bulk-recolor, adjust scale, and export parts lists / PDF instructions
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── State ────────────────────────────────────────────────────────────────

  const state = {
    bounds:           null,   // { minLat, maxLat, minLon, maxLon }
    elevGrid:         null,   // [row][col] elevation in metres
    imageColorGrid:   null,   // [row][col] raw satellite hex colours (pre-snap)
    brickData:        null,   // { plateGrid, colorGrid, stats }
    renderer:         null,   // Renderer3D instance
    generating:       false,  // guard against overlapping generateMap() calls
    editMode:         false,  // true = brick clicks open the colour picker
    pickerInstanceId: null,   // which brick is currently selected in the picker
  };

  const GRID_SIZE = 32; // fixed: one 32×32 LEGO baseplate

  // ── DOM refs ─────────────────────────────────────────────────────────────

  const el = id => document.getElementById(id);

  const btnDraw           = el('btn-draw');
  const btnClear          = el('btn-clear');
  const btnGenerate       = el('btn-generate');
  const btnReset3d        = el('btn-reset-camera');
  const btnSnapColors     = el('btn-snap-colors');
  const btnEditToggle     = el('btn-edit-toggle');
  const btnBulkRecolor    = el('btn-bulk-recolor');
  const btnExportPdf      = el('btn-export-pdf');
  const btnExportXml      = el('btn-export-xml');
  const btnExportCsv      = el('btn-export-csv');
  const previewToolbarBot = el('preview-toolbar-bottom');
  const exportGroup       = btnExportPdf.closest('.preview-exports');

  const brickColorPicker  = el('brick-color-picker');
  const pickerSwatches    = el('picker-swatches');
  const btnClosePicker    = el('btn-close-picker');
  const previewCanvas      = el('preview-canvas');
  const btnClosePreview    = el('btn-close-preview');

  const bulkPanel         = el('bulk-recolor-panel');
  const bulkSourceEl      = el('bulk-source-swatches');
  const bulkPaletteEl     = el('bulk-palette-swatches');
  const bulkReplaceLabel  = el('bulk-replace-label');
  const btnCloseBulk      = el('btn-close-bulk');

  const areaInfo          = el('area-info');
  const scaleSection      = el('scale-section');
  const scaleSlider       = el('scale-slider');
  const scaleLabel        = el('scale-label');
  const colorModeEl       = el('color-mode');
  const colorModeHint     = el('color-mode-hint');
  const progressWrap      = el('progress-wrap');
  const progressFill      = el('progress-bar-fill');
  const progressLbl       = el('progress-label');
  const statsWrap         = el('stats-wrap');
  const legendWrap        = el('legend');
  const previewPanel      = el('preview-panel');
  const previewLoad       = el('preview-loading');
  const mapHint           = el('map-hint');

  const stepEls = [1, 2, 3].map(n => el(`step-${n}`));

  // ── Mobile sidebar ───────────────────────────────────────────────────────

  const sidebar         = el('sidebar');
  const sidebarBackdrop = el('sidebar-backdrop');
  const btnMenu         = el('btn-menu');

  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('visible');
  }

  btnMenu.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    sidebarBackdrop.classList.toggle('visible');
  });

  el('btn-sidebar-close').addEventListener('click', closeSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // ── Renderer ─────────────────────────────────────────────────────────────

  state.renderer = new Renderer3D('preview-canvas');
  state.renderer.init();
  window.addEventListener('resize', () => state.renderer.resize());

  // ── Map ──────────────────────────────────────────────────────────────────

  const mapHandler = new MapHandler('map');
  mapHandler
    .on('boundsSelected', onBoundsSelected)
    .on('boundsCleared',  onBoundsCleared);
  mapHandler.init();

  // Pre-select the Grand Canyon as a useful starting example (~50 km side)
  mapHandler.drawDefaultSelection(36.1, -112.1, 50);

  // ── Colour mode selector ─────────────────────────────────────────────────

  colorModeEl.addEventListener('change', () => {
    const mode        = colorModeEl.value;
    const isSatellite = mode === 'satellite';

    colorModeHint.textContent = isSatellite
      ? (state.elevGrid
          ? 'Regenerate to fetch satellite imagery for this area.'
          : 'Samples real satellite imagery colours per stud.')
      : 'Uses elevation-based colours from the selected palette.';

    rebuildLegend(mode);

    if (state.brickData) {
      legendWrap.classList.toggle('visible', !isSatellite);

      // If we have elevation data and switched to a terrain palette,
      // re-derive colours immediately — no tile fetch needed.
      if (!isSatellite && state.elevGrid) {
        const maxPlates = parseInt(scaleSlider.value);
        const fresh = BrickCalculator.convert(state.elevGrid, maxPlates, mode);
        state.brickData.colorGrid = fresh.colorGrid;
        state.imageColorGrid = null;
        state.renderer.build(state.brickData.plateGrid, state.brickData.colorGrid);

        // Adjust toolbar: terrain palettes have bulk/edit/export from the start
        btnSnapColors.style.display  = 'none';
        exportGroup.style.display    = '';
        btnBulkRecolor.style.display = '';
        btnEditToggle.style.display  = '';
        btnEditToggle.textContent    = '✏ Edit: OFF';
        btnEditToggle.classList.remove('active');
        state.editMode = false;
        closePicker();
        bulkPanel.style.display = 'none';
      }
    }
  });

  // ── Bulk recolor panel ───────────────────────────────────────────────────

  let bulkSourceHex = null;

  // Build the replacement palette swatches once at startup
  ImageryService.getPalette().forEach(hex => {
    const s = document.createElement('div');
    s.className        = 'picker-swatch';
    s.style.background = hex;
    s.title            = hex;
    s.addEventListener('click', () => {
      if (!bulkSourceHex) return;
      state.renderer.replaceColor(bulkSourceHex, hex);
      state.brickData.colorGrid = state.brickData.colorGrid.map(row =>
        row.map(c => c.toUpperCase() === bulkSourceHex.toUpperCase() ? hex : c)
      );
      bulkSourceHex = null;
      rebuildBulkSourceSwatches();
      bulkReplaceLabel.style.display = 'none';
      bulkPaletteEl.style.display    = 'none';
    });
    bulkPaletteEl.appendChild(s);
  });

  function rebuildBulkSourceSwatches() {
    bulkSourceEl.innerHTML = '';
    if (!state.brickData) return;
    const unique = [...new Set(state.brickData.colorGrid.flat().map(h => h.toUpperCase()))].sort();
    unique.forEach(hex => {
      const s = document.createElement('div');
      s.className        = 'bulk-source-swatch';
      s.style.background = hex;
      s.title            = hex;
      s.addEventListener('click', () => {
        bulkSourceHex = hex;
        bulkSourceEl.querySelectorAll('.bulk-source-swatch').forEach(sw =>
          sw.classList.toggle('selected', sw.title.toUpperCase() === hex)
        );
        bulkReplaceLabel.style.display = '';
        bulkPaletteEl.style.display    = '';
      });
      bulkSourceEl.appendChild(s);
    });
  }

  btnBulkRecolor.addEventListener('click', () => {
    bulkSourceHex = null;
    rebuildBulkSourceSwatches();
    bulkReplaceLabel.style.display = 'none';
    bulkPaletteEl.style.display    = 'none';
    bulkPanel.style.display = bulkPanel.style.display === 'none' ? '' : 'none';
  });

  btnCloseBulk.addEventListener('click', () => {
    bulkPanel.style.display = 'none';
    bulkSourceHex = null;
  });

  // ── Single-brick colour picker ────────────────────────────────────────────

  // Build the picker swatches once at startup
  ImageryService.getPalette().forEach(hex => {
    const s = document.createElement('div');
    s.className        = 'picker-swatch';
    s.style.background = hex;
    s.title            = hex;
    s.addEventListener('click', () => applyPickerColor(hex));
    pickerSwatches.appendChild(s);
  });

  function applyPickerColor(hex) {
    if (state.pickerInstanceId == null) return;
    state.renderer.setInstanceColor(state.pickerInstanceId, hex);
    const row = Math.floor(state.pickerInstanceId / GRID_SIZE);
    const col = state.pickerInstanceId % GRID_SIZE;
    state.brickData.colorGrid[row][col] = hex;
    pickerSwatches.querySelectorAll('.picker-swatch').forEach(s =>
      s.classList.toggle('selected', s.title === hex)
    );
  }

  function openPicker(instanceId, anchorX, anchorY) {
    state.pickerInstanceId = instanceId;
    state.renderer.highlightInstance(instanceId);

    // Highlight the brick's current colour in the swatch grid
    const row        = Math.floor(instanceId / GRID_SIZE);
    const col        = instanceId % GRID_SIZE;
    const currentHex = (state.brickData.colorGrid[row][col] || '').toUpperCase();
    pickerSwatches.querySelectorAll('.picker-swatch').forEach(s =>
      s.classList.toggle('selected', s.title.toUpperCase() === currentHex)
    );

    // Position the panel near the click, clamped inside the preview panel
    const panel = el('preview-panel');
    const pr    = panel.getBoundingClientRect();
    brickColorPicker.style.display = '';
    const pw = brickColorPicker.offsetWidth  || 230;
    const ph = brickColorPicker.offsetHeight || 120;
    brickColorPicker.style.left = `${Math.max(8, Math.min(anchorX - pr.left + 12, pr.width  - pw - 8))}px`;
    brickColorPicker.style.top  = `${Math.max(8, Math.min(anchorY - pr.top  + 12, pr.height - ph - 8))}px`;
  }

  function closePicker() {
    state.renderer.highlightInstance(null);
    state.pickerInstanceId = null;
    brickColorPicker.style.display = 'none';
  }

  btnClosePicker.addEventListener('click', closePicker);

  // Click on 3D canvas → pick a brick when edit mode is active (desktop)
  previewCanvas.addEventListener('click', e => {
    if (!state.editMode || !state.brickData) return;
    const instanceId = state.renderer.pickBrick(e.clientX, e.clientY);
    if (instanceId == null) { closePicker(); return; }
    openPicker(instanceId, e.clientX, e.clientY);
  });

  // Touch tap on 3D canvas → pick a brick on mobile.
  // OrbitControls calls preventDefault() on touchstart which suppresses the
  // click event on iOS Safari, so we listen to touchend directly.
  // A distance threshold distinguishes a tap from a camera drag.
  let _touchOrigin = null;
  previewCanvas.addEventListener('touchstart', e => {
    if (!state.editMode || !state.brickData) return;
    _touchOrigin = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  previewCanvas.addEventListener('touchend', e => {
    if (!state.editMode || !state.brickData || !_touchOrigin) return;
    const t  = e.changedTouches[0];
    const dx = t.clientX - _touchOrigin.x;
    const dy = t.clientY - _touchOrigin.y;
    _touchOrigin = null;
    if (dx * dx + dy * dy > 100) return; // was a drag, not a tap (10 px threshold)
    const instanceId = state.renderer.pickBrick(t.clientX, t.clientY);
    if (instanceId == null) { closePicker(); return; }
    openPicker(instanceId, t.clientX, t.clientY);
  });

  // ── Initial legend ───────────────────────────────────────────────────────

  rebuildLegend(colorModeEl.value);

  // ── Button handlers ───────────────────────────────────────────────────────

  btnDraw.addEventListener('click', () => {
    mapHandler.startDraw();
    setHint('Click and drag to draw your area on the map');
    closeSidebar();
  });

  btnClear.addEventListener('click', () => {
    mapHandler.clearSelection();
    onBoundsCleared();
  });

  btnGenerate.addEventListener('click', generateMap);

  btnReset3d.addEventListener('click', () => state.renderer.resetCamera());

  btnClosePreview.addEventListener('click', () => {
    previewPanel.classList.remove('visible');
    previewToolbarBot.style.display = 'none';
    closePicker();
    bulkPanel.style.display = 'none';
    // Let the map re-fill its new size after the CSS transition
    setTimeout(() => mapHandler.map.invalidateSize(), 420);
  });

  btnSnapColors.addEventListener('click', () => {
    if (!state.imageColorGrid) return;
    const snapped = ImageryService.snapGridColors(state.imageColorGrid);
    state.brickData.colorGrid = snapped;
    state.renderer.build(state.brickData.plateGrid, snapped);

    btnSnapColors.textContent = '✓ Snapped';
    btnSnapColors.classList.add('snapped');
    exportGroup.style.display    = '';
    btnBulkRecolor.style.display = '';
    btnEditToggle.style.display  = '';
    btnEditToggle.textContent    = '✏ Edit: OFF';
    btnEditToggle.classList.remove('active');
    state.editMode = false;
    closePicker();
  });

  btnEditToggle.addEventListener('click', () => {
    state.editMode = !state.editMode;
    btnEditToggle.textContent = state.editMode ? '✏ Edit: ON' : '✏ Edit: OFF';
    btnEditToggle.classList.toggle('active', state.editMode);
    if (!state.editMode) closePicker();
  });

  btnExportPdf.addEventListener('click', () => {
    if (state.brickData) InstructionsPdf.generate(state.brickData);
  });

  btnExportXml.addEventListener('click', () => {
    if (state.brickData) PartsExport.exportBricklink(state.brickData);
  });

  btnExportCsv.addEventListener('click', () => {
    if (state.brickData) PartsExport.exportCsv(state.brickData);
  });

  let _scaleDebounce = null;
  scaleSlider.addEventListener('input', () => {
    const plates = parseInt(scaleSlider.value);
    const bricks = plates / 3;
    scaleLabel.textContent = `${bricks} brick${bricks !== 1 ? 's' : ''} (${plates} plates)`;
    if (!state.elevGrid) return;
    clearTimeout(_scaleDebounce);
    _scaleDebounce = setTimeout(() => applyScale(plates), 150);
  });

  // ── Workflow steps ────────────────────────────────────────────────────────

  function setStep(active) {
    stepEls.forEach((el, i) => {
      el.classList.remove('active', 'done');
      if      (i + 1 < active)  el.classList.add('done');
      else if (i + 1 === active) el.classList.add('active');
    });
  }

  setStep(1);

  // ── Bounds events ─────────────────────────────────────────────────────────

  function onBoundsSelected(bounds) {
    state.bounds = bounds;
    setHint(null);
    updateAreaInfo(bounds);
    btnGenerate.disabled = false;
    btnClear.disabled    = false;
    setStep(2);
  }

  function onBoundsCleared() {
    state.bounds         = null;
    state.elevGrid       = null;
    state.imageColorGrid = null;
    state.brickData      = null;

    areaInfo.innerHTML       = '<span style="color:var(--text-muted)">Draw a square on the map to begin.</span>';
    btnDraw.disabled         = false;
    btnGenerate.disabled     = true;
    btnClear.disabled        = true;
    state.editMode           = false;
    previewToolbarBot.style.display = 'none';
    exportGroup.style.display       = 'none';
    btnBulkRecolor.style.display    = 'none';
    btnEditToggle.style.display     = 'none';
    bulkPanel.style.display         = 'none';
    scaleSection.style.display      = 'none';

    statsWrap.classList.remove('visible');
    legendWrap.classList.remove('visible');
    progressWrap.classList.remove('visible');
    closePicker();
    setStep(1);
  }

  function updateAreaInfo(bounds) {
    const area      = MapHandler.calcAreaKm2(bounds);
    const sideKm    = Math.sqrt(area);
    const kmPerStud = sideKm / GRID_SIZE;
    areaInfo.innerHTML = `
      <div>Side length: <span class="info-val">${sideKm.toFixed(2)} km</span></div>
      <div>Grid: <span class="info-val">32 × 32 studs</span> (one baseplate)</div>
      <div>Scale: <span class="info-val">1 stud = ${kmPerStud.toFixed(2)} km</span></div>
      <div>Elevation samples: <span class="info-accent">${(GRID_SIZE * GRID_SIZE * 5).toLocaleString()}</span></div>
    `;
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  async function generateMap() {
    if (!state.bounds || state.generating) return;
    state.generating = true;
    btnGenerate.disabled = true;
    btnDraw.disabled     = true;

    // Fit the map to the selection before reading its zoom level
    if (mapHandler.currentRect) {
      mapHandler.map.fitBounds(mapHandler.currentRect.getBounds());
    }
    setStep(3);
    progressWrap.classList.add('visible');
    statsWrap.classList.remove('visible');
    progressFill.style.background = '';
    setProgress(0, 'Starting…');

    // Show the 3D panel; resize renderer after the CSS transition settles (0.4 s)
    previewPanel.classList.add('visible');
    previewLoad.classList.remove('hidden');
    closeSidebar(); // on mobile: collapse drawer so the 3D panel is fully visible
    setTimeout(() => {
      state.renderer.resize();
      mapHandler.map.invalidateSize();
    }, 420);

    try {
      // Step 1: elevation
      state.elevGrid = await ElevationService.getGridElevations(
        state.bounds, GRID_SIZE, GRID_SIZE,
        (f, label) => setProgress(f, label)
      );

      // Step 2: satellite imagery (only for satellite colour mode)
      const mode = colorModeEl.value;
      if (mode === 'satellite') {
        state.imageColorGrid = await ImageryService.getGridColors(
          state.bounds, GRID_SIZE, GRID_SIZE, false,
          (f, label) => setProgress(0.8 + f * 0.15, label),
          mapHandler.map.getZoom() // use the exact zoom the user sees
        );
      } else {
        state.imageColorGrid = null;
      }

      // Step 3: convert to brick heights + colours
      setProgress(0.97, 'Converting to bricks…');
      const maxPlates = parseInt(scaleSlider.value);
      state.brickData = BrickCalculator.convert(state.elevGrid, maxPlates, mode);
      if (state.imageColorGrid) state.brickData.colorGrid = state.imageColorGrid;

      updateStats(state.brickData.stats);
      state.renderer.build(state.brickData.plateGrid, state.brickData.colorGrid);

      // Update UI state
      const isSatellite = mode === 'satellite';
      previewLoad.classList.add('hidden');
      scaleSection.style.display      = '';
      previewToolbarBot.style.display  = '';
      btnSnapColors.style.display      = isSatellite ? '' : 'none';
      btnSnapColors.classList.remove('snapped');
      btnSnapColors.textContent        = '⬡ Snap to Brick Colors';
      exportGroup.style.display        = isSatellite ? 'none' : '';
      btnBulkRecolor.style.display     = isSatellite ? 'none' : '';
      btnEditToggle.style.display      = isSatellite ? 'none' : '';
      btnEditToggle.textContent        = '✏ Edit: OFF';
      btnEditToggle.classList.remove('active');
      state.editMode = false;
      closePicker();
      bulkPanel.style.display = 'none';

      statsWrap.classList.add('visible');
      legendWrap.classList.toggle('visible', !isSatellite);
      setProgress(1, 'Done!');
      stepEls[2].classList.add('done');

    } catch (err) {
      console.error(err);
      setProgress(0, `Error: ${err.message}`);
      progressFill.style.background = '#f44336';
      previewLoad.classList.add('hidden');
    }

    btnGenerate.disabled = false;
    btnDraw.disabled     = false;
    state.generating     = false;
  }

  // ── Scale slider ──────────────────────────────────────────────────────────

  function applyScale(maxPlates) {
    // Always preserve the current colours — scaling only changes heights.
    // This keeps snapped colours, bulk edits, and individual brick edits intact.
    const savedColorGrid = state.brickData.colorGrid;
    state.brickData = BrickCalculator.convert(state.elevGrid, maxPlates, colorModeEl.value);
    state.brickData.colorGrid = savedColorGrid;
    updateStats(state.brickData.stats);
    state.renderer.build(state.brickData.plateGrid, state.brickData.colorGrid);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function setProgress(fraction, label) {
    progressFill.style.width = `${Math.round(fraction * 100)}%`;
    progressLbl.textContent  = label || '';
  }

  function updateStats(stats) {
    el('stat-elev-range').textContent   = `${stats.minElev}m – ${stats.maxElev}m`;
    el('stat-total-plates').textContent = stats.totalPlates.toLocaleString();
    el('stat-total-bricks').textContent = stats.totalBricks.toLocaleString();
  }

  function rebuildLegend(paletteName) {
    legendWrap.innerHTML = '';
    if (paletteName === 'satellite') return;
    BrickCalculator.getLegend(paletteName).forEach(({ hex, label }) => {
      const row = document.createElement('div');
      row.className = 'legend-item';
      row.innerHTML = `
        <div class="legend-swatch" style="background:${hex};border:1px solid rgba(255,255,255,0.1)"></div>
        <span>${label}</span>
      `;
      legendWrap.appendChild(row);
    });
  }

  function setHint(msg) {
    if (msg) {
      mapHint.textContent = msg;
      mapHint.classList.remove('hidden');
    } else {
      mapHint.classList.add('hidden');
    }
  }

});
