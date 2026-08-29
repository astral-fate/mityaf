'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import FilterBar from '@/components/FilterBar';
import { fmt, loadSegments } from '@/lib/data';
import { segmentLabel } from '@/lib/segmentLabel';
import { useFilters } from '@/lib/useFilters';
import { exportSegmentsWorkbook } from '@/lib/excel';
import { BANDS, BAND_ORDER } from '@/lib/bands';

/**
 * Street water-accumulation susceptibility — 30,337 rows.
 *
 * The number on screen is a PERCENTILE within Madinah, not a probability of
 * flooding, and the page says so in three places because it is the single
 * easiest thing to misread. The model was trained on New York and Chicago; the
 * leave-one-city-out test says the ordering survives a move to an unseen city,
 * which licenses ranking Madinah's streets against each other and licenses
 * nothing about absolute risk.
 *
 * Terrain rides in the row rather than living one click away: an engineer
 * dismissing a score wants to see the TWI and the sink depth that produced it,
 * in the same glance.
 */

const ORDER = BAND_ORDER;

export default function Segments() {
  const router = useRouter();
  const { filters, update, clear, active } = useFilters();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [band, setBand] = useState('all');
  const [exporting, setExporting] = useState(false);

  const [roadNames, setRoadNames] = useState([]);

  useEffect(() => {
    loadSegments().then((s) => {
      // roadNames is the interned lookup the derived labels index into; it
      // lives on the collection, so it has to be kept off the feature map.
      setRoadNames(s?.roadNames ?? []);
      setRows((s?.features ?? []).map((f) => f.properties));
      setLoaded(true);
    });
  }, []);

  const base = useMemo(
    () => rows.filter((r) => !filters.district || r.d === filters.district),
    [rows, filters.district],
  );
  const shown = useMemo(
    () => (band === 'all' ? base : base.filter((r) => (r.b ?? 'insufficient_data') === band)),
    [base, band],
  );

  const tally = useMemo(() => {
    const t = {};
    for (const r of base) t[r.b ?? 'insufficient_data'] = (t[r.b ?? 'insufficient_data'] ?? 0) + 1;
    return t;
  }, [base]);

  const nCritical = (tally.critical ?? 0) + (tally.high ?? 0);

  const columns = useMemo(() => [
    {
      key: 'rank', title: 'الترتيب', sortable: true, cellClass: 'num', width: '8%',
      value: (r) => r.rk ?? Number.MAX_SAFE_INTEGER,
      render: (r) => (r.rk != null ? fmt(r.rk) : '—'),
    },
    {
      key: 'name', title: 'المقطع', sortable: true, width: '28%',
      // Sort and search on the label actually shown, or the column sorts by a
      // value the reader cannot see.
      value: (r) => segmentLabel(r, roadNames).text,
      search: (r) => `${segmentLabel(r, roadNames).text} ${r.id} ${r.d ?? ''}`,
      render: (r) => {
        const lab = segmentLabel(r, roadNames);
        return (
          <>
            <span className={lab.derived ? 'dt-strong is-derived' : 'dt-strong'}>
              {lab.text}
            </span>
            <span className="dt-sub">{r.d ?? '—'}</span>
          </>
        );
      },
    },
    {
      key: 'score', title: 'قابلية احتجاز الماء', sortable: true, width: '22%',
      value: (r) => r.s,
      render: (r) => {
        const b = BANDS[r.b ?? 'insufficient_data'];
        return (
          <div className="scorecell">
            <span className="scoreval num" style={{ color: b.color }}>{r.s ?? '—'}</span>
            <span className="scoretrack">
              <span className="scorefill" style={{ width: `${r.s ?? 0}%`, background: b.color }} />
            </span>
            <span className="scoreband" style={{ color: b.color }}>{b.ar}</span>
          </div>
        );
      },
    },
    {
      key: 'twi', title: 'الرطوبة الطبوغرافية', sortable: true, cellClass: 'num', width: '13%',
      value: (r) => r.twi,
      render: (r) => (r.twi != null ? fmt(r.twi, 2) : '—'),
    },
    {
      key: 'hand', title: 'الارتفاع فوق المجرى', sortable: true, cellClass: 'num', width: '13%',
      value: (r) => r.hand,
      render: (r) => (r.hand != null ? <>{fmt(r.hand, 1)} م</> : '—'),
    },
    {
      key: 'sink', title: 'عمق المنخفض', sortable: true, cellClass: 'num', width: '13%',
      value: (r) => r.sink,
      render: (r) => (r.sink != null ? <>{fmt(r.sink, 2)} م</> : '—'),
    },
    // roadNames arrives with the fetch, after the first render. Without it in
    // the deps the columns keep the empty lookup they closed over and every
    // derived label silently falls back to «شارع بلا اسم».
  ], [roadNames]);

  const chips = [['all', 'الكل', '#a3b0d2'],
    ...ORDER.map((k) => [k, BANDS[k].ar, BANDS[k].color])]
    .filter(([k]) => k === 'all' || tally[k]);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>قابلية الشوارع لاحتجاز الماء</h1>
          <p>
            <span className="num">{fmt(base.length)}</span> مقطع شارع
            {filters.district ? <> في حي {filters.district}</> : ' في المدينة'} ·{' '}
            مرتّبة بالتضاريس وشكل الشبكة
          </p>
        </div>
        <div className="head-score">
          <span className="num" style={{ color: BANDS.critical.color }}>{fmt(nCritical)}</span>
          <small>حرج ومرتفع</small>
        </div>
      </header>

      <div className="pg-body">
        <div className="dnote">
          <b>الرقم ترتيب مئوي، لا احتمال غرق.</b> درجة ٩٨ تعني أنّ هذا المقطع ضمن
          أعلى ٢٪ من مقاطع المدينة قابليةً لاحتجاز الماء — لا أنّ احتمال غرقه ٩٨٪.
          النموذج مُدرَّب على ١٠١٬٧٥٦ بلاغاً من نيويورك وشيكاغو، واختبار «اترك مدينة»
          يقول إنّ <b>الترتيب</b> ينتقل إلى مدينة لم يرَها النموذج؛ أمّا المعايرة
          المطلقة فلا تنتقل بين نظامين مطريين مختلفين.
        </div>

        <FilterBar
          filters={filters} update={update} clear={clear} active={active}
          extra={(
            <button
              type="button" className="dl-btn inline" disabled={exporting || !shown.length}
              onClick={async () => {
                setExporting(true);
                try { await exportSegmentsWorkbook(shown, filters, { band }); }
                finally { setExporting(false); }
              }}
            >
              {exporting ? 'جارٍ التحضير…' : '⤓ تنزيل Excel'}
            </button>
          )}
        />

        <div className="hbar" style={{ marginBottom: 4 }}>
          {ORDER.filter((k) => tally[k]).map((k) => (
            <span key={k} className="hseg" title={`${BANDS[k].ar}: ${tally[k]}`}
                  style={{ flex: tally[k], background: BANDS[k].color }} />
          ))}
        </div>

        <div className="chiprow">
          {chips.map(([k, label, color]) => (
            <button key={k} type="button" className="chip2" aria-pressed={band === k}
                    onClick={() => setBand(k)}
                    style={band === k ? { color, borderColor: color } : undefined}
                    title={k === 'all' ? undefined : BANDS[k].hint}>
              <i style={{ background: color }} />
              {label}
              <span className="num">{k === 'all' ? base.length : (tally[k] ?? 0)}</span>
            </button>
          ))}
        </div>

        {loaded ? (
          <DataTable
            rows={shown}
            columns={columns}
            getKey={(r) => r.id}
            searchPlaceholder="ابحث باسم الشارع أو الحي…"
            emptyMessage="لا يوجد مقطع مطابق."
            onRowClick={(r) => router.push(`/dashboard/segments/${encodeURIComponent(r.id)}`)}
          />
        ) : (
          <div className="pg-loading">جارٍ التحميل…</div>
        )}

        <p className="dnote">
          <b>ما لا يعرفه النموذج:</b> خصائصه تضاريسية وحضرية فقط — الانحدار، ومؤشّر
          الرطوبة الطبوغرافي، والارتفاع فوق أقرب مجرى، وعمق المنخفضات، وكثافة الطرق.
          <b> لا يعرف أين نُفِّذت شبكات التصريف فعلاً</b>، فمقطعٌ خُدِم بشبكة جديدة قد
          يظهر مرتفعاً وهو معالَج. ولهذا يُعرض الدليل بجانب الدرجة: القرار النهائي
          لمهندس التصريف، لا للنموذج.
        </p>
      </div>
    </main>
  );
}
