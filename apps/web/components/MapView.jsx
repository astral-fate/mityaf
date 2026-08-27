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
  sources: {
    satellite: { type: 'image', url: '/img/madinah-hero.jpg', coordinates: HERO_BOUNDS },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#04081a' } },
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      paint: {
        // Desert reflectance is bright; pull it back so the overlay reads as
        // the foreground and not as clutter on top of a photograph.
        'raster-opacity': 0.5,
        'raster-saturation': -0.25,
        'raster-contrast': 0.12,
        'raster-fade-duration': 0,
      },
    },
  ],
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
  onSelect,
}) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const selectRef = useRef(onSelect);
  const [status, setStatus] = useState('loading');
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
      try {
        const [segments, green] = await Promise.all([loadSegments(), loadGreen()]);
        const nSeg = segments?.features?.length ?? 0;
        const nGreen = green?.features?.filter((f) => f.properties?.t === 'green').length ?? 0;
        setCounts({ seg: nSeg, green: nGreen });

        if (!nSeg && !nGreen) {
          setStatus('empty');
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

        setStatus('ready');
      } catch (err) {
        console.error('[map] failed to load layers', err);
        setStatus('error');
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

  return (
    <div className="map-shell">
      <div ref={container} className="map-canvas" />

      {status === 'loading' && (
        <div className="map-overlay">جارٍ تحميل طبقات المدينة…</div>
      )}
      {status === 'error' && (
        <div className="map-overlay err">تعذّر تحميل طبقات الخريطة</div>
      )}

      {status === 'ready' && (
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
