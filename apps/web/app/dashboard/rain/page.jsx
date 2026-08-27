'use client';

import { useEffect, useMemo, useState } from 'react';
import DataTable from '@/components/DataTable';
import FilterBar from '@/components/FilterBar';
import { fmt, loadRain } from '@/lib/data';
import { inWindow, useFilters } from '@/lib/useFilters';

/**
 * The rain archive.
 *
 * These events are not background colour — they are the labels. Every
 * before/after verification and every ponding detection is anchored to one of
 * these dates, so being able to find and inspect them is part of the product,
 * not a nicety.
 */
export default function Rain() {
  const { filters, update, clear, active } = useFilters();
  const [rain, setRain] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadRain().then((r) => { setRain(r); setLoaded(true); });
  }, []);

  const events = useMemo(
    () => (rain?.events ?? []).filter((e) => inWindow(e.peakDate, filters)),
    [rain, filters],
  );

  const stats = useMemo(() => {
    if (!events.length) return { total: 0, max: 0, biggest: null };
    const biggest = events.reduce((a, b) => (b.totalMm > a.totalMm ? b : a));
    return {
      total: events.reduce((a, e) => a + e.totalMm, 0),
      max: biggest.totalMm,
      biggest,
    };
  }, [events]);

  const columns = useMemo(() => [
    {
      key: 'peak', title: 'تاريخ الذروة', sortable: true, cellClass: 'num',
      value: (e) => String(e.peakDate), search: (e) => String(e.peakDate).slice(0, 10),
      render: (e) => <span className="dt-strong num">{String(e.peakDate).slice(0, 10)}</span>,
    },
    {
      key: 'total', title: 'الإجمالي ملم', sortable: true, cellClass: 'num',
      value: (e) => e.totalMm,
      render: (e) => (
        <span style={{ color: e.totalMm > 25 ? 'var(--sev-2)' : 'var(--lp-water)', fontWeight: 700 }}>
          {fmt(e.totalMm, 1)}
        </span>
      ),
    },
    {
      key: 'max', title: 'أعلى يوم ملم', sortable: true, cellClass: 'num',
      value: (e) => e.maxDailyMm, render: (e) => fmt(e.maxDailyMm, 1),
    },
    {
      key: 'span', title: 'المدة', sortable: false, cellClass: 'num',
      render: (e) => {
        const days = Math.round(
          (new Date(e.endDate) - new Date(e.startDate)) / 864e5) + 1;
        return `${days} يوم`;
      },
    },
    {
      key: 'id', title: 'المعرّف', sortable: false,
      search: (e) => e.rainEventId,
      render: (e) => <span className="dt-sub num">{e.rainEventId}</span>,
    },
  ], []);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>الأحداث المطرية</h1>
          <p>
            <span className="num">{fmt(rain?.events?.length ?? 0)}</span> حدثاً منذ ٢٠١٥ —
            كل تحقّق «قبل/بعد» مرتبط بأحدها
          </p>
        </div>
      </header>

      <div className="pg-body">
        <FilterBar filters={filters} update={update} clear={clear} active={active} />

        <div className="ov-grid">
          <div className="ov-tile as-stat">
            <div className="v num">{fmt(events.length)}</div>
            <div className="k">حدثاً في المدى</div>
          </div>
          <div className="ov-tile as-stat">
            <div className="v num" style={{ color: 'var(--lp-water)' }}>{fmt(stats.total, 1)}</div>
            <div className="k">ملم مجموع الهطول</div>
          </div>
          <div className="ov-tile as-stat">
            <div className="v num" style={{ color: 'var(--sev-2)' }}>{fmt(stats.max, 1)}</div>
            <div className="k">ملم أكبر حدث</div>
            <div className="s num">{stats.biggest ? String(stats.biggest.peakDate).slice(0, 10) : '—'}</div>
          </div>
        </div>

        {loaded ? (
          <DataTable
            rows={events}
            columns={columns}
            getKey={(e) => e.rainEventId}
            searchPlaceholder="ابحث بالتاريخ…"
            emptyMessage="لا أحداث مطرية داخل المدى المحدَّد."
          />
        ) : (
          <div className="pg-loading">جارٍ التحميل…</div>
        )}

        <p className="dnote">
          المصدر: أرشيف Open-Meteo اليومي عند مركز نطاق الدراسة. الحدث يُعرَّف بتجاوز عتبة
          الهطول التراكمي المحدّدة في إعدادات خط الأنابيب.
        </p>
      </div>
    </main>
  );
}
