'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { loadGreen, loadSegments } from '@/lib/data';

const AOI = { minLon: 39.5, minLat: 24.36, maxLon: 39.72, maxLat: 24.58 };

/**
 * Corners of public/img/madinah-hero.jpg, in the order MapLibre wants for an
 * image source: clockwise from top-left.
 *
 * Derived from the mosaic's own tile extent — z14, tiles x[9989..9999],
 * y[7037..7048], cropped to rows 743..2327 — by tools/build_hero_layer.py.
 * Do not adjust these by eye: the vector network is baked into the same frame,
 * so a nudge here silently slides every street off the road it describes.
 */
const HERO_BOUNDS = [
  [39.484863, 24.529087],
  [39.726562, 24.529087],
  [39.726562, 24.405340],
  [39.484863, 24.405340],
];

/**
 * The basemap is our own Sentinel-2 mosaic rather than a tile provider.
 *
 * A flat background made the data look like it was floating in a void — there
 * was nothing to tell you a bright line was a street rather than an abstract
 * shape. A commercial dark basemap would fix that but costs an API key and a
 * network round trip; the imagery we already hold fixes it and doubles as
 * evidence, since the streets visibly land on the streets.
 *
 * It is served as a single image source, which needs no tiling server: the
 * whole thing is one 1.4 MB JPEG bounded to the city.
 */
const INK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#04081a' } }],
};

/**
 * The basemap is attached after `load`, never inside the initial style.
 *
 * MapLibre withholds the `load` event until every source in the initial style
 * has resolved. Putting a 1.4 MB image there meant a slow or failed fetch left
 * the map permanently "loading" behind a dark sheet, with no error anywhere —
 * the map was fine, the readiness signal was not. Attaching afterwards makes
 * the basemap best-effort: it appears when it appears, and its absence costs
 * nothing but the photograph.
 */
const SATELLITE_PAINT = {
  // Desert reflectance is bright; pull it back so the overlay reads as the
  // foreground and not as clutter on top of a photograph.
  'raster-opacity': 0.5,
  'raster-saturation': -0.25,
  'raster-contrast': 0.12,
  'raster-fade-duration': 0,
};

// A segment with no score yet. `coalesce` to a sentinel rather than comparing
// against null, which MapLibre's `==` rejects.
const UNSCORED = ['<', ['coalesce', ['get', 's'], -1], 0];

const RISK_RAMP = [
  'interpolate', ['linear'], ['coalesce', ['get', 's'], 0],
  0, '#2A9759', 35, '#50FF4A', 55, '#FFC857', 75, '#FF6B5A', 100, '#FF3B2A',
];

// Which style layers each UI toggle governs.
const LAYER_GROUPS = {
  satellite: ['satellite'],
  risk: ['segments-glow', 'segments-line'],
  green: ['green-fill', 'green-line'],
  rings: ['ring-fill'],
};

export default function MapView({
  mode = 'flood',
  scored = false,
  layers = { satellite: true, risk: true, green: true, rings: true },
  userLayers = [],
  district = null,
  fitTo = null,
  onSelect,
}) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const selectRef = useRef(onSelect);
  const addedRef = useRef(new Set());
  // Two signals, deliberately separate: `status` is whether the map itself is
  // alive, `dataStatus` is whether our layers arrived. Collapsing them is what
  // let a slow 6.3 MB fetch masquerade as a broken map.
  const [status, setStatus] = useState('loading');
  const [dataStatus, setDataStatus] = useState('idle');
  const [counts, setCounts] = useState({ seg: 0, green: 0 });

  selectRef.current = onSelect;

  useEffect(() => {
    if (mapRef.current || !container.current) return;

    const map = new maplibregl.Map({
      container: container.current,
      style: INK_STYLE,
      bounds: [[AOI.minLon, AOI.minLat], [AOI.maxLon, AOI.maxLat]],
      fitBoundsOptions: { padding: 28 },
      attributionControl: false,
    });
    mapRef.current = map;

    // Without this, an invalid paint expression fails validation and the layer
    // simply never draws - with no visible symptom at all.
    map.on('error', (e) => console.error('[maplibre]', e?.error?.message ?? e));

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '© OpenStreetMap contributors · Sentinel-2 cloudless by EOX (CC BY 4.0) · Copernicus',
      }),
      'bottom-right',
    );

    map.on('load', async () => {
      // The map is usable now. Anything below is enrichment, and none of it
      // may hold the ready signal hostage.
      setStatus('ready');

      map.addSource('satellite', {
        type: 'image', url: '/img/madinah-hero.jpg', coordinates: HERO_BOUNDS,
      });
      map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', paint: SATELLITE_PAINT });

      try {
        setDataStatus('loading');
        const [segments, green] = await Promise.all([loadSegments(), loadGreen()]);
        const nSeg = segments?.features?.length ?? 0;
        const nGreen = green?.features?.filter((f) => f.properties?.t === 'green').length ?? 0;
        setCounts({ seg: nSeg, green: nGreen });

        if (!nSeg && !nGreen) {
          setDataStatus('empty');
          return;
        }

        if (nSeg) {
          map.addSource('segments', { type: 'geojson', data: segments, promoteId: 'id' });

          // Glow. Before scores exist the ramp collapses to zero width, so the
          // glow is driven by a floor value — otherwise the whole layer is
          // invisible and the map looks broken.
          map.addLayer({
            id: 'segments-glow',
            type: 'line',
            source: 'segments',
            paint: {
              'line-color': ['case', UNSCORED, '#1B7FA8', RISK_RAMP],
              'line-width': [
                'interpolate', ['linear'], ['zoom'],
                10, ['max', 1.2, ['*', ['coalesce', ['get', 's'], 0], 0.05]],
                14, ['max', 3.0, ['*', ['coalesce', ['get', 's'], 0], 0.13]],
              ],
              'line-blur': 5,
              'line-opacity': 0.28,
            },
          });

          map.addLayer({
            id: 'segments-line',
            type: 'line',
            source: 'segments',
            paint: {
              // An unscored network is still the real street network and worth
              // seeing. Render it in a legible steel-cyan rather than a dark
              // grey that disappears into the background.
              'line-color': ['case', UNSCORED, '#4FB3D9', RISK_RAMP],
              'line-width': [
                'interpolate', ['exponential', 1.35], ['zoom'],
                10, 0.7,
                12, 1.3,
                14, ['+', 2.0, ['*', ['coalesce', ['get', 's'], 0], 0.03]],
                16, ['+', 3.4, ['*', ['coalesce', ['get', 's'], 0], 0.07]],
              ],
              'line-opacity': mode === 'waste' ? 0.3 : 0.82,
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
        }

        if (nGreen) {
          map.addSource('green', { type: 'geojson', data: green, promoteId: 'id' });

          // the spill ring — the whole basis of Module A
          map.addLayer({
            id: 'ring-fill',
            type: 'fill',
            source: 'green',
            filter: ['==', ['get', 't'], 'ring'],
            paint: {
              // honesty: a ring under ~10 pixels cannot support a claim
              'fill-color': ['case', ['coalesce', ['get', 'small'], false], '#6B7A9E', '#00C4D5'],
              'fill-opacity': mode === 'waste' ? 0.5 : 0.2,
            },
          });

          map.addLayer({
            id: 'green-fill',
            type: 'fill',
            source: 'green',
            filter: ['==', ['get', 't'], 'green'],
            paint: { 'fill-color': '#3FD46E', 'fill-opacity': mode === 'flood' ? 0.34 : 0.55 },
          });
          map.addLayer({
            id: 'green-line',
            type: 'line',
            source: 'green',
            filter: ['==', ['get', 't'], 'green'],
            paint: { 'line-color': '#50FF4A', 'line-width': 1.1, 'line-opacity': 0.75 },
          });
        }

        for (const id of ['segments-line', 'green-fill']) {
          if (!map.getLayer(id)) continue;
          map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
          map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
          map.on('click', id, (e) => {
            const p = e.features?.[0]?.properties ?? {};
            selectRef.current?.({
              id: p.id ?? null,
              name: p.name || null,
              score: p.s ?? null,
              area: p.area ?? null,
              kind: id === 'green-fill' ? 'green' : 'segment',
              lngLat: [e.lngLat.lng, e.lngLat.lat],
            });
          });
        }

        setDataStatus('ready');
      } catch (err) {
        console.error('[map] failed to load layers', err);
        setDataStatus('error');
      }
    });

    // MapLibre measures the container once, at construction. Inside a CSS grid
    // the final height lands after that, which left a 300 px canvas in a 698 px
    // box. Keep the canvas matched to its container.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Toggling the rain condition repaints the SAME map: streets dim and rings
  // light up for waste, and the reverse for flooding.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    const set = (layer, prop, val) => {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, val);
    };
    set('segments-line', 'line-opacity', mode === 'waste' ? 0.3 : 0.82);
    set('ring-fill', 'fill-opacity', mode === 'waste' ? 0.5 : 0.2);
    set('green-fill', 'fill-opacity', mode === 'flood' ? 0.34 : 0.55);
  }, [mode, status]);

  // Layer chips. The satellite layer exists from style load, so it is the one
  // group that can be toggled before the vector data has arrived.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const [group, ids] of Object.entries(LAYER_GROUPS)) {
        const visible = layers?.[group] !== false;
        for (const id of ids) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
          }
        }
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [layers, status]);

  /**
   * Sync imported layers onto the map.
   *
   * A vector import gets three paint layers filtered by geometry type rather
   * than one guessed from the first feature — a drainage export routinely
   * carries lines for the pipes and points for the inlets in the same file,
   * and picking one would silently drop the other.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const wanted = new Set(userLayers.map((l) => l.id));

    for (const id of [...addedRef.current]) {
      if (wanted.has(id)) continue;
      for (const suffix of ['-fill', '-line', '-circle', '-raster']) {
        if (map.getLayer(id + suffix)) map.removeLayer(id + suffix);
      }
      if (map.getSource(id)) map.removeSource(id);
      addedRef.current.delete(id);
    }

    for (const l of userLayers) {
      const vis = l.visible === false ? 'none' : 'visible';

      if (!addedRef.current.has(l.id)) {
        if (l.kind === 'raster') {
          map.addSource(l.id, { type: 'image', url: l.url, coordinates: l.coordinates });
          map.addLayer({
            id: `${l.id}-raster`, type: 'raster', source: l.id,
            paint: { 'raster-opacity': l.opacity, 'raster-fade-duration': 0 },
          });
        } else {
          map.addSource(l.id, { type: 'geojson', data: l.data });
          map.addLayer({
            id: `${l.id}-fill`, type: 'fill', source: l.id,
            filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
            paint: { 'fill-color': l.color, 'fill-opacity': l.opacity * 0.3 },
          });
          map.addLayer({
            id: `${l.id}-line`, type: 'line', source: l.id,
            filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]],
            paint: { 'line-color': l.color, 'line-width': 2.1, 'line-opacity': l.opacity },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
          map.addLayer({
            id: `${l.id}-circle`, type: 'circle', source: l.id,
            filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
            paint: {
              'circle-radius': 4.5, 'circle-color': l.color,
              'circle-opacity': l.opacity,
              'circle-stroke-width': 1, 'circle-stroke-color': 'rgba(4,8,26,.85)',
            },
          });
        }
        addedRef.current.add(l.id);
      }

      const set = (suffix, prop, val) => {
        if (map.getLayer(l.id + suffix)) map.setPaintProperty(l.id + suffix, prop, val);
      };
      set('-raster', 'raster-opacity', l.opacity);
      set('-fill', 'fill-opacity', l.opacity * 0.3);
      set('-line', 'line-opacity', l.opacity);
      set('-circle', 'circle-opacity', l.opacity);
      for (const suffix of ['-fill', '-line', '-circle', '-raster']) {
        if (map.getLayer(l.id + suffix)) map.setLayoutProperty(l.id + suffix, 'visibility', vis);
      }
    }
  }, [userLayers, status]);

  // Narrowing to a district is a filter, not a refetch: the geometry is
  // already on the GPU and setFilter costs nothing next to re-parsing 6.8 MB.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || dataStatus !== 'ready') return;
    const f = district ? ['==', ['get', 'd'], district] : null;
    for (const id of ['segments-line', 'segments-glow']) {
      if (map.getLayer(id)) map.setFilter(id, f);
    }
  }, [district, dataStatus]);

  // Fly to a layer the moment it is imported: dropping a file and seeing the
  // map stay where it was reads as "nothing happened".
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitTo) return;
    const [w, s, e, n] = fitTo;
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 16, duration: 900 });
  }, [fitTo]);

  return (
    <div className="map-shell">
      <div ref={container} className="map-canvas" />

      {/* A chip, not a sheet. The map is already drawn underneath and
          covering it to say "loading" hides the very thing that proves it works. */}
      {(status === 'loading' || dataStatus === 'loading') && (
        <div className="map-chip">جارٍ تحميل طبقات المدينة…</div>
      )}
      {dataStatus === 'error' && (
        <div className="map-chip err">تعذّر تحميل طبقات الخريطة — الخريطة تعمل بدونها</div>
      )}
      {dataStatus === 'empty' && (
        <div className="map-chip err">لا توجد طبقات مبنيّة بعد — شغّل خط الأنابيب</div>
      )}

      {dataStatus === 'ready' && (
        <div className="legend">
          {scored ? (
            <>
              <span><i style={{ background: '#FF6B5A' }} />حرج</span>
              <span><i style={{ background: '#FFC857' }} />مرتفع</span>
              <span><i style={{ background: '#50FF4A' }} />مستقر</span>
            </>
          ) : (
            <span><i style={{ background: '#4FB3D9' }} />شبكة الطرق — لم تُقيَّم بعد</span>
          )}
          <span><i style={{ background: '#3FD46E' }} />مسطّح أخضر</span>
          <span><i style={{ background: '#00C4D5' }} />حزام التماس</span>
          <span className="legend-count">
            <span className="num">{counts.seg.toLocaleString('en-US')}</span> مقطع ·{' '}
            <span className="num">{counts.green.toLocaleString('en-US')}</span> أصل
          </span>
        </div>
      )}
    </div>
  );
}
