'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { fmt, loadGreen, loadMeta, loadRain, loadTopSegments, loadWasteEvents, riskColor } from '@/lib/data';

// MapLibre touches window on import, so it must never be server-rendered
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => <div className="map-shell map-loading">جارٍ تحميل الخريطة…</div>,
});

export default function Dashboard() {
  const [meta, setMeta] = useState(null);
  const [top, setTop] = useState([]);
  const [waste, setWaste] = useState([]);
  const [rain, setRain] = useState(null);
  const [green, setGreen] = useState([]);
  const [mode, setMode] = useState('flood');
  const [loaded, setLoaded] = useState(false);

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

  const rows = hasDetections
    ? (mode === 'waste' ? waste : top).slice(0, 40).map((x) => ({
        id: x.greenUnitId ?? x.segmentUnitId,
        title: x.unit?.nameAr || x.greenUnitId || x.segmentUnitId,
        sub: mode === 'waste'
          ? `انحراف ${fmt(x.zRing, 1)}σ · ${fmt(x.daysSinceRain)} أيام بلا مطر`
          : `تغطية رصد ${fmt((x.observationCoverage ?? 0) * 100)}٪`,
        score: Math.round(((x.severityScore ?? x.riskScore) ?? 0) * 100),
      }))
    : green.slice(0, 40).map((g, i) => ({
        id: g.id,
        title: g.name || `أصل أخضر ${g.id}`,
        sub: `${fmt(g.area)} م² · حزام تماس مُعرَّف`,
        score: null,
        rank: i + 1,
      }));

  return (
    <main className="dash">
      {/* ── status strip ── */}
      <div className="dash-status">
        <div className="ds-left">
          <span className={`pulse ${hasDetections ? 'ok' : 'wait'}`} />
          <strong>
            {hasDetections ? 'الكشف نشط' : 'المرحلة ١ من ٢ — الأصول والأمطار جاهزة'}
          </strong>
          <span className="dim2">
            {hasDetections
              ? 'نتائج محسوبة من مؤشرات الأقمار الصناعية'
              : 'درجات المخاطر تنتظر تشغيل محرّك الأقمار الصناعية'}
          </span>
        </div>
        {meta?.generatedAt && (
          <span className="dim2">
            آخر تحديث <span className="num">{meta.generatedAt.slice(0, 10)}</span>
          </span>
        )}
      </div>

      {/* ── KPIs ── */}
      <section className="kpi-row">
        <Kpi v={loaded ? fmt(meta?.units?.green) : '—'} u="أصلاً أخضر" l="حدائق ومسطحات مُعرَّفة آلياً" />
        <Kpi variant="cyan" v={loaded ? fmt(meta?.units?.segment) : '—'} u="مقطع شارع" l={`${fmt(5272)} كم من الشبكة`} />
        <Kpi variant="warm" v={loaded ? fmt(rain?.events?.length) : '—'} u="حدثاً مطرياً" l={`منذ ${'2015'} — أساس التحقّق التاريخي`} />
        <Kpi
          variant="hot"
          v={loaded ? fmt(rain72, 1) : '—'}
          u="ملم خلال 72 ساعة"
          l={rain72 >= 1 ? 'حالة مطرية — وضع الغَرَق' : 'بلا مطر — وضع الهَدْر مفتوح'}
        />
      </section>

      {/* ── mode toggle ── */}
      <div className="dash-bar">
        <h2 className="dash-h2">
          {mode === 'flood' ? (
            <>الماء الذي <span className="g-cyan">يُحاصَر</span></>
          ) : (
            <>الماء الذي <span className="g-neon">يُهدَر</span></>
          )}
        </h2>
        <div className="seg-toggle" role="group" aria-label="وضع العرض">
          <button
            className={mode === 'waste' ? 'on' : ''}
            onClick={() => setMode('waste')}
            aria-pressed={mode === 'waste'}
          >
            ☂ بلا مطر — الهَدْر
          </button>
          <button
            className={mode === 'flood' ? 'on' : ''}
            onClick={() => setMode('flood')}
            aria-pressed={mode === 'flood'}
          >
            بعد المطر — الغَرَق
          </button>
        </div>
      </div>

      {/* ── main split ── */}
      <div className="split">
        <aside className="panel">
          <div className="panel-head">
            <h3>{hasDetections ? 'أولويات اليوم' : 'الأصول المرصودة'}</h3>
            <span className="dim2 num">{loaded ? rows.length : '…'}</span>
          </div>

          {!hasDetections && loaded && (
            <p className="panel-note">
              هذه قائمة الأصول الحقيقية المُستخرجة من الخريطة. تظهر أولويات المخاطر هنا
              بعد تشغيل محرّك الأقمار الصناعية.
            </p>
          )}

          <div className="list">
            {!loaded &&
              Array.from({ length: 6 }).map((_, i) => <div className="row skel" key={i} />)}

            {loaded &&
              rows.map((r) => (
                <div className="row" key={r.id}>
                  <span
                    className="bar"
                    style={{ background: r.score === null ? 'var(--dim-2)' : riskColor(r.score) }}
                  />
                  <div className="row-main">
                    <div className="row-title">{r.title}</div>
                    <div className="row-sub">{r.sub}</div>
                  </div>
                  {r.score === null ? (
                    <span className="row-rank num">{r.rank}</span>
                  ) : (
                    <span className="row-score num" style={{ color: riskColor(r.score) }}>
                      {r.score}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </aside>

        <MapView mode={mode} scored={hasDetections} />
      </div>

      {/* ── rain strip ── */}
      {loaded && rain?.events?.length > 0 && (
        <section className="rain-strip">
          <div className="rs-head">
            <h3>أكبر الأحداث المطرية المرصودة</h3>
            <span className="dim2">
              {lastRain
                ? <>آخر مطر مُسجّل <span className="num">{String(lastRain.date).slice(0, 10)}</span></>
                : 'لا مطر في آخر 120 يوماً'}
            </span>
          </div>
          <div className="rs-items">
            {[...rain.events]
              .sort((a, b) => b.totalMm - a.totalMm)
              .slice(0, 6)
              .map((e) => (
                <div className="rs-item" key={e.rainEventId}>
                  <div className="rs-mm num">{fmt(e.totalMm, 1)}<small>ملم</small></div>
                  <div className="rs-date num">{String(e.peakDate).slice(0, 10)}</div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ── honesty ── */}
      <div className="note">
        <span className="badge">بصراحة</span>
        <div>
          دورة إعادة الزيارة <b>أيام</b>، والسيل الومضي <b>ساعات</b>. القمر الصناعي ليس نظام
          إنذار لحظي — وظيفته بناء <b>خريطة القابلية</b> و<b>التحقّق بعد الحدث</b>. الإنذار
          اللحظي يأتي من <b>تنبّؤ الطقس</b> مضروباً في تلك الخريطة. هذا التقسيم مقصود، لا قصور.
        </div>
      </div>
    </main>
  );
}

function Kpi({ v, u, l, variant }) {
  return (
    <div className={`kpi${variant ? ` ${variant}` : ''}`}>
      <div className="v">{v}</div>
      <div className="u">{u}</div>
      <div className="l">{l}</div>
    </div>
  );
}
