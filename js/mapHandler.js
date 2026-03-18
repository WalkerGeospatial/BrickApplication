/**
 * mapHandler.js
 * Manages the Leaflet map and square-drawing tool.
 *
 * Always uses ESRI World Imagery as the basemap (matches the imagery
 * fetched by imageryService.js for colour sampling).
 *
 * Fires two events via the fluent .on() API:
 *   'boundsSelected' — user finished drawing; payload = bounds object
 *   'boundsCleared'  — selection was deleted via the Leaflet toolbar
 */

class MapHandler {
  constructor(containerId) {
    this.containerId = containerId;
    this.map         = null;
    this.drawLayer   = null;
    this.currentRect = null;
    this.drawControl = null;
    this._tileLayer  = null;
    this._callbacks  = {};
  }

  // ── Fluent event emitter ─────────────────────────────────────────────────

  on(event, cb) { this._callbacks[event] = cb; return this; }
  _emit(event, data) { if (this._callbacks[event]) this._callbacks[event](data); }

  // ── Init ─────────────────────────────────────────────────────────────────

  init() {
    this.map = L.map(this.containerId, {
      center: [39.8283, -98.5795], // contiguous US centre
      zoom:   5,
    });

    // Satellite imagery — must match the tiles sampled by imageryService.js
    this._tileLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      }
    ).addTo(this.map);

    this.drawLayer = new L.FeatureGroup();
    this.map.addLayer(this.drawLayer);

    this.drawControl = new L.Control.Draw({
      draw: {
        polygon:      false,
        polyline:     false,
        circle:       false,
        circlemarker: false,
        marker:       false,
        rectangle: {
          shapeOptions: {
            color:       '#e3000b',
            weight:      2,
            fillColor:   '#ffcf00',
            fillOpacity: 0.15,
          },
        },
      },
      edit: {
        featureGroup: this.drawLayer,
        edit:         false,
        remove:       true,
      },
    });
    this.map.addControl(this.drawControl);

    // Patch Leaflet.Draw to constrain the live drag to a geographic square.
    // _drawShape fires on every mousemove; squarifying here keeps the
    // visual rectangle square before it reaches setBounds.
    const origDrawShape = L.Draw.Rectangle.prototype._drawShape;
    L.Draw.Rectangle.prototype._drawShape = function (latlng) {
      const squared = this._startLatLng
        ? MapHandler._squarifyEndLatLng(this._startLatLng, latlng)
        : latlng;
      origDrawShape.call(this, squared);
    };

    this.map.on(L.Draw.Event.CREATED, (e) => {
      const b = e.layer.getBounds();
      const bounds = {
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLon: b.getWest(),
        maxLon: b.getEast(),
      };

      this.drawLayer.clearLayers();
      this.currentRect = L.rectangle(
        [[bounds.minLat, bounds.minLon], [bounds.maxLat, bounds.maxLon]],
        { color: '#e3000b', weight: 2, fillColor: '#ffcf00', fillOpacity: 0.15 }
      );
      this.drawLayer.addLayer(this.currentRect);
      this._emit('boundsSelected', bounds);
    });

    this.map.on(L.Draw.Event.DELETED, () => {
      this.currentRect = null;
      this._emit('boundsCleared');
    });
  }

  // ── Public helpers ───────────────────────────────────────────────────────

  /** Programmatically place a geographic-square selection and emit boundsSelected. */
  drawDefaultSelection(centerLat, centerLon, sideKm) {
    const kmPerLat = 111.32;
    const kmPerLon = 111.32 * Math.cos(centerLat * Math.PI / 180);
    const halfLat  = sideKm / 2 / kmPerLat;
    const halfLon  = sideKm / 2 / kmPerLon;
    const bounds = {
      minLat: centerLat - halfLat,
      maxLat: centerLat + halfLat,
      minLon: centerLon - halfLon,
      maxLon: centerLon + halfLon,
    };
    this.drawLayer.clearLayers();
    this.currentRect = L.rectangle(
      [[bounds.minLat, bounds.minLon], [bounds.maxLat, bounds.maxLon]],
      { color: '#e3000b', weight: 2, fillColor: '#ffcf00', fillOpacity: 0.15 }
    );
    this.drawLayer.addLayer(this.currentRect);
    this.map.fitBounds(this.currentRect.getBounds(), { padding: [60, 60] });
    this._emit('boundsSelected', bounds);
  }

  /** Enable the rectangle draw tool. */
  startDraw() {
    const rect = this.drawControl._toolbars.draw._modes.rectangle;
    if (rect && rect.handler) rect.handler.enable();
  }

  /** Remove the current rectangle without emitting an event. */
  clearSelection() {
    this.drawLayer.clearLayers();
    this.currentRect = null;
  }

  // ── Static geo utilities ─────────────────────────────────────────────────

  /** Returns area in km² for a bounds object. */
  static calcAreaKm2(bounds) {
    const R    = 6371;
    const lat1 = bounds.minLat * Math.PI / 180;
    const lat2 = bounds.maxLat * Math.PI / 180;
    const dLat = (bounds.maxLat - bounds.minLat) * Math.PI / 180;
    const dLon = (bounds.maxLon - bounds.minLon) * Math.PI / 180;
    return Math.abs(R * dLat * R * Math.cos((lat1 + lat2) / 2) * dLon);
  }

  /**
   * Given a fixed start corner and a moving end latlng, returns a new end
   * latlng that keeps the selection geographically square (equal km sides).
   * Uses the shorter axis as the side length so the shape fits the drag.
   */
  static _squarifyEndLatLng(start, end) {
    const kmPerLat = 111.32;
    const kmPerLon = 111.32 * Math.cos(((start.lat + end.lat) / 2) * Math.PI / 180);
    const sideKm   = Math.min(
      Math.abs(end.lat - start.lat) * kmPerLat,
      Math.abs(end.lng - start.lng) * kmPerLon
    );
    return L.latLng(
      start.lat + (end.lat >= start.lat ? 1 : -1) * sideKm / kmPerLat,
      start.lng + (end.lng >= start.lng ? 1 : -1) * sideKm / kmPerLon
    );
  }
}
