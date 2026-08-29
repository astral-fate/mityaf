'use client';

/**
 * Case replay: pick a real flood, see what we had already said about that street.
 *
 * Every other view on this site is a prediction. This one is a test the visitor
 * runs themselves: choose a date the water actually stood, and the page shows
 * the rainfall recorded that day beside the rank the pipeline gave that street
 * from terrain alone.
 *
 * The framing has to stay exact. The ranking is STATIC -- it reads terrain, not
 * weather -- so no alert was ever raised on any of these dates and the system
 * did not exist then. This is retrodiction, and the copy says so in the header
 * rather than in a footnote, because a judge who works that out unaided stops
 * believing the rest of the console.
 */
import { useEffect, useMemo, useState } from 'react';
import { loadJson, fmt } from '@/lib/data';
import { MECHANISMS } from '@/lib/mechanisms';

const QCOLOR = { exact: '#3FD46E', precise: '#3FD46E', geocoded: '#C9AC6D', approx: '#7686B8' };
const QLABEL = { exact: 'مضبوط', precise: 'دقيق', geocoded: 'مُرمَّز', approx: 'تقريبي' };

function bandColor(r) {
  if (r == null) return '#7686B8';
  if (r >= 0.99) return '#FF7766';
  if (r >= 0.9) return '#FFC857';
  if (r >= 0.7) return '#3DD9D6';
  return '#7686B8';
}

export default function Cases() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [year, setYear] = useState('all');
  const [district, setDistrict] = useState('all');
  const [onlyCorrob, setOnlyCorrob] = useState(false);
  const [onlyLocated, setOnlyLocated] = useState(true);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    loadJson('ponding-cases.json').then((d) => { setData(d); setLoaded(true); });
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.items.filter((c) => (
      (year === 'all' || c.date.startsWith(year))
      && (district === 'all' || c.district === district)
      && (!onlyCorrob || c.rain.corroborated)
      && (!onlyLocated || c.segment)
    ));
  }, [data, year, district, onlyCorrob, onlyLocated]);

  useEffect(() => { setSel(rows[0] ?? null); }, [rows]);

  if (!loaded) return <main className="pg"><div className="pg-loading">جارٍ التحميل…</div></main>;
  if (!data) {
    return (
      <main className="pg">
        <div className="pg-loading">
          تعذّر تحميل ponding-cases.json — شغّل <code>research/export_cases.py</code>.
        </div>
      </main>
    );
  }

  const c = data.counts;
  const hit = rows.filter((r) => r.segment && r.segment.rankHydrology >= 0.9).length;

  return (
    <main className="pg" dir="rtl">
      <header className="pg-head">
        <h1>حالات حقيقية — ماذا كان ترتيبنا يقول عن ذلك الشارع؟</h1>
        <p className="pg-sub">
          اختر واقعة غرق مؤرّخة، وقارن هطول ذلك اليوم بالرتبة التي كان الشارع
          يحملها أصلاً. الترتيب ثابت ويُحسب من التضاريس وحدها — لم يُطلَق أيّ
          إنذار في تلك التواريخ، ولم تكن المنصّة موجودة. هذه مطابقة بأثر رجعي.
        </p>
      </header>

      {/* ── counters ─────────────────────────────────────────── */}
      {/* .dmetrics is a fixed two-column grid in the house stylesheet; six
          counters need it widened, and the value/label spans are .v and .l */}
      <section className="dmetrics"
               style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(9rem,1fr))' }}>
        {[
          ['بلاغ مؤرّخ', c.total, ''],
          ['مؤكَّد بمصدرَي مطر', c.corroborated, 'gn'],
          ['بإحداثيات', c.located, 'cy'],
          ['إحداثيات موثوقة', c.trusted, 'gn'],
          ['في أسوأ 1% من المدينة', c.inTop1Pct, 'hot'],
          ['موقع عولج وتوقّف غرقه', c.resolved, ''],
        ].map(([label, v, mod]) => (
          <div className={`dmetric ${mod}`} key={label}>
            <div className="v">{fmt(v)}</div>
            <div className="l">{label}</div>
          </div>
        ))}
      </section>

      {/* ── filters ──────────────────────────────────────────── */}
      <section className="card" style={{ padding: '.9rem 1.1rem', margin: '1rem 0' }}>
        <div className="chiprow" style={{
          gap: '1.4rem', flexWrap: 'wrap', alignItems: 'center', rowGap: '.7rem',
        }}>
          <label>
            <span className="drv-lab">السنة</span>{' '}
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="all">كل السنوات ({data.items.length})</option>
              {data.years.map((y) => (
                <option key={y} value={y}>
                  {y} ({data.items.filter((x) => x.date.startsWith(y)).length})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="drv-lab">الحيّ</span>{' '}
            <select value={district} onChange={(e) => setDistrict(e.target.value)}>
              <option value="all">كل الأحياء</option>
              {data.districts.map((d) => (
                <option key={d} value={d}>
                  {d} ({data.items.filter((x) => x.district === d).length})
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={onlyCorrob}
                   onChange={(e) => setOnlyCorrob(e.target.checked)} />{' '}
            المؤكَّد بالمطر فقط
          </label>
          <label>
            <input type="checkbox" checked={onlyLocated}
                   onChange={(e) => setOnlyLocated(e.target.checked)} />{' '}
            الذي له إحداثيات فقط
          </label>
          <span className="dnote" style={{ marginInlineStart: 'auto' }}>
            {fmt(rows.length)} حالة · {fmt(hit)} منها في أسوأ 10% من المدينة
          </span>
        </div>
      </section>

      <div className="drow" style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: '1rem' }}>
        {/* ── the list ───────────────────────────────────────── */}
        <section className="card" style={{ padding: 0, maxHeight: '32rem', overflowY: 'auto' }}>
          <table className="dlist" style={{ width: '100%' }}>
            <thead>
              <tr><th>التاريخ</th><th>الحيّ</th><th>المطر</th><th>الرتبة</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.date}-${r.place}`}
                    onClick={() => setSel(r)}
                    style={{
                      cursor: 'pointer',
                      background: sel === r ? 'rgba(63,212,110,.10)' : undefined,
                    }}>
                  <td dir="ltr">{r.date}</td>
                  <td>{r.district}</td>
                  <td dir="ltr" style={{ color: r.rain.corroborated ? '#3FD46E' : '#7686B8' }}>
                    {r.rain.peak_mm != null ? `${r.rain.peak_mm} mm` : '—'}
                  </td>
                  <td dir="ltr" style={{ color: bandColor(r.segment?.rankHydrology) }}>
                    {r.segment ? r.segment.rankHydrology.toFixed(3) : '—'}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={4} className="dnote">لا حالات بهذه التصفية.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── the case ───────────────────────────────────────── */}
        <section className="card" style={{ padding: '1.1rem 1.3rem' }}>
          {!sel ? <p className="dnote">اختر حالة من القائمة.</p> : (
            <>
              <h3 style={{ margin: 0 }}>{sel.place}</h3>
              <p className="dnote" style={{ marginTop: '.2rem' }}>
                <span dir="ltr">{sel.date}</span> · {sel.district} · المصدر: {sel.source}
              </p>

              <div className="dmetrics" style={{
                marginTop: '.9rem',
                gridTemplateColumns: 'repeat(auto-fit,minmax(8rem,1fr))',
              }}>
                <div className={`dmetric ${sel.rain.corroborated ? 'gn' : ''}`}>
                  <div className="v" dir="ltr">
                    {sel.rain.peak_mm != null ? sel.rain.peak_mm : '—'}
                  </div>
                  <div className="u">ملم — أعلى قراءة</div>
                  <div className="l">
                    في ذلك اليوم{sel.rain.via ? ` · ${sel.rain.via}` : ''}
                  </div>
                </div>
                {sel.segment && (
                  <>
                    <div className="dmetric hot">
                      <div className="v" dir="ltr"
                           style={{ color: bandColor(sel.segment.rankHydrology) }}>
                        {sel.segment.rankHydrology.toFixed(3)}
                      </div>
                      <div className="u">رتبة هيدرولوجية</div>
                      <div className="l">{sel.segment.band}</div>
                    </div>
                    <div className="dmetric">
                      <div className="v" style={{ color: QCOLOR[sel.location.quality] }}>
                        {QLABEL[sel.location.quality]}
                      </div>
                      <div className="u">جودة الإحداثي</div>
                      <div className="l">
                        {sel.location.trusted ? 'يصلح للاختبار' : 'يختبر الترميز لا الترتيب'}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {sel.segment ? (
                <>
                  <p style={{ marginTop: '.9rem' }}>
                    {sel.segment.name ? <b>{sel.segment.name}</b> : <b>مقطع بلا اسم</b>}
                    {sel.segment.mechanism && MECHANISMS[sel.segment.mechanism] && (
                      <span className="badge" style={{
                        marginInlineStart: '.5rem',
                        color: MECHANISMS[sel.segment.mechanism].color,
                      }}>
                        {MECHANISMS[sel.segment.mechanism].ar}
                      </span>
                    )}
                  </p>
                  <p className="dnote">{sel.location.qualityNote}</p>

                  <table className="dlist" style={{ width: '100%', marginTop: '.7rem' }}>
                    <tbody>
                      <tr><td>هيدرولوجي</td>
                          <td dir="ltr">{sel.segment.rankHydrology.toFixed(3)}</td></tr>
                      <tr><td>المُدرَّب على أمريكا</td>
                          <td dir="ltr">{sel.segment.rankModel.toFixed(3)}</td></tr>
                      <tr><td>كثافة الطرق</td>
                          <td dir="ltr">{sel.segment.rankRoadDensity.toFixed(3)}</td></tr>
                    </tbody>
                  </table>

                  {sel.segment.predictions && (
                    <>
                      <p className="drv-lab" style={{ marginTop: '.8rem' }}>
                        احتمال كل نموذج لهذا الشارع
                      </p>
                      <table className="dlist" style={{ width: '100%' }}>
                        <tbody>
                          {Object.entries(sel.segment.predictions)
                            .sort((a, b) => b[1] - a[1])
                            .map(([m, v]) => (
                              <tr key={m}>
                                <td dir="ltr">{m}</td>
                                <td dir="ltr" style={{ color: v >= 0.5 ? '#3FD46E' : '#FF7766' }}>
                                  {v.toFixed(3)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  <a className="cta-btn" style={{ marginTop: '.9rem', display: 'inline-block' }}
                     href={`/dashboard/segments/${sel.segment.id}`}>
                    افتح صفحة المقطع
                  </a>
                </>
              ) : (
                <p className="dnote" style={{ marginTop: '.9rem' }}>
                  هذا البلاغ لا يحمل إحداثيات — يذكر تاريخاً وحيّاً فقط، فلا يمكن
                  ربطه بمقطع بعينه. من 51 بلاغاً، 17 فقط لها موقع.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {data.resolvedSites?.length > 0 && (
        <section className="card" style={{ padding: '1.1rem 1.3rem', marginTop: '1rem' }}>
          <h3 style={{ margin: 0 }}>موقع عولج على الأرض — وتوقّف غرقه</h3>
          {data.resolvedSites.map((s) => (
            <div key={`${s.lat},${s.lon}`} style={{ marginTop: '.6rem' }}>
              <p><b>{s.district}</b> — كان يغرق من {s.from} إلى {s.until}،
                وأُصلح في {s.fixedWhen}: {s.fixedBy}.</p>
              <p className="dnote">{s.note}</p>
              <p className="dnote">
                ورتبتنا له {s.ourRank} رغم أنّ <span dir="ltr">sink = {s.ourSink}</span> —
                {' '}{s.whyMissed}
              </p>
            </div>
          ))}
        </section>
      )}

      <p className="dnote" style={{ marginTop: '1rem' }}>{data.note}</p>
    </main>
  );
}
