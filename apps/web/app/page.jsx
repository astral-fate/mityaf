'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  fmt,
  loadMeta,
  loadRain,
  loadTopSegments,
  loadWasteEvents,
  riskColor,
  riskLabelAr,
} from '@/lib/data';

// MapLibre touches window on import, so it must never be server-rendered
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => <div className="map-shell" style={{ height: '100%', minHeight: 420 }} />,
});

export default function Dashboard() {
  const [meta, setMeta] = useState(null);
  const [top, setTop] = useState([]);
  const [waste, setWaste] = useState([]);
  const [rain, setRain] = useState(null);
  const [mode, setMode] = useState('flood'); // 'flood' | 'waste'
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [m, t, w, r] = await Promise.all([
        loadMeta(),
        loadTopSegments(),
        loadWasteEvents(),
        loadRain(),
      ]);
      setMeta(m);
      setTop(t?.items ?? []);
      setWaste(w?.items ?? []);
      setRain(r);
      setLoaded(true);
    })();
  }, []);

  const forecastMm = useMemo(() => {
    const recent = rain?.recent ?? [];
    return recent.slice(-3).reduce((a, d) => a + (d.precipitationSumMm ?? 0), 0);
  }, [rain]);

  const highRisk = top.filter((s) => (s.riskScore ?? 0) >= 0.55).length;
  const activeWaste = waste.filter((w) => w.status !== 'resolved').length;

  const items =
    mode === 'waste'
      ? waste.slice(0, 40).map((w) => ({
          id: w.greenUnitId,
          title: w.unit?.nameAr || w.greenUnitId,
          sub: `انحراف ${fmt(w.zRing, 1)}σ · ${fmt(w.daysSinceRain)} أيام بلا مطر`,
          score: Math.round((w.severityScore ?? 0) * 100),
        }))
      : top.slice(0, 40).map((s) => ({
          id: s.segmentUnitId,
          title: s.unit?.nameAr || s.segmentUnitId,
          sub: `${riskLabelAr(s.riskBand)} · تغطية رصد ${fmt((s.observationCoverage ?? 0) * 100)}٪`,
          score: Math.round((s.riskScore ?? 0) * 100),
        }));

  const empty = loaded && items.length === 0;

  return (
    <main className="page">
      {/* ── KPI row ── */}
      <section className="kpi-row">
        <Kpi
          value={loaded ? fmt(activeWaste) : '—'}
          unit="مخالفة ريّ نشطة"
          label="ماء على الأسفلت في أيام بلا مطر"
        />
        <Kpi
          variant="cyan"
          value={loaded ? fmt(highRisk) : '—'}
          unit="شارعاً عالي المخاطر"
          label={`من ${fmt(meta?.units?.segment)} مقطعاً مرصوداً`}
        />
        <Kpi
          variant="warm"
          value={loaded ? fmt(meta?.units?.green) : '—'}
          unit="أصلاً أخضر"
          label={`و${fmt(meta?.units?.ring)} حزام تماس تحت الرصد`}
        />
        <Kpi
          variant="hot"
          value={loaded ? fmt(forecastMm, 1) : '—'}
          unit="ملم خلال 72 ساعة"
          label={forecastMm >= 1 ? 'حالة مطرية — وضع الغَرَق' : 'لا مطر — وضع الهَدْر'}
        />
      </section>

      {/* ── the discriminator, as a physical control ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h2>
          {mode === 'flood' ? (
            <>الماء الذي <span style={{ color: 'var(--cyan)' }}>يُحاصَر</span></>
          ) : (
            <>الماء الذي <span style={{ color: 'var(--neon)' }}>يُهدَر</span></>
          )}
        </h2>
        <div style={{ display: 'flex', gap: 6, marginInlineStart: 'auto' }}>
          <Toggle active={mode === 'waste'} onClick={() => setMode('waste')}>
            ☂ بلا مطر — الهَدْر
          </Toggle>
          <Toggle active={mode === 'flood'} onClick={() => setMode('flood')}>
            بعد المطر — الغَرَق
          </Toggle>
        </div>
      </div>

      <div className="split">
        {/* ── priority list ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3>أولويات اليوم</h3>
            <span className="dim2" style={{ fontSize: 12 }}>
              {loaded ? `${fmt(items.length)} عنصراً` : '…'}
            </span>
          </div>

          {empty ? (
            <div className="note">
              <span className="badge">لا بيانات</span>
              <div>
                لم تُبنَ نتائج الكشف بعد. شغّل <b>npm run pipeline:all</b> لتوليد
                الأصول والأمطار ومؤشرات الأقمار الصناعية، ثم <b>pipeline:export</b>.
              </div>
            </div>
          ) : (
            <div className="list">
              {items.map((it) => (
                <div key={it.id} className="row">
                  <span className="bar" style={{ background: riskColor(it.score) }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.title}
                    </div>
                    <div className="dim2" style={{ fontSize: 12, marginTop: 2 }}>{it.sub}</div>
                  </div>
                  <span className="score" style={{ color: riskColor(it.score) }}>{it.score}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── map ── */}
        <MapView mode={mode} />
      </div>

      {/* ── the limitation that must never be hidden ── */}
      <div className="note">
        <span className="badge">بصراحة</span>
        <div>
          دورة إعادة الزيارة <b>أيام</b>، والسيل الومضي <b>ساعات</b>. القمر الصناعي ليس نظام
          إنذار لحظي — وظيفته بناء <b>خريطة القابلية</b> و<b>التحقّق بعد الحدث</b>. الإنذار
          اللحظي يأتي من <b>تنبّؤ الطقس</b> مضروباً في تلك الخريطة. هذا التقسيم مقصود، لا قصور.
          {meta?.generatedAt && (
            <>
              {' '}آخر تحديث للبيانات:{' '}
              <span className="num">{new Date(meta.generatedAt).toISOString().slice(0, 10)}</span>.
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Kpi({ value, unit, label, variant }) {
  return (
    <div className={`kpi${variant ? ` ${variant}` : ''}`}>
      <div className="v">{value}</div>
      <div className="u">{unit}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function Toggle({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`tag${active ? '' : ' mute'}`}
      style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: '6px 14px' }}
    >
      {children}
    </button>
  );
}
