'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { loadGreen, loadSegments } from '@/lib/data';

const AOI = { minLon: 39.5, minLat: 24.36, maxLon: 39.72, maxLat: 24.58 };

/**
 * Self-authored "ink" basemap: one background layer in the brand colour.
 * No tile provider, no API key, works with the network unplugged — the city's
 * own geometry supplies all the structure the map needs.
 */
const INK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#010628' } }],
};

// A segment with no score yet. `coalesce` to a sentinel rather than comparing
// against null, which MapLibre's `==` rejects.
const UNSCORED = ['<', ['coalesce', ['get', 's'], -1], 0];

const RISK_RAMP = [
  'interpolate', ['linear'], ['coalesce', ['get', 's'], 0],
  0, '#2A9759', 35, '#50FF4A', 55, '#FFC857', 75, '#FF6B5A', 100, '#FF3B2A',
];

export default function MapView({ mode = 'flood', scored = false }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const scoredRef = useRef(scored);
  const [status, setStatus] = useState('loading');
  const [counts, setCounts] = useState({ seg: 0, green: 0 });

  scoredRef.current = scored;

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
        customAttribution: '© OpenStreetMap contributors · Copernicus',
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
            const name = p.name || p.id || '—';
            const body =
              p.s !== null && p.s !== undefined
                ? `<div style="color:#A9B6D4">درجة المخاطر <b style="color:#50FF4A" dir="ltr">${p.s}</b></div>`
                : p.area
                  ? `<div style="color:#A9B6D4">المساحة <b dir="ltr">${Number(p.area).toLocaleString('en-US')}</b> م²</div>`
                  : `<div style="color:#6B7A9E">لم تُحتسب درجة بعد</div>`;
            new maplibregl.Popup({ closeButton: false, offset: 10 })
              .setLngLat(e.lngLat)
              .setHTML(`<div style="font-weight:600;margin-bottom:4px">${name}</div>${body}`)
              .addTo(map);
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
        <>
          <div className="map-badge">
            <span className="num">{counts.seg.toLocaleString('en-US')}</span> مقطع ·{' '}
            <span className="num">{counts.green.toLocaleString('en-US')}</span> أصل أخضر
          </div>
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
          </div>
        </>
      )}
    </div>
  );
}
