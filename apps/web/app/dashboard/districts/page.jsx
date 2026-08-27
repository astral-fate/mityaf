'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import { fmt, loadDistricts } from '@/lib/data';

/**
 * Every district, searchable by name.
 *
 * This is the page that answers "where is حي الدفاع" without scrolling, which
 * the single flat list never could. Clicking a row hands the district to the
 * map as a filter rather than opening yet another view of the same numbers.
 */
export default function Districts() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadDistricts().then((d) => {
      setRows((d?.features ?? [])
        .map((f) => f.properties)
        .map((p) => ({ ...p, density: p.km2 > 0 ? p.seg / p.km2 : 0 })));
      setLoaded(true);
    });
  }, []);

  const totals = useMemo(() => ({
    seg: rows.reduce((a, r) => a + r.seg, 0),
    green: rows.reduce((a, r) => a + r.green, 0),
    km2: rows.reduce((a, r) => a + r.km2, 0),
  }), [rows]);

  const columns = useMemo(() => [
    {
      key: 'name', title: 'الحي', sortable: true,
      value: (r) => r.name, search: (r) => r.name,
      render: (r) => <span className="dt-strong">{r.name}</span>,
    },
    {
      key: 'seg', title: 'مقاطع الشوارع', sortable: true, cellClass: 'num',
      value: (r) => r.seg, render: (r) => fmt(r.seg),
    },
    {
      key: 'green', title: 'أصول خضراء', sortable: true, cellClass: 'num',
      value: (r) => r.green, render: (r) => fmt(r.green),
    },
    {
      key: 'km2', title: 'المساحة كم²', sortable: true, cellClass: 'num',
      value: (r) => r.km2, render: (r) => fmt(r.km2, 2),
    },
    {
      key: 'density', title: 'الكثافة /كم²', sortable: true, cellClass: 'num',
      value: (r) => r.density, render: (r) => fmt(r.density, 1),
    },
    {
      key: 'go', title: '', sortable: false,
      render: () => <span className="dt-go">عرض على الخريطة ←</span>,
    },
  ], []);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>الأحياء</h1>
          <p>
            <span className="num">{fmt(rows.length)}</span> حيّاً ·{' '}
            <span className="num">{fmt(totals.seg)}</span> مقطع شارع ·{' '}
            <span className="num">{fmt(totals.green)}</span> أصل أخضر ·{' '}
            <span className="num">{fmt(totals.km2, 0)}</span> كم²
          </p>
        </div>
      </header>

      <div className="pg-body">
        {loaded ? (
          <DataTable
            rows={rows}
            columns={columns}
            getKey={(r) => r.id}
            searchPlaceholder="ابحث باسم الحي…"
            emptyMessage="لا يوجد حيّ بهذا الاسم."
            onRowClick={(r) => router.push(`/dashboard/map?district=${encodeURIComponent(r.name)}`)}
          />
        ) : (
          <div className="pg-loading">جارٍ التحميل…</div>
        )}

        <p className="dnote">
          حدود الأحياء مشتقّة من نقاط مراكزها بتجزئة Voronoi، وليست حدوداً رسمية — تختلف عند
          التماس بين حيّين. تُستبدل فور توفّر حدود الأمانة الرسمية، ويمكن إسقاطها مباشرةً في
          صفحة الخريطة.
        </p>
      </div>
    </main>
  );
}
