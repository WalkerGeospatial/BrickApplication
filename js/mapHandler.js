/**
 * mapHandler.js
 * Manages the Leaflet map, tile layer, and rectangle drawing tool.
 * Fires 'boundsSelected' on the returned emitter when drawing is complete.
 */

const BASEMAPS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  topo: {
    label: 'Topographic',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  },
  osm: {
    label: 'Street Map',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  dark: {
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19,
  },
  light: {
    label: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19,
  },
  terrain: {
    label: 'Terrain',
    url: 'https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}{r}.png',
    attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>, &copy; OpenStreetMap contributors',
    maxZoom: 18,
  },
};

class MapHandler {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.drawLayer = null;
    this.currentRect = null;
    this.drawControl = null;
    this._tileLayer = null;
    this._callbacks = {};
  }

  on(event, cb) {
    this._callbacks[event] = cb;
    return this;
  }

  _emit(event, data) {
    if (this._callbacks[event]) this._callbacks[event](data);
  }

  init() {
    this.map = L.map(this.containerId, {
      center: [39.8283, -98.5795], // center of contiguous US
      zoom: 5,
      zoomControl: true,
    });

    this._tileLayer = this._makeTileLayer('satellite');
    this._tileLayer.addTo(this.map);

    this.drawLayer = new L.FeatureGroup();
    this.map.addLayer(this.drawLayer);

    this.drawControl = new L.Control.Draw({
      draw: {
        polygon: false,
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
        rectangle: {
          shapeOptions: {
            color: '#e3000b',
            weight: 2,
            fillColor: '#ffcf00',
            fillOpacity: 0.15,
          },
        },
      },
      edit: {
        featureGroup: this.drawLayer,
        edit: false,
        remove: true,
      },
    });

    this.map.addControl(this.drawControl);

    // Force the live rectangle to stay square while the user drags.
    // _drawShape is called on every mousemove; we squarify the end latlng
    // before it reaches setBounds so the visual shape is always a square.
    const origDrawShape = L.Draw.Rectangle.prototype._drawShape;
    L.Draw.Rectangle.prototype._drawShape = function(latlng) {
      const squared = this._startLatLng
        ? MapHandler._squarifyEndLatLng(this._startLatLng, latlng)
        : latlng;
      origDrawShape.call(this, squared);
    };

    this.map.on(L.Draw.Event.CREATED, (e) => {
      // Shape is already square (enforced live by _drawShape override above).
      // Re-add it styled and emit bounds.
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

  _makeTileLayer(key) {
    const bm = BASEMAPS[key];
    return L.tileLayer(bm.url, { attribution: bm.attribution, maxZoom: bm.maxZoom });
  }

  setBasemap(key) {
    if (!BASEMAPS[key]) return;
    if (this._tileLayer) this.map.removeLayer(this._tileLayer);
    this._tileLayer = this._makeTileLayer(key);
    this._tileLayer.addTo(this.map);
    this._tileLayer.bringToBack();
  }

  /** Programmatically draw a geographic-square selection and emit boundsSelected. */
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

  startDraw() {
    const rect = this.drawControl._toolbars.draw._modes.rectangle;
    if (rect && rect.handler) rect.handler.enable();
  }

  clearSelection() {
    this.drawLayer.clearLayers();
    this.currentRect = null;
  }

  /** Returns area in km² for a bounds object */
  static calcAreaKm2(bounds) {
    const R = 6371;
    const lat1 = bounds.minLat * Math.PI / 180;
    const lat2 = bounds.maxLat * Math.PI / 180;
    const dLat = (bounds.maxLat - bounds.minLat) * Math.PI / 180;
    const dLon = (bounds.maxLon - bounds.minLon) * Math.PI / 180;

    const latKm = R * dLat;
    const lonKm = R * Math.cos((lat1 + lat2) / 2) * dLon;
    return Math.abs(latKm * lonKm);
  }

  /**
   * Given a fixed start corner and a moving end latlng, returns a new end
   * latlng that makes the selection geographically square (equal km sides),
   * using whichever axis is shorter as the side length.
   */
  static _squarifyEndLatLng(start, end) {
    const kmPerLat = 111.32;
    const kmPerLon = 111.32 * Math.cos(((start.lat + end.lat) / 2) * Math.PI / 180);

    const heightKm = Math.abs(end.lat - start.lat) * kmPerLat;
    const widthKm  = Math.abs(end.lng - start.lng) * kmPerLon;
    const sideKm   = Math.min(heightKm, widthKm);

    const signLat = end.lat >= start.lat ? 1 : -1;
    const signLon = end.lng >= start.lng ? 1 : -1;

    return L.latLng(
      start.lat + signLat * sideKm / kmPerLat,
      start.lng + signLon * sideKm / kmPerLon
    );
  }

  /**
   * Shrinks a bounds rectangle to a geographically square area (equal km sides),
   * centred on the original centre point.
   */
  static squarifyBounds(bounds) {
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLon = (bounds.minLon + bounds.maxLon) / 2;

    const kmPerLat = 111.32;
    const kmPerLon = 111.32 * Math.cos(centerLat * Math.PI / 180);

    const heightKm = (bounds.maxLat - bounds.minLat) * kmPerLat;
    const widthKm  = (bounds.maxLon - bounds.minLon) * kmPerLon;
    const sideKm   = Math.min(heightKm, widthKm);

    const halfLat = sideKm / 2 / kmPerLat;
    const halfLon = sideKm / 2 / kmPerLon;

    return {
      minLat: centerLat - halfLat,
      maxLat: centerLat + halfLat,
      minLon: centerLon - halfLon,
      maxLon: centerLon + halfLon,
    };
  }
}
