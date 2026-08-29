'use client';

import { useEffect, useMemo, useState } from 'react';
import FilterBar from '@/components/FilterBar';
import { fmt, loadIncidents, loadRain } from '@/lib/data';
import { MECHANISMS } from '@/lib/mechanisms';
import { inWindow, useFilters } from '@/lib/useFilters';

/**
 * The rain archive.
 *
 * These events are not background colour — they are the labels. Every
 * before/after verification and every ponding detection is anchored to one of
 * these dates, so being able to find and inspect them is part of the product.
 *
 * The previous version was three totals and a flat table, which showed that
 * storms exist and nothing else. The question an operator actually has is «what
 * happened during this one», so each storm now carries the ponding reports that
 * fall inside its window, the timeline is clickable, and choosing a storm opens
 * what was recorded and where.
 *
 * The join runs two days past the storm's end: a street is reported after the
 * water is seen, not while the cloud is overhead. It is also deliberately
 * honest — most storms come back with nothing, and that emptiness is the
 * under-reporting the project exists to answer, so it is stated rather than
 * hidden behind a blank panel.
 */

const REPORT_LAG_DAYS = 2;
const day = (x) => String(x ?? '').slice(0, 10);
const addDays = (iso, n) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 864e5)
    .toISOString().slice(0, 10);

export default function Rain() {
  const { filters, update, clear, active } = useFilters();
  const [rain, setRain] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    Promise.all([loadRain(), loadIncidents()]).then(([r, i]) => {
      setRain(r);
      setIncidents(i?.items ?? []);
      setLoaded(true);
    });
  }, []);

  // Presets count back from the newest storm on record, not from today: the
  // archive ends months before the wall clock, so a today-anchored window
  // selects nothing at all.
  const anchor = useMemo(
    () => (rain?.events ?? []).reduce(
      (a, e) => (day(e.peakDate) > a ? day(e.peakDate) : a), '') || null,
    [rain],
  );

  // Each storm carries the reports inside its window, so the timeline, the
  // table and the detail panel all read from one joined shape.
  const events = useMemo(() => {
    const all = (rain?.events ?? []).map((e) => {
      const from = day(e.startDate);
      const to = addDays(day(e.endDate), REPORT_LAG_DAYS);
      const linked = incidents.filter((i) => {
        const d = day(i.date);
        return d >= from && d <= to;
      });
      const districts = [...new Set(
        linked.map((i) => i.district).filter((d) => d && d !== '—'),
      )];
      return {
        ...e,
        pk: day(e.peakDate),
        days: Math.max(1, Math.round(
          (new Date(day(e.endDate)) - new Date(from)) / 864e5) + 1),
        linked,
        districts,
        corroborated: linked.filter((i) => i.corroborated).length,
      };
    });
    return all
      .filter((e) => inWindow(e.peakDate, filters))
      .filter((e) => !filters.district || e.districts.includes(filters.district))
      .sort((a, b) => (a.pk < b.pk ? 1 : -1));
  }, [rain, incidents, filters]);

  const stats = useMemo(() => {
    if (!events.length) {
      return { total: 0, max: 0, biggest: null, withReports: 0, reports: 0 };
    }
    const biggest = events.reduce((a, b) => (b.totalMm > a.totalMm ? b : a));
    return {
      total: events.reduce((a, e) => a + e.totalMm, 0),
      max: biggest.totalMm,
      biggest,
      withReports: events.filter((e) => e.linked.length).length,
      reports: events.reduce((a, e) => a + e.linked.length, 0),
    };
  }, [events]);

  // «Which districts does the archive cover» is a range-level question, not a
  // per-storm one, so it is tallied across everything currently in view.
  const coverage = useMemo(() => {
    const t = new Map();
    for (const e of events) {
      for (const i of e.linked) {
        const d = i.district && i.district !== '—' ? i.district : 'غير محدَّد';
        const cur = t.get(d) ?? { n: 0, corr: 0 };
        cur.n += 1;
        if (i.corroborated) cur.corr += 1;
        t.set(d, cur);
      }
    }
    return [...t.entries()].map(([k, v]) => ({ d: k, ...v }))
      .sort((a, b) => b.n - a.n);
  }, [events]);

  const maxMm = Math.max(1, ...events.map((e) => e.totalMm));
  const chosen = sel ? events.find((e) => e.rainEventId === sel) : null;

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>أرشيف الهطول</h1>
          <p>{fmt(events.length)} حدثاً مطرياً · اختر حدثاً لعرض ما رُصد خلاله</p>
        </div>
      </header>

      <div className="pg-body">
        <FilterBar filters={filters} update={update} clear={clear} active={active}
                   anchor={anchor} />

        <div className="ov-grid">
          <div className="ov-tile as-stat">
            <div className="v num">{fmt(events.length)}</div>
            <div className="k">حدثاً في المدى</div>
          </div>
          <div className="ov-tile as-stat">
            <div className="v num" style={{ color: 'var(--lp-water)' }}>
              {fmt(stats.total, 1)}
            </div>
            <div className="k">ملم مجموع الهطول</div>
          </div>
          <div className="ov-tile as-stat">
            <div className="v num" style={{ color: 'var(--sev-2)' }}>
              {fmt(stats.max, 1)}
            </div>
            <div className="k">ملم أكبر حدث</div>
            <div className="s num">{stats.biggest ? stats.biggest.pk : '—'}</div>
          </div>
          <div className="ov-tile as-stat">
            <div className="v num" style={{ color: 'var(--lp-signal)' }}>
              {fmt(stats.withReports)}
            </div>
            <div className="k">حدثاً رافقه بلاغ</div>
            <div className="s">
              من {fmt(events.length)} · {fmt(stats.reports)} بلاغاً
            </div>
          </div>
        </div>

        {/* ── timeline: one bar per storm, click to inspect ── */}
        <div className="card2">
          <div className="card2-h">
            <h2>الخطّ الزمني للأحداث</h2>
            <span className="c">الارتفاع = مجموع الهطول</span>
          </div>
          <div className="card2-b">
            {events.length ? (
              <>
                <div className="rain-tl">
                  {[...events].reverse().map((e) => {
                    const on = e.rainEventId === sel;
                    const has = e.linked.length > 0;
                    return (
                      <button
                        key={e.rainEventId}
                        type="button"
                        className={`rain-bar${on ? ' on' : ''}${has ? ' has' : ''}`}
                        style={{ '--h': `${Math.max(6, (e.totalMm / maxMm) * 100)}%` }}
                        onClick={() => setSel(on ? null : e.rainEventId)}
                        title={`${e.pk} · ${e.totalMm} ملم · ${e.linked.length} بلاغاً`}
                        aria-pressed={on}
                        aria-label={`حدث ${e.pk}، ${e.totalMm} ملم، ${e.linked.length} بلاغاً`}
                      >
                        <span className="rb-fill" />
                      </button>
                    );
                  })}
                </div>
                <p className="rain-legend">
                  <span><i className="has" /> رافقه بلاغ مؤرَّخ</span>
                  <span><i /> بلا بلاغ مسجَّل</span>
                  <span className="num" dir="ltr">
                    {events[events.length - 1]?.pk} → {events[0]?.pk}
                  </span>
                </p>
              </>
            ) : (
              <p className="card2-note">لا أحداث داخل المدى المحدَّد.</p>
            )}
          </div>
        </div>

        {/* ── the chosen storm ── */}
        {chosen && (
          <div className="card2">
            <div className="card2-h">
              <h2>حدث <span className="num" dir="ltr">{chosen.pk}</span></h2>
              <button type="button" className="crumb" onClick={() => setSel(null)}>
                إغلاق ✕
              </button>
            </div>
            <div className="card2-b">
              <div className="kpi-row">
                <div className="kpi">
                  <span className="v num">{fmt(chosen.totalMm, 1)}</span>
                  <span className="l">ملم مجموع الحدث</span>
                </div>
                <div className="kpi">
                  <span className="v num">{fmt(chosen.maxDailyMm, 1)}</span>
                  <span className="l">ملم أعلى يوم</span>
                </div>
                <div className="kpi">
                  <span className="v num">{chosen.days}</span>
                  <span className="l">أيام الحدث</span>
                </div>
                <div className="kpi">
                  <span className="v num">{chosen.linked.length}</span>
                  <span className="l">بلاغاً مرتبطاً</span>
                </div>
                <div className="kpi">
                  <span className="v num">{chosen.corroborated}</span>
                  <span className="l">منها مؤكَّد بمصدرين</span>
                </div>
              </div>

              {chosen.linked.length ? (
                <div className="tbl-scroll" style={{ marginTop: 14 }}>
                  <table className="stbl">
                    <thead>
                      <tr>
                        <th>التاريخ</th><th>الحي</th><th>الموقع</th>
                        <th>الآلية</th><th>المصدر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chosen.linked.map((i, n) => (
                        <tr key={`${i.date}-${n}`}>
                          <td className="num" dir="ltr">{day(i.date)}</td>
                          <td className="k">{i.district || '—'}</td>
                          <td>{i.place}</td>
                          <td>
                            {i.mechanism && MECHANISMS[i.mechanism] ? (
                              <span style={{ color: MECHANISMS[i.mechanism].color }}>
                                {MECHANISMS[i.mechanism].ar}
                              </span>
                            ) : '—'}
                          </td>
                          <td>
                            {i.source}
                            {i.corroborated ? <b className="corr"> ✓</b> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="card2-note" style={{ marginTop: 12 }}>
                  لا بلاغ مسجَّل خلال هذا الحدث ولا في اليومين التاليين له. وهذا هو
                  الحال الغالب: {fmt(events.length - stats.withReports)} من{' '}
                  {fmt(events.length)} حدثاً في المدى بلا بلاغ واحد — والمطر نزل في
                  كلٍّ منها. غياب البلاغ ليس غياب الغرق.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── which districts the archive actually covers ── */}
        <div className="card2">
          <div className="card2-h">
            <h2>تغطية الأحياء في المدى</h2>
            <span className="c num">{fmt(coverage.length)} حيّاً</span>
          </div>
          <div className="card2-b">
            {coverage.length ? (
              <>
                {coverage.map((c) => (
                  <div className="kv" key={c.d}>
                    <span>{c.d}</span>
                    <b className="num">
                      {c.n} بلاغاً
                      {c.corr ? <em className="corr"> · {c.corr} مؤكَّد</em> : null}
                    </b>
                  </div>
                ))}
                <p className="card2-note" style={{ marginTop: 10 }}>
                  هذه تغطية <b>البلاغات</b> لا تغطية المطر: الهطول يُقاس عند نقطة
                  واحدة في مركز نطاق الدراسة، فلا يوجد في البيانات هطولٌ منفصل لكل
                  حيّ.
                </p>
              </>
            ) : (
              <p className="card2-note">لا بلاغات داخل المدى المحدَّد.</p>
            )}
          </div>
        </div>

        {/* ── the full list ── */}
        <div className="card2">
          <div className="card2-h">
            <h2>كل الأحداث</h2>
            <span className="c num">{fmt(events.length)}</span>
          </div>
          <div className="tbl-scroll">
            <table className="stbl">
              <thead>
                <tr>
                  <th>الذروة</th><th>المدى</th><th>أيام</th>
                  <th>مجموع ملم</th><th>أعلى يوم</th><th>بلاغات</th><th>أحياء</th>
                </tr>
              </thead>
              <tbody>
                {loaded && events.map((e) => (
                  <tr
                    key={e.rainEventId}
                    onClick={() => setSel(e.rainEventId === sel ? null : e.rainEventId)}
                    className={`rowlink${e.rainEventId === sel ? ' on' : ''}`}
                  >
                    <td className="k num" dir="ltr">{e.pk}</td>
                    <td className="num" dir="ltr">
                      {day(e.startDate)} → {day(e.endDate)}
                    </td>
                    <td className="num">{e.days}</td>
                    <td className="num">{fmt(e.totalMm, 1)}</td>
                    <td className="num">{fmt(e.maxDailyMm, 1)}</td>
                    <td className="num">
                      {e.linked.length || <span className="muted">—</span>}
                    </td>
                    <td>
                      {e.districts.length
                        ? e.districts.join('، ')
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loaded && !events.length && (
              <p className="stat-empty">لا أحداث مطرية داخل المدى المحدَّد.</p>
            )}
            {!loaded && <div className="pg-loading">جارٍ التحميل…</div>}
          </div>
        </div>

        <p className="dnote">
          المصدر: أرشيف Open-Meteo اليومي عند مركز نطاق الدراسة؛ الحدث يُعرَّف بتجاوز
          عتبة الهطول التراكمي في إعدادات خط الأنابيب. والبلاغات من سجلّ الوقائع
          المؤرَّخة، تُربط بالحدث إذا وقعت داخله أو خلال يومين بعده.
        </p>
      </div>
    </main>
  );
}
