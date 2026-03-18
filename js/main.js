/**
 * main.js
 * Orchestrates the brick elevation map application.
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── State ───────────────────────────────────────────────────────────────
  const state = {
    bounds:         null,
    elevGrid:       null,
    imageColorGrid: null,
    brickData:       null,
    renderer:       null,
    generating:     false,
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const el = id => document.getElementById(id);

  const GRID_SIZE = 32; // one 32×32 baseplate — fixed

  const btnDraw      = el('btn-draw');
  const btnClear     = el('btn-clear');
  const btnGenerate  = el('btn-generate');
  const btnReset3d   = el('btn-reset-camera');
  const exportSection = el('export-section');
  const btnExportXml  = el('btn-export-xml');
  const btnExportCsv  = el('btn-export-csv');
  const areaInfo     = el('area-info');
  const scaleSection   = el('scale-section');
  const scaleSlider    = el('scale-slider');
  const scaleLabel     = el('scale-label');
  const colorModeEl    = el('color-mode');
  const colorModeHint  = el('color-mode-hint');

  const COLOR_MODE_HINTS = {
    'terrain':    'Uses elevation-based terrain colours.',
    'satellite':  'Samples real satellite imagery colours per stud.',
    'brick-snap':  'Satellite colours snapped to the nearest official brick colour.',
  };

  colorModeEl.addEventListener('change', () => {
    const mode = colorModeEl.value;
    colorModeHint.textContent = COLOR_MODE_HINTS[mode];

    // Legend is only meaningful for the terrain palette
    if (state.brickData) {
      if (mode === 'terrain') legendWrap.classList.add('visible');
      else legendWrap.classList.remove('visible');
    }
  });

  const progressWrap = el('progress-wrap');
  const progressFill = el('progress-bar-fill');
  const progressLbl  = el('progress-label');
  const statsWrap    = el('stats-wrap');
  const legendWrap   = el('legend');
  const previewPanel = el('preview-panel');
  const previewLoad  = el('preview-loading');
  const mapHint      = el('map-hint');

  const stepEls = [1, 2, 3].map(n => el(`step-${n}`));

  // ── Renderer (init now so it's ready when the panel opens) ───────────────
  state.renderer = new Renderer3D('preview-canvas');
  state.renderer.init();
  window.addEventListener('resize', () => state.renderer.resize());

  // ── Map setup ─────────────────────────────────────────────────────────────
  const mapHandler = new MapHandler('map');
  mapHandler
    .on('boundsSelected', onBoundsSelected)
    .on('boundsCleared',  onBoundsCleared);
  mapHandler.init();

  // Default selection: Grand Canyon, ~50 km side
  mapHandler.drawDefaultSelection(36.1, -112.1, 50);

  // ── Elevation legend ───────────────────────────────────────────────────────
  buildLegend();

  // ── Button handlers ───────────────────────────────────────────────────────
  btnDraw.addEventListener('click', () => {
    mapHandler.startDraw();
    setHint('Click and drag to draw your area on the map');
  });

  btnClear.addEventListener('click', () => {
    mapHandler.clearSelection();
    onBoundsCleared();
  });

  btnGenerate.addEventListener('click', generateMap);

  btnReset3d.addEventListener('click', () => {
    if (state.renderer) state.renderer.resetCamera();
  });

  btnExportXml.addEventListener('click', () => {
    if (state.brickData) PartsExport.exportBricklink(state.brickData);
  });

  btnExportCsv.addEventListener('click', () => {
    if (state.brickData) PartsExport.exportCsv(state.brickData);
  });

  scaleSlider.addEventListener('input', () => {
    const plates = parseInt(scaleSlider.value);
    const bricks = plates / 3;
    scaleLabel.textContent = `${bricks} brick${bricks !== 1 ? 's' : ''} (${plates} plates)`;
    if (state.elevGrid) applyScale(plates);
  });

  // ── Steps ─────────────────────────────────────────────────────────────────
  function setStep(active) {
    stepEls.forEach((el, i) => {
      el.classList.remove('active', 'done');
      if (i + 1 < active) el.classList.add('done');
      else if (i + 1 === active) el.classList.add('active');
    });
  }

  setStep(1);

  // ── Bounds selected ───────────────────────────────────────────────────────
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
    state.brickData       = null;

    areaInfo.innerHTML = '<span style="color:var(--text-muted)">Draw a rectangle on the map to begin.</span>';
    btnGenerate.disabled = true;
    btnClear.disabled    = true;
    statsWrap.classList.remove('visible');
    legendWrap.classList.remove('visible');
    progressWrap.classList.remove('visible');
    exportSection.style.display = 'none';
    setStep(1);
  }

  function updateAreaInfo(bounds) {
    const area       = MapHandler.calcAreaKm2(bounds);
    const sideKm     = Math.sqrt(area);
    const mmPerStud  = (sideKm * 1000 * 1000) / GRID_SIZE; // mm per stud

    areaInfo.innerHTML = `
      <div>Side length: <span class="info-val">${sideKm.toFixed(2)} km</span></div>
      <div>Grid: <span class="info-val">32 × 32 studs</span> (one baseplate)</div>
      <div>Scale: <span class="info-val">1 stud = ${(mmPerStud / 1000).toFixed(2)} km</span></div>
      <div>Elevation samples: <span class="info-accent">${(GRID_SIZE * GRID_SIZE * 5).toLocaleString()}</span></div>
    `;
  }

  // ── Generate ───────────────────────────────────────────────────────────────
  async function generateMap() {
    if (!state.bounds || state.generating) return;
    state.generating = true;

    const rows = GRID_SIZE, cols = GRID_SIZE;
    btnGenerate.disabled = true;
    btnDraw.disabled     = true;

    if (mapHandler.currentRect) {
      mapHandler.map.fitBounds(mapHandler.currentRect.getBounds());
    }
    setStep(3);

    progressWrap.classList.add('visible');
    statsWrap.classList.remove('visible');
    setProgress(0, 'Starting…');

    // Show preview panel, then resize renderer after the CSS transition (0.4s)
    previewPanel.classList.add('visible');
    previewLoad.classList.remove('hidden');
    setTimeout(() => {
      state.renderer.resize();
      mapHandler.map.invalidateSize();
    }, 420);

    try {
      state.elevGrid = await ElevationService.getGridElevations(
        state.bounds, cols, rows,
        (fraction, label) => setProgress(fraction, label)
      );

      // Fetch imagery colours if needed
      const mode = colorModeEl.value;
      if (mode === 'satellite' || mode === 'brick-snap') {
        state.imageColorGrid = await ImageryService.getGridColors(
          state.bounds, cols, rows,
          mode === 'brick-snap',
          (fraction, label) => setProgress(0.8 + fraction * 0.15, label)
        );
      } else {
        state.imageColorGrid = null;
      }

      setProgress(0.97, 'Converting to bricks…');
      const maxPlates = parseInt(scaleSlider.value);
      state.brickData = BrickCalculator.convert(state.elevGrid, maxPlates);
      if (state.imageColorGrid) state.brickData.colorGrid = state.imageColorGrid;

      updateStats(state.brickData.stats);

      // Build 3D scene
      state.renderer.build(state.brickData.plateGrid, state.brickData.colorGrid);

      previewLoad.classList.add('hidden');
      scaleSection.style.display = '';
      exportSection.style.display = '';
      statsWrap.classList.add('visible');
      if (colorModeEl.value === 'terrain') legendWrap.classList.add('visible');
      else legendWrap.classList.remove('visible');
      setProgress(1, 'Done!');
      setStep(3);
      stepEls[2].classList.add('done');

    } catch (err) {
      console.error(err);
      setProgress(0, `Error: ${err.message}`);
      progressFill.style.background = '#f44336';
      previewLoad.querySelector('p').textContent = `Failed: ${err.message}`;
    }

    btnGenerate.disabled = false;
    btnDraw.disabled     = false;
    state.generating     = false;
  }

  // ── Elevation scale ────────────────────────────────────────────────────────
  function applyScale(maxPlates) {
    state.brickData = BrickCalculator.convert(state.elevGrid, maxPlates);
    if (state.imageColorGrid) state.brickData.colorGrid = state.imageColorGrid;
    updateStats(state.brickData.stats);
    state.renderer.build(state.brickData.plateGrid, state.brickData.colorGrid);
  }

  // ── Progress bar ───────────────────────────────────────────────────────────
  function setProgress(fraction, label) {
    progressFill.style.width = `${Math.round(fraction * 100)}%`;
    progressLbl.textContent  = label || '';
  }

  // ── Stats display ──────────────────────────────────────────────────────────
  function updateStats(stats) {
    el('stat-elev-range').textContent   = `${stats.minElev}m – ${stats.maxElev}m`;
    el('stat-total-plates').textContent = stats.totalPlates.toLocaleString();
    el('stat-total-bricks').textContent = stats.totalBricks.toLocaleString();
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  function buildLegend() {
    const legend = BrickCalculator.getLegend();
    legend.forEach(({ hex, label }) => {
      const row = document.createElement('div');
      row.className = 'legend-item';
      row.innerHTML = `
        <div class="legend-swatch" style="background:${hex};border:1px solid rgba(255,255,255,0.1)"></div>
        <span>${label}</span>
      `;
      legendWrap.appendChild(row);
    });
  }

  // ── Map hint ───────────────────────────────────────────────────────────────
  function setHint(msg) {
    if (!msg) {
      mapHint.classList.add('hidden');
    } else {
      mapHint.textContent = msg;
      mapHint.classList.remove('hidden');
    }
  }


});
