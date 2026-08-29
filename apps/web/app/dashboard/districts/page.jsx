'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import FilterBar from '@/components/FilterBar';
import { fmt, loadPondingDistricts } from '@/lib/data';
import { MECHANISMS } from '@/lib/mechanisms';
import { useFilters } from '@/lib/useFilters';

/**
 * Every district, ranked by ponding evidence.
 *
 * Segment and green-asset counts told you how big a district is, not whether
 * it floods. This ranks by the shortlist the hydrology pipeline actually
 * produced — how many segments were flagged, by which of the three
 * mechanisms, and whether a resident's own coordinates and a corroborated
 * rain event back it up. Clicking a row still hands the district to the map.
 */
export default function Districts() {
  const router = useRouter();
  const { filters, update, clear, active } = useFilters();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadPondingDistricts().then((d) => {
      setRows((d?.features ?? []).map((f) => f.properties));
      setLoaded(true);
    });
  }, []);

  const totals = useMemo(() => ({
    shortlist: rows.reduce((a, r) => a + (r.shortlistCount ?? 0), 0),
    depression: rows.reduce((a, r) => a + (r.depressionCount ?? 0), 0),
    convergence: rows.reduce((a, r) => a + (r.convergenceCount ?? 0), 0),
    tunnel: rows.reduce((a, r) => a + (r.tunnelCount ?? 0), 0),
    verified: rows.filter((r) => r.verified).length,
  }), [rows]);

  const columns = useMemo(() => [
    {
      key: 'name', title: 'الحي', sortable: true,
      value: (r) => r.name, search: (r) => r.name,
      render: (r) => <span className="dt-strong">{r.name}</span>,
    },
    {
      key: 'shortlistCount', title: 'مقاطع مرشّحة', sortable: true, cellClass: 'num',
      value: (r) => r.shortlistCount ?? 0, render: (r) => fmt(r.shortlistCount),
    },
    {
      key: 'depressionCount', title: 'منخفضات', sortable: true, cellClass: 'num',
      value: (r) => r.depressionCount ?? 0,
      render: (r) => (
        <span>
          <i className="mech-dot" style={{ background: MECHANISMS.depression.color }} />
          {fmt(r.depressionCount)}
        </span>
      ),
    },
    {
      key: 'convergenceCount', title: 'تجمّع جريان', sortable: true, cellClass: 'num',
      value: (r) => r.convergenceCount ?? 0,
      render: (r) => (
        <span>
          <i className="mech-dot" style={{ background: MECHANISMS.convergence.color }} />
          {fmt(r.convergenceCount)}
        </span>
      ),
    },
    {
      key: 'tunnelCount', title: 'أنفاق', sortable: true, cellClass: 'num',
      value: (r) => r.tunnelCount ?? 0,
      render: (r) => (
        <span>
          <i className="mech-dot" style={{ background: MECHANISMS.tunnel.color }} />
          {fmt(r.tunnelCount)}
        </span>
      ),
    },
    {
      key: 'incidentCount', title: 'بلاغات مؤكّدة', sortable: true, cellClass: 'num',
      value: (r) => r.incidentCount ?? 0, render: (r) => fmt(r.incidentCount),
    },
    {
      key: 'verified', title: 'مُتحقَّق ميدانياً', sortable: true,
      value: (r) => (r.verified ? 1 : 0),
      render: (r) => (r.verified ? (
        <span
          className="verified-badge"
          title="ثلاث إحداثيات من ساكن، وستّ حوادث مؤكّدة بالأمطار"
        >
          ✔ مُتحقَّق
        </span>
      ) : <span className="dt-sub">—</span>),
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
            <span className="num">{fmt(totals.shortlist)}</span> مقطع مرشّح ·{' '}
            <span className="num">{fmt(totals.depression)}</span> منخفض ·{' '}
            <span className="num">{fmt(totals.convergence)}</span> تجمّع جريان ·{' '}
            <span className="num">{fmt(totals.tunnel)}</span> نفق ·{' '}
            <span className="num">{fmt(totals.verified)}</span> حيّ مُتحقَّق ميدانياً
          </p>
        </div>
      </header>

      <div className="pg-body">
        <FilterBar filters={filters} update={update} clear={clear} active={active} />

        {loaded ? (
          <DataTable
            rows={rows}
            columns={columns}
            getKey={(r) => r.id}
            searchPlaceholder="ابحث باسم الحي…"
            emptyMessage="لا يوجد حيّ بهذا الاسم."
            defaultSortKey="shortlistCount"
            onRowClick={(r) => router.push(`/dashboard/map?district=${encodeURIComponent(r.name)}`)}
          />
        ) : (
          <div className="pg-loading">جارٍ التحميل…</div>
        )}

        <p className="dnote">
          الترتيب حسب عدد المقاطع المرشّحة من خط أنابيب الهيدرولوجيا، لا حسب المساحة أو عدد
          الأصول الخضراء. حدود الأحياء نفسها مشتقّة من نقاط مراكزها بتجزئة Voronoi، وليست حدوداً
          رسمية — تختلف عند التماس بين حيّين، وتُستبدل فور توفّر حدود الأمانة الرسمية.
        </p>
      </div>
    </main>
  );
}
