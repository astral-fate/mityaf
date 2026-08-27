'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import './dashboard.css';
import DropZone from '@/components/DropZone';
import {
  fmt, loadGreen, loadMeta, loadRain, loadTopSegments, loadWasteEvents, riskColor,
} from '@/lib/data';

// MapLibre touches window on import, so it must never be server-rendered
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => <div className="map-chip">جارٍ تحميل الخريطة…</div>,
});

const LAYER_CHIPS = [
  { key: 'satellite', label: 'صورة القمر', color: '#c39a6d' },
  { key: 'risk', label: 'مقاطع الشوارع', color: '#4FB3D9' },
  { key: 'green', label: 'المسطّحات', color: '#3FD46E' },
  { key: 'rings', label: 'أحزمة التماس', color: '#00C4D5' },
];

export default function Dashboard() {
  const [meta, setMeta] = useState(null);
  const [top, setTop] = useState([]);
  const [waste, setWaste] = useState([]);
  const [rain, setRain] = useState(null);
  const [green, setGreen] = useState([]);
  const [mode, setMode] = useState('flood');
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState(null);
  const [layers, setLayers] = useState({
    satellite: true, risk: true, green: true, rings: true,
  });
  const [userLayers, setUserLayers] = useState([]);
  const [fitTo, setFitTo] = useState(null);

  const addLayer = (l) => {
    setUserLayers((s) => [...s, l]);
    if (l.bbox) setFitTo(l.bbox);
  };
  const patchLayer = (id, patch) =>
    setUserLayers((s) => s.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const dropLayer = (id) => setUserLayers((s) => s.filter((l) => l.id !== id));

  useEffect(() => {
    (async () => {
      const [m, t, w, r, g] = await Promise.all([
        loadMeta(), loadTopSegments(), loadWasteEvents(), loadRain(), loadGreen(),
      ]);
      setMeta(m);
      setTop(t?.items ?? []);
      setWaste(w?.items ?? []);
      setRain(r);
      setGreen(
        (g?.features ?? [])
          .filter((f) => f.properties?.t === 'green')
          .map((f) => f.properties)
          .sort((a, b) => (b.area ?? 0) - (a.area ?? 0)),
      );
      setLoaded(true);
    })();
  }, []);

  const rain72 = useMemo(() => {
    const recent = rain?.recent ?? [];
    return recent.slice(-3).reduce((a, d) => a + (d.precipitationSumMm ?? 0), 0);
  }, [rain]);

  const lastRain = useMemo(() => {
    const wet = (rain?.recent ?? []).filter((d) => (d.precipitationSumMm ?? 0) >= 0.5);
    return wet.length ? wet[wet.length - 1] : null;
  }, [rain]);

  // Detections require the Earth Engine run. Until then we show the real
  // inventory rather than an empty screen — clearly labelled as inventory.
  const hasDetections = top.length > 0 || waste.length > 0;
  const wet = rain72 >= 1;

  const rows = hasDetections
    ? (mode === 'waste' ? waste : top).slice(0, 60).map((x) => ({
        id: x.greenUnitId ?? x.segmentUnitId,
        title: x.unit?.nameAr || x.greenUnitId || x.segmentUnitId,
        sub: mode === 'waste'
          ? `انحراف ${fmt(x.zRing, 1)}σ · ${fmt(x.daysSinceRain)} أيام بلا مطر`
          : `تغطية رصد ${fmt((x.observationCoverage ?? 0) * 100)}٪`,
        score: Math.round(((x.severityScore ?? x.riskScore) ?? 0) * 100),
      }))
    : green.slice(0, 60).map((g, i) => ({
        id: g.id,
        title: g.name || `أصل أخضر ${g.id}`,
        sub: `${fmt(g.area)} م² · حزام تماس مُعرَّف`,
        score: null,
        rank: i + 1,
      }));

  const toggle = (k) => setLayers((s) => ({ ...s, [k]: !s[k] }));

  return (
    <main className="dash">
      {/* ── the dispatch panel ─────────────────────────────── */}
      <aside className="dash-side">
        {/* the discriminator, as the primary control */}
        <div className="dash-modes" role="group" aria-label="شرط المطر">
          <button
            type="button"
            className="dash-mode waste"
            aria-pressed={mode === 'waste'}
            onClick={() => setMode('waste')}
          >
            الهَدْر
            <small>ماء بلا مطر</small>
          </button>
          <button
            type="button"
            className="dash-mode flood"
            aria-pressed={mode === 'flood'}
            onClick={() => setMode('flood')}
          >
            الغَرَق
            <small>ماء بعد مطر</small>
          </button>
        </div>

        {/* summary for the active mode */}
        <div className="dcard">
          <div className="dcard-h">
            <span>{mode === 'waste' ? 'وحدة الهَدْر' : 'وحدة الغَرَق'}</span>
            <span className="c">
              {meta?.generatedAt ? `تحديث ${meta.generatedAt.slice(0, 10)}` : '—'}
            </span>
          </div>
          <div className="dmetrics">
            <div className="dmetric gn">
              <div className="v num">{loaded ? fmt(meta?.units?.green) : '—'}</div>
              <div className="u">أصل أخضر</div>
              <div className="l">حدائق ومسطّحات مُعرَّفة آلياً</div>
            </div>
            <div className="dmetric cy">
              <div className="v num">{loaded ? fmt(meta?.units?.segment) : '—'}</div>
              <div className="u">مقطع شارع</div>
              <div className="l">{fmt(meta?.networkKm ?? 5280)} كم من الشبكة</div>
            </div>
            <div className="dmetric">
              <div className="v num">{loaded ? fmt(rain?.events?.length) : '—'}</div>
              <div className="u">حدث مطري</div>
              <div className="l">منذ ٢٠١٥ — أساس التحقّق التاريخي</div>
            </div>
            <div className={`dmetric${wet ? ' hot' : ''}`}>
              <div className="v num">{loaded ? fmt(rain72, 1) : '—'}</div>
              <div className="u">ملم خلال ٧٢ ساعة</div>
              <div className="l">
                {lastRain
                  ? <>آخر مطر <span className="num">{String(lastRain.date).slice(0, 10)}</span></>
                  : 'لا مطر في آخر ١٢٠ يوماً'}
              </div>
            </div>
          </div>
        </div>

        {/* what the operator should actually do */}
        <div className={`dadvisory${wet ? '' : ' calm'}`}>
          <div className="dadvisory-h">
            {wet ? '● حالة مطرية — وضع الغَرَق' : '● بلا مطر — بوابة الهَدْر مفتوحة'}
          </div>
          <div className="dadvisory-b">
            {wet ? (
              <>
                هطل <b className="num">{fmt(rain72, 1)}</b> ملم خلال ٧٢ ساعة. الماء الظاهر على
                الأسفلت الآن يُقرأ <b>ضعف تصريف</b>، لا هدر ريّ. المقاطع التي يبقى ماؤها بعد
                ٤٨ ساعة هي المرشّحة للفحص الميداني.
              </>
            ) : (
              <>
                لا هطول معتبر خلال ٧٢ ساعة، فأي ماء على حزام التماس الآن لا يُفسَّر بالمطر —
                يُقرأ <b>ريّاً مفرطاً أو تسرّباً</b>. هذه أفضل نافذة لرصد الهدر، ولأن{' '}
                <b className="num">٢٫٣٪</b> فقط من أيام المدينة ممطرة فهي مفتوحة في كل مرور تقريباً.
              </>
            )}
          </div>
        </div>

        {/* the Amanah's own layers, dropped straight in */}
        <DropZone onAdd={addLayer} />

        {userLayers.length > 0 && (
          <div className="dcard">
            <div className="dcard-h">
              <span>الطبقات المستوردة</span>
              <span className="c num">{userLayers.length}</span>
            </div>
            {userLayers.map((l) => (
              <div className="ulayer" key={l.id}>
                <div className="ulayer-top">
                  <span className="ulayer-sw" style={{ background: l.color }} />
                  <span className="ulayer-nm" title={l.name}>{l.name}</span>
                  <button
                    type="button" className="ulayer-btn"
                    onClick={() => patchLayer(l.id, { visible: !l.visible })}
                    aria-label={l.visible ? 'إخفاء' : 'إظهار'}
                  >
                    {l.visible ? '◉' : '○'}
                  </button>
                  <button
                    type="button" className="ulayer-btn"
                    onClick={() => l.bbox && setFitTo([...l.bbox])}
                    aria-label="تكبير إلى الطبقة"
                  >
                    ⌖
                  </button>
                  <button
                    type="button" className="ulayer-btn"
                    onClick={() => dropLayer(l.id)} aria-label="إزالة"
                  >
                    ×
                  </button>
                </div>
                <div className="ulayer-meta">
                  {l.detail} · <span className="num">{l.sizeMb.toFixed(1)}</span> ميغابايت
                </div>
                <input
                  type="range" min="0.1" max="1" step="0.05" value={l.opacity}
                  aria-label={`شفافية ${l.name}`}
                  onChange={(e) => patchLayer(l.id, { opacity: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
        )}

        {/* priority list */}
        <div className="dcard">
          <div className="dcard-h">
            <span>{hasDetections ? 'أولويات اليوم' : 'الأصول المرصودة'}</span>
            <span className="c num">{loaded ? rows.length : '…'}</span>
          </div>
          {!hasDetections && loaded && (
            <p className="dadvisory-b" style={{ paddingBottom: 0 }}>
              هذه الأصول الحقيقية المُستخرجة من الخريطة. تظهر درجات الأولوية بعد تشغيل محرّك
              الأقمار الصناعية.
            </p>
          )}
          <div className="dlist">
            {!loaded && Array.from({ length: 7 }).map((_, i) => <div className="dskel" key={i} />)}
            {loaded && rows.map((r) => (
              <button
                type="button"
                className="drow"
                key={r.id}
                aria-selected={sel?.id === r.id}
                onClick={() => setSel({
                  id: r.id, name: r.title, score: r.score, sub: r.sub,
                  kind: hasDetections && mode === 'waste' ? 'green' : 'segment',
                })}
              >
                <i style={{ background: r.score === null ? 'var(--lp-fg-3)' : riskColor(r.score) }} />
                <span>
                  <div className="t">{r.title}</div>
                  <div className="s">{r.sub}</div>
                </span>
                <span
                  className="v num"
                  style={{ color: r.score === null ? 'var(--lp-fg-3)' : riskColor(r.score) }}
                >
                  {r.score === null ? r.rank : r.score}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* rain history rail */}
        {loaded && rain?.events?.length > 0 && (
          <div className="dcard">
            <div className="dcard-h">
              <span>أكبر الأحداث المطرية</span>
              <span className="c num">{rain.events.length}</span>
            </div>
            <div className="drain">
              {[...rain.events].sort((a, b) => b.totalMm - a.totalMm).slice(0, 8).map((e) => (
                <div className="drain-i" key={e.rainEventId}>
                  <div className="mm num">{fmt(e.totalMm, 1)}<small>ملم</small></div>
                  <div className="dt">{String(e.peakDate).slice(0, 10)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="dnote">
          دورة إعادة الزيارة <b>أيام</b> والسيل الومضي <b>ساعات</b> — فالقمر ليس نظام إنذار
          لحظي. وظيفته خريطة القابلية والتحقّق بعد الحدث؛ الإنذار اللحظي من تنبّؤ الطقس مضروباً
          في تلك الخريطة.
        </p>
      </aside>

      {/* ── the map ────────────────────────────────────────── */}
      <div className="dash-map">
        <MapView
          mode={mode}
          scored={hasDetections}
          layers={layers}
          userLayers={userLayers}
          fitTo={fitTo}
          onSelect={setSel}
        />

        <div className="map-topbar">
          <span className="map-pill">
            <i className={`dot ${hasDetections ? 'ok' : 'wait'}`} />
            {hasDetections ? 'الكشف نشط' : 'المرحلة ١ من ٢ — الأصول والأمطار جاهزة'}
          </span>
          {LAYER_CHIPS.map((c) => (
            <button
              type="button"
              key={c.key}
              className="chip"
              aria-pressed={layers[c.key]}
              onClick={() => toggle(c.key)}
              style={layers[c.key] ? { color: c.color } : undefined}
            >
              <i style={{ background: c.color }} />
              {c.label}
            </button>
          ))}
        </div>

        {sel && (
          <div className="dsel">
            <div className="dsel-h">
              <span>{sel.name || sel.id || '—'}</span>
              <button type="button" className="dsel-x" onClick={() => setSel(null)} aria-label="إغلاق">
                ×
              </button>
            </div>
            <div className="dsel-b">
              <div className="r">
                <span>النوع</span>
                <b>{sel.kind === 'green' ? 'مسطّح أخضر' : 'مقطع شارع'}</b>
              </div>
              {sel.score !== null && sel.score !== undefined && (
                <div className="r">
                  <span>درجة الأولوية</span>
                  <b className="num" style={{ color: riskColor(sel.score) }}>{sel.score}</b>
                </div>
              )}
              {sel.area ? (
                <div className="r"><span>المساحة</span><b><span className="num">{fmt(sel.area)}</span> م²</b></div>
              ) : null}
              {sel.sub && <div className="r"><span>ملاحظة</span><b>{sel.sub}</b></div>}
              {(sel.score === null || sel.score === undefined) && (
                <div className="r">
                  <span>الحالة</span>
                  <b style={{ color: 'var(--lp-fg-3)' }}>لم تُحتسب درجة بعد</b>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
