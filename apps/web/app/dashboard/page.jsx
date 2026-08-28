'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { fmt, loadDistricts, loadGreen, loadHealth, loadMeta, loadRain, loadSegments } from '@/lib/data';

/**
 * Overview — the page that answers "what should I care about today".
 *
 * Deliberately not a second map and not another table. It states the rain
 * condition, which decides how everything else on the platform is read, and
 * then points at the view that answers each question rather than trying to
 * answer all of them here.
 */
export default function Overview() {
  const [d, setD] = useState({ meta: null, rain: null, districts: [], green: [], health: [], seg: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([loadMeta(), loadRain(), loadDistricts(), loadGreen(), loadHealth(), loadSegments()])
      .then(([meta, rain, dist, green, health, seg]) => {
        setD({
          meta,
          rain,
          districts: (dist?.features ?? []).map((f) => f.properties),
          green: (green?.features ?? []).map((f) => f.properties).filter((p) => p.t === 'green'),
          health: health?.items ?? [],
          seg: seg?.features?.length ?? 0,
        });
        setLoaded(true);
      });
  }, []);

  const rain72 = useMemo(
    () => (d.rain?.recent ?? []).slice(-3).reduce((a, x) => a + (x.precipitationSumMm ?? 0), 0),
    [d.rain],
  );
  const wet = rain72 >= 1;

  const health = useMemo(() => {
    const t = {};
    for (const h of d.health) t[h.status] = (t[h.status] ?? 0) + 1;
    return t;
  }, [d.health]);
  const assessed = d.health.length;
  const needsAttention = (health.dead ?? 0) + (health.declining ?? 0) + (health.water_stress ?? 0);

  return (
    <main className="pg">
      <header className="pg-head">
        <div>
          <h1>نظرة عامة</h1>
          <p>
            أمانة منطقة المدينة المنورة ·{' '}
            {d.meta?.generatedAt
              ? <>آخر تحديث <span className="num">{d.meta.generatedAt.slice(0, 10)}</span></>
              : '—'}
          </p>
        </div>
      </header>

      <div className="pg-body">
        {/* the condition that decides how everything else is read */}
        <div className={`banner${wet ? ' wet' : ''}`}>
          <div className="banner-k">{wet ? 'حالة مطرية' : 'بلا مطر'}</div>
          <div className="banner-v">
            <span className="num">{loaded ? fmt(rain72, 1) : '—'}</span> ملم خلال ٧٢ ساعة
          </div>
          <p>
            {wet
              ? 'الماء الظاهر على الأسفلت الآن يُقرأ ضعف تصريف، لا هدر ريّ. المقاطع التي يبقى ماؤها بعد ٤٨ ساعة هي المرشّحة للفحص.'
              : 'أي ماء على حزام التماس الآن لا يُفسَّر بالمطر — يُقرأ ريّاً مفرطاً أو تسرّباً. هذه أفضل نافذة لرصد الهدر.'}
          </p>
        </div>

        <div className="ov-grid">
          <Tile href="/dashboard/districts" k="حيّاً" v={loaded ? fmt(d.districts.length) : '—'}
                s="مغطّاة بالكامل" />
          <Tile href="/dashboard/segments" k="مقطع شارع" v={loaded ? fmt(d.seg) : '—'}
                s={`${fmt(d.meta?.networkKm ?? 5280)} كم من الشبكة`} c="var(--lp-water)" />
          <Tile href="/dashboard/green" k="أصل أخضر" v={loaded ? fmt(d.green.length) : '—'}
                s="حدائق ومسطّحات" c="var(--lp-signal)" />
          <Tile href="/dashboard/rain" k="حدث مطري" v={loaded ? fmt(d.rain?.events?.length) : '—'}
                s="منذ ٢٠١٥ — أساس التحقّق" c="var(--sev-1)" />
        </div>

        <section className="card2">
          <div className="card2-h">
            <h2>صحة المسطّحات الخضراء</h2>
            <Link href="/dashboard/green" className="dt-go">عرض الكل ←</Link>
          </div>
          {assessed ? (
            <div className="card2-b">
              <div className="hbar">
                {[
                  ['healthy', 'سليم', 'var(--lp-signal)'],
                  ['water_stress', 'إجهاد ريّ', 'var(--sev-1)'],
                  ['sparse', 'متفرّق', 'var(--sev-1)'],
                  ['declining', 'متدهور', 'var(--sev-2)'],
                  ['dead', 'فقد الغطاء', 'var(--sev-3)'],
                  ['bare', 'أرض غير مزروعة', '#66739a'],
                  ['not_assessable', 'خارج نطاق التقييم', '#3d4766'],
                  ['insufficient_data', 'رصد غير كافٍ', 'var(--lp-fg-3)'],
                ].filter(([k]) => health[k]).map(([k, label, c]) => (
                  <span key={k} className="hseg" style={{ flex: health[k], background: c }}
                        title={`${label}: ${health[k]}`} />
                ))}
              </div>
              <p className="card2-note">
                <span className="num">{fmt(needsAttention)}</span> أصلاً يحتاج تدخّلاً من أصل{' '}
                <span className="num">{fmt(assessed)}</span> مُقيَّم.
              </p>
            </div>
          ) : (
            <div className="card2-b">
              <p className="card2-note">
                لم يُشغَّل تقييم الصحة بعد. يعتمد على سلسلة NDVI و NDMI الزمنية التي يبنيها
                <code> backfill-s2</code> ثم <code> build-health</code>. حتى ذلك الحين لا تُعرض
                أي حالة — وأصل لم يُقيَّم ليس أصلاً سليماً.
              </p>
            </div>
          )}
        </section>

        <p className="dnote">
          دورة إعادة الزيارة <b>أيام</b> والسيل الومضي <b>ساعات</b> — فالقمر ليس نظام إنذار
          لحظي. وظيفته خريطة القابلية والتحقّق بعد الحدث؛ الإنذار اللحظي من تنبّؤ الطقس
          مضروباً في تلك الخريطة.
        </p>
      </div>
    </main>
  );
}

function Tile({ href, k, v, s, c }) {
  return (
    <Link href={href} className="ov-tile">
      <div className="v num" style={c ? { color: c } : undefined}>{v}</div>
      <div className="k">{k}</div>
      <div className="s">{s}</div>
    </Link>
  );
}
