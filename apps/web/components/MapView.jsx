'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { loadGreen, loadSegments } from '@/lib/data';

const AOI = { minLon: 39.5, minLat: 24.36, maxLon: 39.72, maxLat: 24.58 };

/**
 * Self-authored "ink" basemap: a single background layer in the brand colour.
 * No tile provider, no API key, and it works with the network unplugged — the
 * city's own geometry supplies all the visual structure we need.
 */
const INK_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#010628' } }],
};

export default function MapView({ mode = 'flood', onSelect }) {
  const container = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !container.current) return;

    const map = new maplibregl.Map({
      container: container.current,
      style: INK_STYLE,
      bounds: [
        [AOI.minLon, AOI.minLat],
        [AOI.maxLon, AOI.maxLat],
      ],
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '© OpenStreetMap contributors · Copernicus',
      }),
      'bottom-right',
    );

    map.on('load', async () => {
      const [segments, green] = await Promise.all([loadSegments(), loadGreen()]);

      if (segments?.features?.length) {
        map.addSource('segments', { type: 'geojson', data: segments, promoteId: 'id' });

        // glow underlay — the neon signature, and it makes thin lines readable
        map.addLayer({
          id: 'segments-glow',
          type: 'line',
          source: 'segments',
          paint: {
            'line-color': [
              'interpolate', ['linear'], ['coalesce', ['get', 's'], 0],
              0, '#2A9759', 35, '#50FF4A', 55, '#FFC857', 75, '#FF6B5A', 100, '#FF3B2A',
            ],
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              10, ['*', ['coalesce', ['get', 's'], 0], 0.05],
              14, ['*', ['coalesce', ['get', 's'], 0], 0.13],
            ],
            'line-blur': 6,
            'line-opacity': [
              'interpolate', ['linear'], ['coalesce', ['get', 's'], 0],
              0, 0, 50, 0.25, 90, 0.55,
            ],
          },
        });

        map.addLayer({
          id: 'segments-line',
          type: 'line',
          source: 'segments',
          paint: {
            'line-color': [
              'case',
              ['==', ['get', 'b'], 'insufficient_data'], '#3A4667',
              [
                'interpolate', ['linear'], ['coalesce', ['get', 's'], 0],
                0, '#2A9759', 35, '#50FF4A', 55, '#FFC857', 75, '#FF6B5A', 100, '#FF3B2A',
              ],
            ],
            'line-width': [
              'interpolate', ['exponential', 1.4], ['zoom'],
              10, 0.9,
              13, ['+', 1.2, ['*', ['coalesce', ['get', 's'], 0], 0.03]],
              16, ['+', 2.4, ['*', ['coalesce', ['get', 's'], 0], 0.07]],
            ],
            'line-opacity': mode === 'waste' ? 0.22 : 0.88,
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }

      if (green?.features?.length) {
        map.addSource('green', { type: 'geojson', data: green, promoteId: 'id' });

        map.addLayer({
          id: 'green-fill',
          type: 'fill',
          source: 'green',
          filter: ['==', ['get', 't'], 'green'],
          paint: {
            'fill-color': '#2A9759',
            'fill-opacity': mode === 'flood' ? 0.16 : 0.34,
          },
        });
        map.addLayer({
          id: 'green-line',
          type: 'line',
          source: 'green',
          filter: ['==', ['get', 't'], 'green'],
          paint: { 'line-color': '#50FF4A', 'line-width': 1, 'line-opacity': 0.6 },
        });

        // the spill ring — the whole basis of Module A
        map.addLayer({
          id: 'ring-fill',
          type: 'fill',
          source: 'green',
          filter: ['==', ['get', 't'], 'ring'],
          paint: {
            'fill-color': [
              'case',
              // honesty: a ring under ~10 pixels cannot support a claim
              ['==', ['get', 'small'], true], '#6B7A9E',
              '#00C4D5',
            ],
            'fill-opacity': mode === 'waste' ? 0.45 : 0.14,
          },
        });
      }

      const clickable = ['segments-line', 'green-fill'];
      for (const id of clickable) {
        if (!map.getLayer(id)) continue;
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
        map.on('click', id, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties ?? {};
          const name = p.name || p.id;
          const score = p.s ?? null;
          new maplibregl.Popup({ closeButton: false, offset: 10 })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-weight:600;margin-bottom:4px">${name}</div>` +
                (score !== null
                  ? `<div style="color:#A9B6D4">درجة المخاطر <b style="color:#50FF4A" dir="ltr">${score}</b></div>`
                  : `<div style="color:#6B7A9E">لا توجد درجة — بيانات غير كافية</div>`),
            )
            .addTo(map);
          onSelect?.(p);
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // toggling the rain condition re-paints the SAME map: streets dim and rings
  // light up for waste, and the reverse for flooding
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded?.()) return;
    try {
      if (map.getLayer('segments-line')) {
        map.setPaintProperty('segments-line', 'line-opacity', mode === 'waste' ? 0.22 : 0.88);
      }
      if (map.getLayer('ring-fill')) {
        map.setPaintProperty('ring-fill', 'fill-opacity', mode === 'waste' ? 0.45 : 0.14);
      }
      if (map.getLayer('green-fill')) {
        map.setPaintProperty('green-fill', 'fill-opacity', mode === 'flood' ? 0.16 : 0.34);
      }
    } catch {
      /* style not ready yet — the load handler sets the right values anyway */
    }
  }, [mode]);

  return (
    <div className="map-shell" style={{ height: '100%', minHeight: 420 }}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      <div className="legend">
        <span><i style={{ background: '#FF6B5A' }} />حرج</span>
        <span><i style={{ background: '#FFC857' }} />مرتفع</span>
        <span><i style={{ background: '#50FF4A' }} />مستقر</span>
        <span><i style={{ background: '#3A4667' }} />غير قابل للتقييم</span>
      </div>
    </div>
  );
}
