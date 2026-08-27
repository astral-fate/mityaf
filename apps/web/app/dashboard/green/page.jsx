'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import { fmt, loadGreen, loadHealth } from '@/lib/data';

/**
 * The green asset register, with a health verdict per asset.
 *
 * Health comes from build-health, which reads NDVI against NDMI. Until that
 * has run the column reads "لم تُقيَّم" rather than "سليم": an asset nobody has
 * assessed is not an asset in good condition, and the difference is the whole
 * point of the honesty rules in the classifier.
 */

const STATUS = {
  healthy:           { ar: 'سليم', c: 'var(--lp-signal)' },
  water_stress:      { ar: 'إجهاد ريّ', c: 'var(--sev-1)' },
  sparse:            { ar: 'غطاء متفرّق', c: 'var(--sev-1)' },
  declining:         { ar: 'متدهور', c: 'var(--sev-2)' },
  dead:              { ar: 'ميت', c: 'var(--sev-3)' },
  insufficient_data: { ar: 'رصد غير كافٍ', c: 'var(--lp-fg-3)' },
};
const UNASSESSED = { ar: 'لم تُقيَّم', c: 'var(--lp-fg-3)' };

export default function GreenAssets() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    Promise.all([loadGreen(), loadHealth()]).then(([g, h]) => {
      const health = new Map((h?.items ?? []).map((x) => [x.greenUnitId, x]));
      setRows((g?.features ?? [])
        .map((f) => f.properties)
        .filter((p) => p.t === 'green')
        .map((p) => ({ ...p, health: health.get(p.id) ?? null })));
      setLoaded(true);
    });
  }, []);

  const tally = useMemo(() => {
    const t = {};
    for (const r of rows) {
      const k = r.health?.status ?? 'unassessed';
      t[k] = (t[k] ?? 0) + 1;
    }
    return t;
  }, [rows]);

  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => (r.health?.status ?? 'unassessed') === filter)),
    [rows, filter],
  );

  const columns = useMemo(() => [
    {
      key: 'name', title: 'الأصل', sortable: true,
      value: (r) => r.name ?? r.id, search: (r) => `${r.name ?? ''} ${r.id}`,
      render: (r) => (
        <>
          <span className="dt-strong">{r.name || 'أصل بلا اسم'}</span>
          <span className="dt-sub num">{r.id}</span>
        </>
      ),
    },
    {
      key: 'district', title: 'الحي', sortable: true,
      value: (r) => r.district ?? '', search: (r) => r.district,
      render: (r) => r.district ?? '—',
    },
    {
      key: 'area', title: 'المساحة م²', sortable: true, cellClass: 'num',
      value: (r) => r.area ?? 0, render: (r) => fmt(r.area),
    },
    {
      key: 'status', title: 'الحالة', sortable: true,
      value: (r) => r.health?.status ?? 'zzz',
      render: (r) => {
        const s = r.health ? (STATUS[r.health.status] ?? UNASSESSED) : UNASSESSED;
        return <span className="pill" style={{ color: s.c, borderColor: s.c }}>{s.ar}</span>;
      },
    },
    {
      key: 'ndvi', title: 'NDVI', sortable: true, cellClass: 'num',
      value: (r) => r.health?.ndviMedian ?? null,
      render: (r) => (r.health?.ndviMedian != null ? fmt(r.health.ndviMedian, 2) : '—'),
    },
    {
      key: 'why', title: 'السبب', sortable: false,
      render: (r) => <span className="dt-sub">{r.health?.reasonAr ?? 'بانتظار تشغيل تقييم الصحة'}</span>,
    },
  ], []);

  const chips = [['all', 'الكل'], ...Object.keys(STATUS).map((k) => [k, STATUS[k].ar]), ['unassessed', UNASSESSED.ar]]
    .filter(([k]) => k === 'all' || tally[k]);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>المسطّحات الخضراء</h1>
          <p><span className="num">{fmt(rows.length)}</span> أصلاً تحت الرصد</p>
        </div>
      </header>

      <div className="pg-body">
        <div className="chiprow">
          {chips.map(([k, label]) => (
            <button key={k} type="button" className="chip2" aria-pressed={filter === k}
                    onClick={() => setFilter(k)}>
              {label}
              <span className="num">{k === 'all' ? rows.length : (tally[k] ?? 0)}</span>
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
            onRowClick={(r) => router.push(`/dashboard/map?district=${encodeURIComponent(r.district ?? '')}`)}
          />
        ) : (
          <div className="pg-loading">جارٍ التحميل…</div>
        )}
      </div>
    </main>
  );
}
