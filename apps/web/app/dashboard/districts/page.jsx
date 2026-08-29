'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import FilterBar from '@/components/FilterBar';
import { fmt, loadPondingDistricts } from '@/lib/data';
import { MECHANISMS } from '@/lib/mechanisms';
import { useFilters, withFilters } from '@/lib/useFilters';

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
  const [totals, setTotals] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadPondingDistricts().then((d) => {
      setRows((d?.features ?? []).map((f) => f.properties));
      // Header figures come from the export's own `totals` block. Summing the
      // 91 rows here instead produced numbers that agreed with
      // ponding-shortlist.json only by luck: one district falling outside
      // every Voronoi cell and the two screens quietly disagree.
      setTotals(d?.totals ?? null);
      setLoaded(true);
    });
  }, []);

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
      key: 'convergenceCount', title: 'شارع انبساطي', sortable: true, cellClass: 'num',
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
      // Bound to corroboratedCount, not incidentCount: the header says
      // "corroborated" and used to sit above every report in the district,
      // contradicting its own tooltip in the same row. The total is shown
      // beside it as the denominator it actually is.
      key: 'corroboratedCount', title: 'بلاغات مؤكّدة', sortable: true, cellClass: 'num',
      value: (r) => r.corroboratedCount ?? 0,
      render: (r) => (
        <span>
          {fmt(r.corroboratedCount)}
          <span className="dt-sub"> / {fmt(r.incidentCount)}</span>
        </span>
      ),
    },
    {
      // Not "field-verified". No one visited these streets. A resident gave
      // three coordinates that land inside a depression the elevation model
      // had already found, and the rainfall record corroborated the dates --
      // so the column says exactly that, in the cell, not in a title
      // attribute a touch device never shows.
      key: 'verified', title: 'مطابق لإحداثيات ساكن', sortable: true,
      value: (r) => (r.verified ? 1 : 0),
      render: (r) => (r.verified ? (
        <span className="verified-cell">
          <span className="verified-badge">✔ مطابق</span>
          <Link
            className="verified-link"
            href="/dashboard/evidence"
            onClick={(e) => e.stopPropagation()}
          >
            إحداثيات ساكن مؤكّدة بالأمطار، لا زيارة ميدانية — الأدلّة ←
          </Link>
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
            <span className="num">{fmt(totals?.districtCount)}</span> حيّاً ·{' '}
            <span className="num">{fmt(totals?.shortlistCount)}</span> مقطع مرشّح ·{' '}
            <span className="num">{fmt(totals?.depressionCount)}</span> منخفض ·{' '}
            <span className="num">{fmt(totals?.convergenceCount)}</span> شارع انبساطي ·{' '}
            <span className="num">{fmt(totals?.tunnelCount)}</span> نفق ·{' '}
            <span className="num">{fmt(totals?.verifiedCount)}</span> حيّ مطابق لإحداثيات ساكن
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
            // withFilters, not a hand-built query string: the hand-built one
            // dropped from, to and mechanism on every jump.
            onRowClick={(r) => router.push(withFilters('/dashboard/map', { ...filters, district: r.name }))}
          />
        ) : (
          <div className="pg-loading">جارٍ التحميل…</div>
        )}

        <p className="dnote">
          عمود «بلاغات مؤكّدة» يعرض المؤكّد بسجلّ الأمطار من إجمالي البلاغات المسجّلة في الحيّ.
          و«مطابق لإحداثيات ساكن» ليس تحقّقاً ميدانياً: لا زيارة ميدانية واحدة جرت في المدينة
          المنورة — وإنّما زوّدنا ساكن بثلاث إحداثيات تقع داخل منخفض حدّده نموذج الارتفاع
          مسبقاً، وأكّد سجلّ الأمطار تواريخ بلاغاته. التفصيل في صفحة الأدلّة.
          الترتيب حسب عدد المقاطع المرشّحة من خط أنابيب الهيدرولوجيا، لا حسب المساحة أو عدد
          الأصول الخضراء. حدود الأحياء نفسها مشتقّة من نقاط مراكزها بتجزئة Voronoi، وليست حدوداً
          رسمية — تختلف عند التماس بين حيّين، وتُستبدل فور توفّر حدود الأمانة الرسمية.
        </p>
      </div>
    </main>
  );
}
