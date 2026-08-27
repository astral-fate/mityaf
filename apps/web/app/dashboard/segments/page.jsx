'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import { fmt, loadSegments, riskColor } from '@/lib/data';

/**
 * The street register — 30,337 rows, which is precisely why it is paginated
 * and searchable rather than scrolled.
 *
 * Most segments have no priority score yet; they show as «لم تُقيَّم» rather
 * than as low risk, because an unscored street is not a safe street.
 */
export default function Segments() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [scoredOnly, setScoredOnly] = useState(false);

  useEffect(() => {
    loadSegments().then((s) => {
      setRows((s?.features ?? []).map((f) => f.properties));
      setLoaded(true);
    });
  }, []);

  const shown = useMemo(
    () => (scoredOnly ? rows.filter((r) => r.s != null) : rows),
    [rows, scoredOnly],
  );
  const nScored = useMemo(() => rows.filter((r) => r.s != null).length, [rows]);

  const columns = useMemo(() => [
    {
      key: 'name', title: 'المقطع', sortable: true,
      value: (r) => r.name ?? r.id, search: (r) => `${r.name ?? ''} ${r.id}`,
      render: (r) => (
        <>
          <span className="dt-strong">{r.name || 'شارع بلا اسم'}</span>
          <span className="dt-sub num">{r.id}</span>
        </>
      ),
    },
    {
      key: 'd', title: 'الحي', sortable: true,
      value: (r) => r.d ?? '', search: (r) => r.d,
      render: (r) => r.d ?? '—',
    },
    {
      key: 's', title: 'درجة الأولوية', sortable: true, cellClass: 'num',
      value: (r) => r.s,
      render: (r) => (r.s == null
        ? <span className="dt-sub">لم تُقيَّم</span>
        : <span style={{ color: riskColor(r.s), fontWeight: 700 }}>{r.s}</span>),
    },
    {
      key: 'b', title: 'التصنيف', sortable: true,
      value: (r) => r.b ?? '',
      render: (r) => <span className="dt-sub">{r.b === 'insufficient_data' ? 'بيانات غير كافية' : (r.b ?? '—')}</span>,
    },
  ], []);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>مقاطع الشوارع</h1>
          <p>
            <span className="num">{fmt(rows.length)}</span> مقطعاً ·{' '}
            <span className="num">{fmt(nScored)}</span> مُقيَّم
          </p>
        </div>
      </header>

      <div className="pg-body">
        {loaded ? (
          <DataTable
            rows={shown}
            columns={columns}
            getKey={(r) => r.id}
            pageSize={40}
            searchPlaceholder="ابحث باسم الشارع أو الحي…"
            emptyMessage="لا يوجد مقطع مطابق."
            onRowClick={(r) => r.d && router.push(`/dashboard/map?district=${encodeURIComponent(r.d)}`)}
            toolbar={(
              <button type="button" className="chip2" aria-pressed={scoredOnly}
                      onClick={() => setScoredOnly((v) => !v)}>
                المُقيَّمة فقط <span className="num">{nScored}</span>
              </button>
            )}
          />
        ) : (
          <div className="pg-loading">جارٍ تحميل ٣٠٬٣٣٧ مقطعاً…</div>
        )}
      </div>
    </main>
  );
}
