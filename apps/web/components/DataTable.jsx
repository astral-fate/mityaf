'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { ICONS } from '@/lib/navigation';

/**
 * Searchable, sortable, paginated table.
 *
 * Dumping 324 assets — or 30,337 segments — into one scrolling list is not a
 * list, it is a haystack. Someone arriving here has a name in mind and wants
 * that row; everything below exists to make that the fast path.
 *
 * Search runs against a per-column `search` accessor rather than a blind
 * JSON.stringify of the row, so typing a district name cannot match some
 * unrelated internal id that happens to contain the same digits.
 *
 * Filtering runs on a deferred copy of the query. At 30k rows the work is real
 * enough that doing it synchronously drops keystrokes.
 */
export default function DataTable({
  rows,
  columns,
  getKey,
  onRowClick,
  searchPlaceholder = 'ابحث…',
  pageSize = 25,
  emptyMessage = 'لا توجد نتائج.',
  toolbar = null,
  defaultSortKey = null,
  defaultSortDir = 'desc',
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(() => {
    const key = defaultSortKey ?? columns.find((c) => c.sortable)?.key;
    return key ? { key, dir: defaultSortDir } : null;
  });
  const [page, setPage] = useState(0);

  const deferred = useDeferredValue(q);

  const filtered = useMemo(() => {
    const needle = deferred.trim().toLowerCase();
    if (!needle) return rows;
    const searchables = columns.filter((c) => c.search);
    return rows.filter((r) =>
      searchables.some((c) => String(c.search(r) ?? '').toLowerCase().includes(needle)));
  }, [rows, columns, deferred]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;   // blanks sink, either way
      if (vb === null || vb === undefined) return -1;
      return typeof va === 'string'
        ? va.localeCompare(String(vb), 'ar') * dir
        : (va - vb) * dir;
    });
  }, [filtered, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const slice = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const clickSort = (key) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

  return (
    <div className="dt">
      <div className="dt-bar">
        <div className="dt-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d={ICONS.search} />
          </svg>
          <input
            type="search"
            value={q}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
          />
        </div>
        {toolbar}
        <span className="dt-count num">
          {sorted.length.toLocaleString('en-US')}
          {sorted.length !== rows.length && ` / ${rows.length.toLocaleString('en-US')}`}
        </span>
      </div>

      <div className="dt-scroll">
        <table className="dt-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={c.width ? { width: c.width } : undefined}>
                  {c.sortable ? (
                    <button type="button" onClick={() => clickSort(c.key)}
                            aria-label={`ترتيب حسب ${c.title}`}>
                      {c.title}
                      <i className={sort?.key === c.key ? `s ${sort.dir}` : 's'} />
                    </button>
                  ) : c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr
                key={getKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={onRowClick ? 'clickable' : undefined}
              >
                {columns.map((c) => <td key={c.key} className={c.cellClass}>{c.render(r)}</td>)}
              </tr>
            ))}
            {!slice.length && (
              <tr><td colSpan={columns.length} className="dt-empty">{emptyMessage}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="dt-pager">
          <button type="button" onClick={() => setPage(0)} disabled={safePage === 0}>الأولى</button>
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>السابقة</button>
          <span className="num">{safePage + 1} / {pages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={safePage >= pages - 1}>التالية</button>
          <button type="button" onClick={() => setPage(pages - 1)} disabled={safePage >= pages - 1}>الأخيرة</button>
        </div>
      )}
    </div>
  );
}
