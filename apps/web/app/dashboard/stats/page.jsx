'use client';

import { useEffect, useMemo, useState } from 'react';
import FilterBar from '@/components/FilterBar';
import { fmt, loadDistricts, loadMeta, loadRain } from '@/lib/data';
import { inWindow, useFilters } from '@/lib/useFilters';

/**
 * The numbers behind the map.
 *
 * Everything here respects the same URL filters the map does, and the export
 * writes exactly what is on screen — an export that quietly ignores the active
 * filters is worse than no export, because the recipient cannot tell.
 */
export default function Stats() {
  const { filters, update, clear, active } = useFilters();
  const [districts, setDistricts] = useState([]);
  const [rain, setRain] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState('seg');

  useEffect(() => {
    Promise.all([loadDistricts(), loadRain(), loadMeta()]).then(([d, r, m]) => {
      setDistricts((d?.features ?? []).map((f) => f.properties));
      setRain(r);
      setMeta(m);
    });
  }, []);

  const rows = useMemo(() => {
    const list = filters.district
      ? districts.filter((d) => d.name === filters.district)
      : districts;
    return [...list]
      .map((d) => ({ ...d, density: d.km2 > 0 ? d.seg / d.km2 : 0 }))
      .sort((a, b) => (sort === 'name' ? String(a.name).localeCompare(b.name, 'ar') : b[sort] - a[sort]));
  }, [districts, filters.district, sort]);

  const events = useMemo(
    () => (rain?.events ?? []).filter((e) => inWindow(e.peakDate, filters)),
    [rain, filters],
  );

  const totals = useMemo(() => ({
    districts: rows.length,
    seg: rows.reduce((a, d) => a + d.seg, 0),
    green: rows.reduce((a, d) => a + d.green, 0),
    km2: rows.reduce((a, d) => a + d.km2, 0),
    rain: events.reduce((a, e) => a + e.totalMm, 0),
  }), [rows, events]);

  async function download() {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        rows.map((d) => ({
          'الحي': d.name,
          'مقاطع الشوارع': d.seg,
          'الأصول الخضراء': d.green,
          'المساحة (كم²)': d.km2,
          'كثافة المقاطع (لكل كم²)': Number(d.density.toFixed(1)),
          'مصدر الحدود': d.derived ? 'مشتقّ (Voronoi) — ليس رسمياً' : 'رسمي',
        })),
      ), 'الأحياء');

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        events.map((e) => ({
          'المعرّف': e.rainEventId,
          'البداية': String(e.startDate).slice(0, 10),
          'الذروة': String(e.peakDate).slice(0, 10),
          'النهاية': String(e.endDate).slice(0, 10),
          'الإجمالي (ملم)': e.totalMm,
          'أعلى يوم (ملم)': e.maxDailyMm,
        })),
      ), 'الأحداث المطرية');

      // A sheet stating what the workbook is and is not. A spreadsheet outlives
      // the screen it was exported from, and by then nobody remembers which
      // filters were on or that the boundaries were derived.
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['مِطياف — تصدير بيانات'],
        [],
        ['تاريخ التصدير', new Date().toISOString().slice(0, 10)],
        ['آخر تحديث للبيانات', meta?.generatedAt?.slice(0, 10) ?? '—'],
        [],
        ['المرشّحات المطبَّقة'],
        ['الحي', filters.district ?? 'كل الأحياء'],
        ['من تاريخ', filters.from ?? 'بلا حد'],
        ['إلى تاريخ', filters.to ?? 'بلا حد'],
        [],
        ['ملاحظات'],
        ['حدود الأحياء مشتقّة من نقاط مراكزها (Voronoi) وليست حدوداً رسمية.'],
        ['درجات الأولوية تظهر بعد تشغيل محرّك الأقمار الصناعية؛ الأعداد أدناه جرد فعلي.'],
        ['المصادر: OpenStreetMap (ODbL) · Copernicus Sentinel · Open-Meteo (CC BY 4.0)'],
      ]), 'عن هذا الملف');

      const tag = [filters.district, filters.from, filters.to].filter(Boolean).join('_') || 'all';
      XLSX.writeFile(wb, `mityaf_${tag}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  const maxMm = Math.max(1, ...events.map((e) => e.totalMm));

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>الإحصاءات</h1>
          <p>
            {filters.district ? <>حي {filters.district}</> : 'كل الأحياء'} ·{' '}
            <span className="num">{fmt(totals.seg)}</span> مقطع ·{' '}
            <span className="num">{fmt(events.length)}</span> حدث مطري في المدى
          </p>
        </div>
      </header>

      <div className="pg-body">
        <FilterBar
          filters={filters}
          update={update}
          clear={clear}
          active={active}
          extra={(
            <button type="button" className="dl-btn inline" onClick={download}
                    disabled={busy || !rows.length}>
              {busy ? 'جارٍ التحضير…' : '⤓ تنزيل Excel'}
            </button>
          )}
        />
        <div className="stat-cards">
          <Card v={fmt(totals.districts)} l="حيّاً" />
          <Card v={fmt(totals.seg)} l="مقطع شارع" c="var(--lp-water)" />
          <Card v={fmt(totals.green)} l="أصلاً أخضر" c="var(--lp-signal)" />
          <Card v={fmt(totals.km2, 1)} l="كم² مساحة" />
          <Card v={fmt(totals.rain, 1)} l="ملم مطر في المدى" c="var(--sev-1)" />
        </div>

        <section className="stat-block">
          <div className="stat-h">
            <h2>الأحداث المطرية</h2>
            <span className="c num">{events.length}</span>
          </div>
          {events.length ? (
            <svg className="spark" viewBox={`0 0 ${Math.max(events.length * 14, 100)} 120`} preserveAspectRatio="none">
              {[...events]
                .sort((a, b) => String(a.peakDate).localeCompare(String(b.peakDate)))
                .map((e, i) => {
                  const h = (e.totalMm / maxMm) * 96;
                  return (
                    <rect
                      key={e.rainEventId} x={i * 14 + 3} y={108 - h} width="9" height={h}
                      rx="2" fill={e.totalMm > 25 ? 'var(--sev-2)' : 'var(--lp-water)'}
                    >
                      <title>{`${String(e.peakDate).slice(0, 10)} — ${e.totalMm} ملم`}</title>
                    </rect>
                  );
                })}
            </svg>
          ) : (
            <p className="stat-empty">لا أحداث مطرية داخل المدى المحدَّد.</p>
          )}
        </section>

        <section className="stat-block">
          <div className="stat-h">
            <h2>الأحياء</h2>
            <div className="sortby">
              {[['seg', 'المقاطع'], ['green', 'الأصول'], ['density', 'الكثافة'], ['name', 'الاسم']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k}>{l}</button>
              ))}
            </div>
          </div>
          <div className="tbl-scroll">
            <table className="stbl">
              <thead>
                <tr>
                  <th>الحي</th><th>مقاطع الشوارع</th><th>أصول خضراء</th>
                  <th>المساحة كم²</th><th>الكثافة /كم²</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="k">{d.name}</td>
                    <td className="num">{fmt(d.seg)}</td>
                    <td className="num">{fmt(d.green)}</td>
                    <td className="num">{fmt(d.km2, 2)}</td>
                    <td className="num">{fmt(d.density, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="stat-foot">
            حدود الأحياء مشتقّة من نقاط مراكزها ولا تمثّل حدوداً رسمية — تختلف عند التماس بين حيّين.
          </p>
        </section>

        <p className="dnote">
          يُصدَّر ما هو معروض الآن بالضبط، مع ورقة تُوثّق المرشّحات المطبَّقة وحدود البيانات —
          فالملف يعيش أطول من الشاشة التي خرج منها.
        </p>
      </div>
    </main>
  );
}

function Card({ v, l, c }) {
  return (
    <div className="stat-card">
      <div className="v num" style={c ? { color: c } : undefined}>{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}
