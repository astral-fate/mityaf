'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fmt, loadSegments, loadTopSegments, loadPondingShortlist, loadPondingSegments } from '@/lib/data';
import { BANDS } from '@/lib/bands';
import { mechanismOf } from '@/lib/mechanisms';

/**
 * One street segment, with the evidence behind its score.
 *
 * The point of this page is disagreement. A susceptibility score an engineer
 * cannot interrogate is one they will override once and ignore thereafter, so
 * the terrain that produced it and the model's own per-feature contributions
 * are shown beside the number — including when they point the other way.
 *
 * Detail (drivers, rationale) exists only for the top 2,000 segments; the rest
 * fall back to what rides in the geometry file. That boundary is stated rather
 * than hidden behind an empty panel.
 */

const HERO_BOUNDS = [
  [39.484863, 24.529087],
  [39.726562, 24.529087],
  [39.726562, 24.405340],
  [39.484863, 24.405340],
];

const TERRAIN = [
  ['twi', 'مؤشّر الرطوبة الطبوغرافي', '', 'كلّما ارتفع، زاد ميل الموقع لتجميع الماء'],
  ['hand', 'الارتفاع فوق أقرب مجرى', 'م', 'كلّما انخفض، كان الموقع أقرب إلى مسار الماء'],
  ['sink', 'عمق المنخفض المغلق', 'م', 'المنخفض المغلق يحتجز الماء ولا يصرّفه'],
  ['slope', 'الانحدار', '٪', 'الانحدار المنخفض يبطّئ التصريف السطحي'],
];

const TERRAIN_AR = {
  sink: 'عمق المنخفض',
  slope: 'الميل',
  hand: 'الارتفاع فوق المجرى',
  twi: 'مؤشّر الرطوبة',
  logacc: 'التجمّع المائي',
};

function SegmentMap({ geometry, centroid, color }) {
  const box = useRef(null);
  useEffect(() => {
    if (!box.current || !geometry) return undefined;
    let map; let cancelled = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !box.current) return;
      map = new maplibregl.Map({
        container: box.current,
        style: { version: 8, sources: {}, layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#04081a' } }] },
        center: centroid, zoom: 15.5, attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
      map.on('load', () => {
        map.addSource('sat', { type: 'image', url: '/img/madinah-hero.jpg',
          coordinates: HERO_BOUNDS });
        map.addLayer({ id: 'sat', type: 'raster', source: 'sat',
          paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } });
        map.addSource('s', { type: 'geojson',
          data: { type: 'Feature', geometry, properties: {} } });
        map.addLayer({ id: 's-halo', type: 'line', source: 's',
          paint: { 'line-color': color, 'line-width': 10, 'line-opacity': 0.25 } });
        map.addLayer({ id: 's-line', type: 'line', source: 's',
          paint: { 'line-color': color, 'line-width': 3 } });
      });
    })();
    return () => { cancelled = true; if (map) map.remove(); };
  }, [geometry, centroid, color]);
  return <div className="asset-map" ref={box} />;
}

export default function SegmentDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [feat, setFeat] = useState(null);
  const [detail, setDetail] = useState(null);
  const [state, setState] = useState('loading');
  const [pondingSeg, setPondingSeg] = useState(null);

  useEffect(() => {
    Promise.all([loadSegments(), loadTopSegments()]).then(([segs, top]) => {
      const f = (segs?.features ?? []).find((x) => x.properties.id === id) ?? null;
      setFeat(f);
      setDetail((top?.items ?? []).find((x) => x.segmentUnitId === id) ?? null);
      setState(f ? 'ok' : 'missing');
    });
  }, [id]);

  // Prefer the 2,617-item shortlist; only pull the 13.26 MB full segment
  // file when this id did not make the cut. That fallback is the common
  // case -- 27,720 of 30,337 ids are not on the shortlist -- and splitting
  // the file per id is its own plan, recorded in progress.md.
  useEffect(() => {
    let cancelled = false;
    loadPondingShortlist().then(async (shortlist) => {
      let found = (shortlist?.items ?? []).find((x) => x.id === id) ?? null;
      if (!found) {
        const all = await loadPondingSegments();
        found = (all?.items ?? []).find((x) => x.id === id) ?? null;
      }
      if (!cancelled) setPondingSeg(found);
    });
    return () => { cancelled = true; };
  }, [id]);

  const drivers = useMemo(() => {
    if (!detail?.topDrivers) return [];
    try {
      const d = typeof detail.topDrivers === 'string'
        ? JSON.parse(detail.topDrivers) : detail.topDrivers;
      return Array.isArray(d) ? d : [];
    } catch { return []; }
  }, [detail]);

  if (state === 'loading') {
    return <main className="pg"><div className="pg-loading">جارٍ التحميل…</div></main>;
  }
  if (state === 'missing') {
    return (
      <main className="pg">
        <header className="pg-head"><div>
          <h1>المقطع غير موجود</h1><p>لا يوجد مقطع بهذا المعرّف: {id}</p>
        </div></header>
      </main>
    );
  }

  const p = feat.properties;
  const b = BANDS[p.b ?? 'insufficient_data'];
  const maxAbs = Math.max(1e-6, ...drivers.map((d) => Math.abs(d.c)));
  const seg = pondingSeg;
  const mech = mechanismOf(seg);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <button type="button" className="crumb"
                  onClick={() => router.push('/dashboard/segments')}>
            ← قابلية الشوارع
          </button>
          <h1>{p.name || 'شارع بلا اسم'}</h1>
          <p>
            حي {p.d ?? '—'}
            {p.rk != null && <> · الترتيب <span className="num">{fmt(p.rk)}</span> من ٣٠٬٣٣٧</>}
          </p>
        </div>
        <div className="head-score">
          <span className="num" style={{ color: b.color }}>{p.s ?? '—'}</span>
          <small>{b.ar} · {b.hint}</small>
        </div>
      </header>

      <div className="pg-body">
        {seg && (
          <>
            {/* Why this segment is flagged. The percentile is the honest framing:
                "steeper than 80% of Madinah" transfers; "0.8 degrees" does not. */}
            <section className="panel">
              <h2>الآلية</h2>
              <p className="badge" style={{ background: mech.color }}>{mech.ar}</p>
              <p className="hint">{mech.hint}</p>
              <p className="action">الإجراء المقترح: {mech.actionAr}</p>

              <h3>الخصائص التضاريسية</h3>
              {['sink', 'slope', 'hand', 'twi', 'logacc'].map((k) => (
                <div key={k} className="terrain-row">
                  <span className="terrain-name">{TERRAIN_AR[k]}</span>
                  <span className="terrain-value">{fmt(seg.terrain[k], 2)}</span>
                  {/* A missing percentile is missing, not zero: `?? 0` claimed the
                      segment was flatter and drier than every street in the city. */}
                  <span className="terrain-bar">
                    <i style={{ width: seg.pct[k] != null ? `${Math.round(seg.pct[k] * 100)}%` : 0 }} />
                  </span>
                  <span className="terrain-pct">
                    {seg.pct[k] != null
                      ? `${Math.round(seg.pct[k] * 100)}٪ من مقاطع المدينة`
                      : '—'}
                  </span>
                </div>
              ))}
            </section>

            {/* Four methods, shown together because they disagree, and the
                disagreement is the finding. Two rankings of equal measured skill
                share only 8-16% of their top 5%. */}
            <section className="panel">
              <h2>الترتيب حسب أربع طرق</h2>
              <table className="ranks">
                <tbody>
                  {[['hyd', 'الهيدرولوجيا (المعتمد)'], ['model', 'النموذج المدرَّب'],
                    ['road', 'كثافة الطرق'], ['consensus', 'الإجماع']].map(([k, ar]) => (
                    <tr key={k} className={k === 'hyd' ? 'primary' : ''}>
                      <td>{ar}</td>
                      <td>{seg.ranks[k] != null ? `${Math.round(seg.ranks[k] * 100)}٪` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">
                الرقم نسبة مئوية داخل المدينة المنورة، لا احتمال غرق. ولم يُختبر أيّ منها
                على بيانات من المدينة نفسها.
              </p>
            </section>
          </>
        )}

        <div className="kpi-row">
          {TERRAIN.map(([k, label, unit]) => (
            <div className="kpi" key={k}>
              <span className="v num">
                {p[k] != null ? fmt(p[k], k === 'hand' ? 1 : 2) : '—'}{unit && ` ${unit}`}
              </span>
              <span className="l">{label}</span>
            </div>
          ))}
        </div>

        <div className="card2">
          <div className="card2-h">
            <h2>لماذا هذه الدرجة؟</h2>
            <span className="c">مساهمة كل خاصية في قرار النموذج لهذا المقطع</span>
          </div>
          <div className="card2-b">
            {drivers.length ? (
              <>
                <div className="drv">
                  {drivers.map((d) => (
                    <div className="drv-row" key={d.f}>
                      <span className="drv-lab">{d.ar ?? d.f}</span>
                      <span className="drv-track">
                        <span
                          className="drv-fill"
                          style={{
                            width: `${Math.min(100, (Math.abs(d.c) / maxAbs) * 100)}%`,
                            background: d.c > 0 ? b.color : 'var(--lp-signal)',
                          }}
                        />
                      </span>
                      <span className="drv-val num" style={{
                        color: d.c > 0 ? b.color : 'var(--lp-signal)',
                      }}>
                        {d.c > 0 ? '+' : ''}{fmt(d.c, 3)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="card2-note">
                  القيمة الموجبة ترفع القابلية والسالبة تخفضها. وهي مأخوذة من مساهمات
                  الخصائص داخل النموذج نفسه لهذا المقطع تحديداً، لا من أهمية عامة
                  محسوبة على كامل البيانات.
                </p>
              </>
            ) : (
              <p className="stat-empty">
                تفاصيل المحرّكات متاحة لأعلى ٢٬٠٠٠ مقطع فقط. هذا المقطع خارجها —
                تظهر تضاريسه أعلى الصفحة، أمّا تفكيك القرار فيحتاج تشغيل التصدير الكامل.
              </p>
            )}
          </div>
        </div>

        {detail && (
          <div className="card2">
            <div className="card2-h"><h2>الإجراء المقترح</h2>
              {detail.requiresHydraulicEngineer && (
                <span className="pill" style={{ color: b.color, borderColor: b.color }}>
                  يحتاج مهندس تصريف
                </span>
              )}
            </div>
            <div className="card2-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="kv"><span>الإجراء</span><b>{detail.recommendedActionAr ?? '—'}</b></div>
              <div className="kv"><span>المبرّر</span><b>{detail.rationaleAr ?? '—'}</b></div>
              <div className="kv"><span>طول المقطع</span>
                <b className="num">{detail.unit?.lengthM ? `${fmt(detail.unit.lengthM)} م` : '—'}</b></div>
              <div className="kv"><span>تصنيف الطريق</span><b>{detail.unit?.highwayClass ?? '—'}</b></div>
            </div>
          </div>
        )}

        <div className="card2">
          <div className="card2-h"><h2>الموقع</h2>
            <span className="c">صورة Sentinel-2 · هندسة المقطع من OpenStreetMap</span></div>
          <SegmentMap
            geometry={feat.geometry}
            centroid={detail?.unit?.centroid ?? feat.geometry?.coordinates?.[0]}
            color={b.color}
          />
        </div>

        <p className="dnote">
          الدرجة ترتيب داخل المدينة المنورة لا احتمال غرق، والنموذج لا يعرف مواقع
          شبكات التصريف المنفَّذة — فقد يكون هذا المقطع مخدوماً بالفعل. القرار
          النهائي لمهندس التصريف؛ ووظيفة المنصّة أن تضع المقاطع على طاولته مرتّبةً
          ومع دليلها، لا أن تحلّ محلّه.
        </p>
      </div>
    </main>
  );
}
