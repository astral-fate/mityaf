'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fmt, loadGreenDetail } from '@/lib/data';
import { actionFor, band, scoreAsset, STATUS_META } from '@/lib/score';

/**
 * One green asset, watched over time.
 *
 * The register answers "which assets need attention"; this page answers the
 * next question, which is "why do you say so about this one". So the verdict
 * is shown beside the series it was computed from, over a window the user can
 * change — a claim about a trend that cannot be inspected is a claim nobody
 * should act on.
 */

/** Same frame as the operational map; see MapView for why these are exact. */
const HERO_BOUNDS = [
  [39.484863, 24.529087],
  [39.726562, 24.529087],
  [39.726562, 24.405340],
  [39.484863, 24.405340],
];

const WINDOWS = [
  ['90', 'آخر ٣ أشهر', 90],
  ['180', 'آخر ٦ أشهر', 180],
  ['365', 'آخر سنة', 365],
  ['all', 'كامل الأرشيف', null],
];

/** Hand-drawn so the axes read right-to-left without fighting a chart library. */
function Series({ points, keys }) {
  const W = 900; const H = 260; const PAD = { t: 14, r: 14, b: 26, l: 40 };
  if (!points.length) return <p className="stat-empty">لا أرصاد صافية داخل المدى المحدَّد.</p>;

  const xs = points.map((p) => new Date(p.d).getTime());
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const vals = points.flatMap((p) => keys.map((k) => p[k.key]).filter((v) => v != null));
  const lo = Math.min(-0.1, ...vals); const hi = Math.max(0.6, ...vals);

  const px = (t) => PAD.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
  const py = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  const gridVals = [0, 0.2, 0.4, 0.6].filter((g) => g >= lo && g <= hi);

  return (
    <svg className="series" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      {gridVals.map((g) => (
        <g key={g}>
          <line x1={PAD.l} x2={W - PAD.r} y1={py(g)} y2={py(g)}
                stroke="var(--lp-line)" strokeWidth="1" />
          <text x={PAD.l - 6} y={py(g) + 4} textAnchor="end"
                fontSize="11" fill="var(--lp-fg-3)">{g.toFixed(1)}</text>
        </g>
      ))}
      {keys.map((k) => {
        const d = points
          .filter((p) => p[k.key] != null)
          .map((p, i) => `${i ? 'L' : 'M'}${px(new Date(p.d).getTime()).toFixed(1)},${py(p[k.key]).toFixed(1)}`)
          .join(' ');
        return <path key={k.key} d={d} fill="none" stroke={k.color} strokeWidth="1.8"
                     strokeLinejoin="round" />;
      })}
      <text x={PAD.l} y={H - 8} fontSize="11" fill="var(--lp-fg-3)">
        {String(points[0].d).slice(0, 10)}
      </text>
      <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="11" fill="var(--lp-fg-3)">
        {String(points[points.length - 1].d).slice(0, 10)}
      </text>
    </svg>
  );
}

function AssetMap({ geometry, centroid }) {
  const box = useRef(null);
  useEffect(() => {
    if (!box.current || !geometry) return undefined;
    let map;
    let cancelled = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !box.current) return;
      map = new maplibregl.Map({
        container: box.current,
        style: { version: 8, sources: {}, layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#04081a' } }] },
        center: centroid,
        zoom: 16,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
      map.on('load', () => {
        map.addSource('sat', {
          type: 'image', url: '/img/madinah-hero.jpg', coordinates: HERO_BOUNDS,
        });
        map.addLayer({ id: 'sat', type: 'raster', source: 'sat',
          paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } });
        map.addSource('a', { type: 'geojson', data: { type: 'Feature', geometry, properties: {} } });
        map.addLayer({ id: 'a-fill', type: 'fill', source: 'a',
          paint: { 'fill-color': '#50ff4a', 'fill-opacity': 0.25 } });
        map.addLayer({ id: 'a-line', type: 'line', source: 'a',
          paint: { 'line-color': '#50ff4a', 'line-width': 2 } });
      });
    })();
    return () => { cancelled = true; if (map) map.remove(); };
  }, [geometry, centroid]);

  return <div className="asset-map" ref={box} />;
}

export default function GreenAssetDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [a, setA] = useState(null);
  const [missing, setMissing] = useState(false);
  const [win, setWin] = useState('365');

  useEffect(() => {
    loadGreenDetail(id).then((d) => (d ? setA(d) : setMissing(true)));
  }, [id]);

  const points = useMemo(() => {
    const all = a?.series ?? [];
    const days = WINDOWS.find(([k]) => k === win)?.[2];
    if (!days) return all;
    const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    return all.filter((p) => p.d >= cut);
  }, [a, win]);

  if (missing) {
    return (
      <main className="pg">
        <header className="pg-head"><div><h1>الأصل غير موجود</h1>
          <p>لا يوجد أصل بهذا المعرّف: {id}</p></div></header>
      </main>
    );
  }
  if (!a) return <main className="pg"><div className="pg-loading">جارٍ التحميل…</div></main>;

  const h = a.health ?? null;
  const sc = scoreAsset(h);
  const b = band(sc.score);
  const m = STATUS_META[h?.status] ?? STATUS_META.insufficient_data;
  const act = actionFor(h?.status);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <button type="button" className="crumb" onClick={() => router.push('/dashboard/green')}>
            ← المسطّحات الخضراء
          </button>
          <h1>{a.name || 'أصل بلا اسم'}</h1>
          <p>
            {a.kindAr ?? '—'} · حي {a.district ?? '—'}
            {a.street && <> · قرب {a.street}
              {a.streetM != null && <> (<span className="num">{fmt(a.streetM)}</span> م)</>}</>}
          </p>
        </div>
        <div className="head-score">
          <span className="num" style={{ color: b.color }}>{sc.score ?? '—'}</span>
          <small>{sc.notAssessable ? 'خارج نطاق التقييم' : 'درجة الأداء'}</small>
        </div>
      </header>

      <div className="pg-body">
        <div className="kpi-row">
          <div className="kpi"><span className="v num">{fmt(a.areaM2)}</span><span className="l">م² مساحة</span></div>
          <div className="kpi"><span className="v num">{a.widthM != null ? fmt(a.widthM, 1) : '—'}</span><span className="l">م عرض فعّال</span></div>
          <div className="kpi"><span className="v num">{fmt(h?.nObservations ?? 0)}</span><span className="l">رصداً صافياً</span></div>
          <div className="kpi"><span className="v num">{h?.ndviMedian != null ? fmt(h.ndviMedian, 2) : '—'}</span><span className="l">NDVI الوسيط</span></div>
          <div className="kpi"><span className="v num">{h?.ndmiMedian != null ? fmt(h.ndmiMedian, 2) : '—'}</span><span className="l">NDMI الوسيط</span></div>
          <div className="kpi">
            <span className="v num" style={{ color: m.color }}>{h?.priority ?? 0}</span>
            <span className="l">درجة الأولوية</span>
          </div>
        </div>

        <div className="card2">
          <div className="card2-h">
            <h2>الحالة والإجراء</h2>
            <span className="pill" style={{ color: m.color, borderColor: m.color }}>{m.ar}</span>
          </div>
          <div className="card2-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="kv"><span>سبب التصنيف</span><b>{h?.reasonAr ?? 'بانتظار التقييم'}</b></div>
            <div className="kv"><span>الإجراء المقترح</span><b>{h?.actionAr ?? act.ar}</b></div>
            <div className="kv"><span>يُتوقَّع أن يكون أخضر</span><b>{a.kind && ['pitch', 'court', 'playground', 'greenfield', 'cemetery'].includes(a.kind) ? 'لا — بحكم نوعه' : 'نعم'}</b></div>
            <div className="kv"><span>تاريخ التقييم</span><b className="num">{String(h?.assessedOn ?? '—').slice(0, 10)}</b></div>
            <div className="kv"><span>الإحداثيات</span>
              <b className="num">{a.centroid?.[1]?.toFixed(6)}, {a.centroid?.[0]?.toFixed(6)}</b></div>
            {a.geometryConfidence === 'low' && (
              <p className="card2-note">
                هذا الأصل مرسوم بتوسيع خط في الخريطة، فعرضه مُفترَض لا مقيس — يُقرأ حدّه
                على أنه تقريبي.
              </p>
            )}
          </div>
        </div>

        <div className="card2">
          <div className="card2-h">
            <h2>السلسلة الزمنية</h2>
            <div className="sortby">
              {WINDOWS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => setWin(k)} aria-pressed={win === k}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="card2-b">
            <Series points={points} keys={[
              { key: 'ndvi', color: '#50ff4a' },
              { key: 'ndmi', color: '#2fd8ef' },
            ]} />
            <div className="legend2">
              <span><i style={{ background: '#50ff4a' }} /> NDVI — الخضرة</span>
              <span><i style={{ background: '#2fd8ef' }} /> NDMI — رطوبة المظلة</span>
              <span className="c"><span className="num">{points.length}</span> رصداً في المدى</span>
            </div>
          </div>
        </div>

        <div className="card2">
          <div className="card2-h"><h2>الموقع</h2>
            <span className="c">صورة Sentinel-2 · حدود الأصل من OpenStreetMap</span></div>
          <AssetMap geometry={a.geometry} centroid={a.centroid} />
        </div>
      </div>
    </main>
  );
}
