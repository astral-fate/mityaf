'use client';

import { useEffect, useMemo, useState } from 'react';
import DataTable from '@/components/DataTable';
import FilterBar from '@/components/FilterBar';
import { fmt, loadSocial } from '@/lib/data';
import { inWindow, useFilters } from '@/lib/useFilters';

/**
 * Citizen reports — ingestion, Arabic classification, and district alerts.
 *
 * The satellite says where water IS; a resident says where water HURTS, and
 * says it in minutes rather than in a revisit cycle. The two fail in opposite
 * directions, so neither is ground truth — but agreement between them is the
 * strongest signal the platform can produce.
 *
 * Every classification shows the terms that fired. An officer acting on an
 * alert has to be able to see why it fired and disagree with it; a label with
 * no reasoning behind it is one nobody will act on twice.
 */

const CATEGORIES = {
  flooding: { ar: 'تجمّع مياه وغرق', color: '#e8596b' },
  drainage: { ar: 'تصريف وبالوعات', color: '#f08a5a' },
  irrigation: { ar: 'ريّ وتسرّب', color: '#2fd8ef' },
  vegetation: { ar: 'أشجار ومسطّحات', color: '#50ff4a' },
  roads: { ar: 'طرق وحفريات', color: '#f5c15c' },
  cleanliness: { ar: 'نظافة', color: '#c39a6d' },
  other: { ar: 'غير مصنّف', color: '#66739a' },
};

const LEVELS = {
  critical: { ar: 'حرج', color: '#e8596b' },
  high: { ar: 'مرتفع', color: '#f08a5a' },
  medium: { ar: 'متوسط', color: '#f5c15c' },
  low: { ar: 'منخفض', color: '#66739a' },
};

/** Several reports from one district about one thing is a signal; one is a complaint. */
function clusterAlerts(posts, minPosts = 2) {
  const byKey = new Map();
  for (const p of posts) {
    if (!p.district || p.urgency < 2) continue;
    const key = `${p.district}::${p.category}`;
    if (!byKey.has(key)) byKey.set(key, { ...p, posts: [], maxUrgency: 0 });
    const a = byKey.get(key);
    a.posts.push(p);
    a.maxUrgency = Math.max(a.maxUrgency, p.urgency);
  }
  return [...byKey.values()]
    .filter((a) => a.posts.length >= minPosts)
    .map((a) => ({
      ...a,
      n: a.posts.length,
      level: a.maxUrgency >= 5 ? 'critical' : a.maxUrgency >= 4 ? 'high' : 'medium',
    }))
    .sort((a, b) => b.maxUrgency - a.maxUrgency || b.n - a.n);
}

export default function Reports() {
  const { filters, update, clear, active } = useFilters();
  const [data, setData] = useState(null);
  const [cat, setCat] = useState('all');
  const [sel, setSel] = useState(null);

  useEffect(() => { loadSocial().then(setData); }, []);

  const posts = useMemo(() => {
    const all = data?.posts ?? [];
    return all.filter((p) =>
      (!filters.district || p.district === filters.district)
      && inWindow(p.createdAt, filters)
      && (cat === 'all' || p.category === cat));
  }, [data, filters, cat]);

  const alerts = useMemo(() => clusterAlerts(posts), [posts]);
  const tally = useMemo(() => {
    const t = {};
    for (const p of data?.posts ?? []) t[p.category] = (t[p.category] ?? 0) + 1;
    return t;
  }, [data]);

  const columns = useMemo(() => [
    {
      key: 'level', title: 'الإلحاح', sortable: true, width: '9%',
      value: (p) => p.urgency,
      render: (p) => {
        const l = LEVELS[p.level] ?? LEVELS.low;
        return <span className="pill" style={{ color: l.color, borderColor: l.color }}>{l.ar}</span>;
      },
    },
    {
      key: 'category', title: 'الفئة', sortable: true, width: '13%',
      value: (p) => p.category,
      render: (p) => {
        const c = CATEGORIES[p.category] ?? CATEGORIES.other;
        return <span style={{ color: c.color, fontWeight: 600, fontSize: 12 }}>{c.ar}</span>;
      },
    },
    {
      key: 'district', title: 'الحي', sortable: true, width: '11%',
      value: (p) => p.district ?? '', search: (p) => p.district,
      render: (p) => p.district ?? <span className="dt-sub">لم يُذكر</span>,
    },
    {
      key: 'text', title: 'نصّ البلاغ', sortable: false, width: '52%',
      search: (p) => p.text,
      render: (p) => (
        <>
          <span style={{ color: 'var(--lp-fg)' }}>{p.text}</span>
          <span className="dt-sub">{p.explanationAr}</span>
        </>
      ),
    },
    {
      key: 'when', title: 'التاريخ', sortable: true, cellClass: 'num', width: '11%',
      value: (p) => String(p.createdAt),
      render: (p) => String(p.createdAt).slice(0, 10),
    },
  ], []);

  const chips = [['all', 'الكل', '#a3b0d2'],
    ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.ar, v.color])]
    .filter(([k]) => k === 'all' || tally[k]);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>بلاغات المجتمع</h1>
          <p>
            <span className="num">{fmt(posts.length)}</span> بلاغاً مصنّفاً ·{' '}
            <span className="num">{fmt(alerts.length)}</span> تنبيهاً على مستوى الحي
          </p>
        </div>
        <div className="head-score">
          <span className="num" style={{ color: alerts.length ? 'var(--sev-2)' : 'var(--lp-signal)' }}>
            {alerts.length}
          </span>
          <small>تنبيه نشط</small>
        </div>
      </header>

      <div className="pg-body">
        {/* Never let sample data pass as live. */}
        {data?.allSynthetic && (
          <div className="dnote" style={{ borderColor: 'rgba(245,193,92,.4)', color: 'var(--sev-1)' }}>
            <b>بيانات عيّنة توضيحية.</b> هذه البلاغات <b>مُصطنعة بالكامل</b> وكل حساب فيها
            خيالي — تعمل بها المنصّة بلا مفاتيح وبلا تكلفة. قراءة منصّة X مدفوعة لكل منشور
            منذ فبراير ٢٠٢٦، فيتحوّل النظام إلى التدفّق الحيّ فور ضبط{' '}
            <code>X_BEARER_TOKEN</code>. التصنيف والتجميع أدناه يعملان على البيانات الحقيقية
            بلا أي تغيير.
          </div>
        )}

        <FilterBar filters={filters} update={update} clear={clear} active={active} />

        {alerts.length > 0 && (
          <div className="card2">
            <div className="card2-h">
              <h2>تنبيهات على مستوى الحي</h2>
              <span className="c">بلاغان أو أكثر عن الشيء نفسه</span>
            </div>
            <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {alerts.map((a) => {
                const l = LEVELS[a.level];
                const c = CATEGORIES[a.category] ?? CATEGORIES.other;
                return (
                  <button
                    type="button"
                    key={`${a.district}-${a.category}`}
                    className="drow"
                    onClick={() => { setCat(a.category); update({ district: a.district }); }}
                  >
                    <i style={{ background: l.color }} />
                    <span>
                      <div className="t">
                        <span className="num">{a.n}</span> بلاغات عن {c.ar} في حي {a.district}
                      </div>
                      <div className="s">أعلى درجة إلحاح {a.maxUrgency} من ٥</div>
                    </span>
                    <span className="v" style={{ color: l.color }}>{l.ar}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="chiprow">
          {chips.map(([k, label, color]) => (
            <button key={k} type="button" className="chip2" aria-pressed={cat === k}
                    onClick={() => setCat(k)}
                    style={cat === k ? { color, borderColor: color } : undefined}>
              <i style={{ background: color }} />
              {label}
              <span className="num">{k === 'all' ? (data?.posts?.length ?? 0) : (tally[k] ?? 0)}</span>
            </button>
          ))}
        </div>

        {data ? (
          <DataTable
            rows={posts}
            columns={columns}
            getKey={(p) => p.id}
            searchPlaceholder="ابحث في نصوص البلاغات…"
            emptyMessage="لا بلاغات مطابقة."
            onRowClick={setSel}
          />
        ) : (
          <div className="pg-loading">جارٍ التحميل…</div>
        )}

        {sel && (
          <div className="card2">
            <div className="card2-h">
              <h2>كيف صُنّف هذا البلاغ</h2>
              <button type="button" className="dsel-x" onClick={() => setSel(null)}>×</button>
            </div>
            <div className="card2-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 14, lineHeight: 1.8 }}>{sel.text}</p>
              <div className="kv"><span>الفئة</span><b>{(CATEGORIES[sel.category] ?? CATEGORIES.other).ar}</b></div>
              <div className="kv"><span>الحي المستخرَج</span><b>{sel.district ?? 'لم يُذكر في النص'}</b></div>
              <div className="kv"><span>درجة الإلحاح</span><b className="num">{sel.urgency} / 5</b></div>
              <div className="kv">
                <span>المفردات التي طابقت</span>
                <b>{sel.matched?.length ? sel.matched.join('، ') : '—'}</b>
              </div>
              {sel.intensifiers?.length > 0 && (
                <div className="kv"><span>مؤشرات الإلحاح</span><b>{sel.intensifiers.join('، ')}</b></div>
              )}
              <p className="card2-note" style={{ borderTop: '1px solid var(--lp-line)', paddingTop: 10 }}>
                التصنيف قائم على قواعد لا على نموذج لغوي، عمداً: المسؤول الذي يتصرّف بناءً
                على تنبيه يجب أن يرى لماذا أُطلق وأن يستطيع الاعتراض عليه.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
