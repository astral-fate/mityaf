'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import FilterBar from '@/components/FilterBar';
import { fmt, loadGreen, loadHealth } from '@/lib/data';
import { useFilters } from '@/lib/useFilters';
import { actionFor, band, scoreAsset, STATUS_META } from '@/lib/score';

/**
 * Green asset performance.
 *
 * Built around the question a parks department actually has — which of these
 * needs someone sent to it this week — rather than around the indices. The
 * score and its colour carry the answer at a glance; the indices are kept as
 * the justification, one click away, because the verdict has to be arguable.
 */
export default function GreenAssets() {
  const router = useRouter();
  const { filters, update, clear, active } = useFilters();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('all');

  useEffect(() => {
    Promise.all([loadGreen(), loadHealth()]).then(([g, h]) => {
      const health = new Map((h?.items ?? []).map((x) => [x.greenUnitId, x]));
      setRows((g?.features ?? [])
        .map((f) => f.properties)
        .filter((p) => p.t === 'green')
        .map((p) => {
          const hh = health.get(p.id) ?? null;
          const sc = scoreAsset(hh);
          return {
            ...p,
            health: hh,
            status: hh?.status ?? 'insufficient_data',
            score: sc.score,
            parts: sc.parts,
            action: actionFor(hh?.status),
          };
        }));
      setLoaded(true);
    });
  }, []);

  const inFilters = (r) => !filters.district || r.district === filters.district;
  const base = useMemo(() => rows.filter(inFilters), [rows, filters.district]);
  const shown = useMemo(
    () => (status === 'all' ? base : base.filter((r) => r.status === status)),
    [base, status],
  );

  const tally = useMemo(() => {
    const t = {};
    for (const r of base) t[r.status] = (t[r.status] ?? 0) + 1;
    return t;
  }, [base]);

  const summary = useMemo(() => {
    const scored = base.map((r) => r.score).filter((s) => s !== null);
    return {
      avg: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
      scored: scored.length,
      attention: base.filter((r) => r.action.urgency >= 2).length,
    };
  }, [base]);

  const columns = useMemo(() => [
    {
      key: 'name', title: 'الأصل', sortable: true, width: '26%',
      value: (r) => r.name ?? r.id, search: (r) => `${r.name ?? ''} ${r.id} ${r.district ?? ''}`,
      render: (r) => (
        <>
          <span className="dt-strong">{r.name || 'أصل بلا اسم'}</span>
          <span className="dt-sub">{r.district ?? '—'} · <span className="num">{fmt(r.area)}</span> م²</span>
        </>
      ),
    },
    {
      key: 'score', title: 'درجة الأداء', sortable: true, width: '15%',
      value: (r) => r.score,
      render: (r) => {
        const b = band(r.score);
        return (
          <div className="scorecell">
            <span className="scoreval num" style={{ color: b.color }}>
              {r.score === null ? '—' : r.score}
            </span>
            <span className="scoretrack">
              <span className="scorefill"
                    style={{ width: `${r.score ?? 0}%`, background: b.color }} />
            </span>
            <span className="scoreband" style={{ color: b.color }}>{b.ar}</span>
          </div>
        );
      },
    },
    {
      key: 'status', title: 'الحالة', sortable: true, width: '13%',
      value: (r) => r.status,
      render: (r) => {
        const m = STATUS_META[r.status] ?? STATUS_META.insufficient_data;
        return <span className="pill" style={{ color: m.color, borderColor: m.color }}>{m.ar}</span>;
      },
    },
    {
      key: 'ndvi', title: 'NDVI', sortable: true, cellClass: 'num', width: '9%',
      value: (r) => r.health?.ndviMedian ?? null,
      render: (r) => (r.health?.ndviMedian != null ? fmt(r.health.ndviMedian, 2) : '—'),
    },
    {
      key: 'action', title: 'الإجراء المقترح', sortable: true, width: '37%',
      value: (r) => r.action.urgency,
      render: (r) => (
        <>
          <span className={`act u${r.action.urgency}`}>{r.action.ar}</span>
          <span className="dt-sub">{r.health?.reasonAr ?? 'بانتظار التقييم'}</span>
        </>
      ),
    },
  ], []);

  const chips = [['all', 'الكل', '#a3b0d2'],
    ...Object.entries(STATUS_META).map(([k, m]) => [k, m.ar, m.color])]
    .filter(([k]) => k === 'all' || tally[k]);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>المسطّحات الخضراء</h1>
          <p>
            <span className="num">{fmt(base.length)}</span> أصلاً
            {filters.district ? <> في حي {filters.district}</> : ' في المدينة'} ·{' '}
            <span className="num">{fmt(summary.scored)}</span> مُقيَّم
          </p>
        </div>
        <div className="head-score">
          <span className="num" style={{ color: band(summary.avg).color }}>
            {summary.avg ?? '—'}
          </span>
          <small>متوسط الأداء</small>
        </div>
      </header>

      <div className="pg-body">
        <FilterBar filters={filters} update={update} clear={clear} active={active} />

        {summary.attention > 0 && (
          <div className="cta">
            <span className="cta-n num">{summary.attention}</span>
            <div>
              <b>أصلاً يحتاج تدخّلاً هذا الأسبوع</b>
              <p>فقد غطاء نباتي، أو اتجاه هابط، أو إجهاد ريّ رُصد قبل ظهوره للعين.</p>
            </div>
            <button type="button" className="cta-btn" onClick={() => setStatus('water_stress')}>
              عرض حالات الإجهاد ←
            </button>
          </div>
        )}

        <div className="chiprow">
          {chips.map(([k, label, color]) => (
            <button key={k} type="button" className="chip2" aria-pressed={status === k}
                    onClick={() => setStatus(k)}
                    style={status === k ? { color, borderColor: color } : undefined}>
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
            searchPlaceholder="ابحث باسم الأصل أو الحي…"
            emptyMessage="لا يوجد أصل مطابق."
            onRowClick={(r) => r.district
              && router.push(`/dashboard/map?district=${encodeURIComponent(r.district)}`)}
          />
        ) : (
          <div className="pg-loading">جارٍ التحميل…</div>
        )}

        <p className="dnote">
          <b>كيف تُقرأ الدرجة:</b> مجموع مرجّح شفّاف من الحيوية (NDVI) والرطوبة (NDMI) والاتجاه،
          لا تصنيفاً عنقودياً — حتى يمكن الدفاع عن أي رقم في اجتماع. أصل بأقل من ستة أرصاد صافية
          لا يُمنح درجة إطلاقاً: رقمٌ واثق مبني على أربع لقطات غائمة أسوأ من لا رقم.
          و«أرض غير مزروعة» ليست «فقد غطاء» — الأولى لم تُزرع قط، والثانية خسرت غطاءً كان موجوداً.
        </p>
      </div>
    </main>
  );
}
