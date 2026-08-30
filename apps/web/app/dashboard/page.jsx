'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  fmt, loadIncidents, loadMeta, loadPondingDistricts, loadPondingShortlist,
  loadRain,
} from '@/lib/data';
import { MECHANISMS, MECHANISM_ORDER } from '@/lib/mechanisms';

/**
 * Overview — the page that answers "what should I care about today".
 *
 * Deliberately not a second map and not another table. It states the rain
 * condition, which decides how everything else on the platform is read, and
 * then points at the view that answers each question.
 *
 * It used to lead with green-asset health, which is a different module of a
 * different product: the first thing a visitor saw was «696 أصل أخضر», and
 * nothing about ponding. What belongs here is the shortlist, the three
 * mechanisms, the districts that carry them and the dated record — the things
 * this platform is actually for. Green health is still reachable from the
 * sidebar; it is simply no longer the headline.
 */
export default function Overview() {
  const [d, setD] = useState({
    meta: null, rain: null, districts: [], shortlist: null, incidents: [],
    seg: 0, bands: {},
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Deliberately NOT loading segments.geojson. This page needs a feature
    // count and four band tallies; fetching 9 MB and parsing it (~200 ms on the
    // main thread) to derive four integers made the first page anyone opens the
    // slowest. The pipeline now writes them into meta.json, which is 2 KB.
    Promise.all([
      loadMeta(), loadRain(), loadPondingDistricts(), loadPondingShortlist(),
      loadIncidents(),
    ]).then(([meta, rain, dist, shortlist, inc]) => {
      setD({
        meta,
        rain,
        districts: (dist?.features ?? []).map((f) => f.properties),
        shortlist,
        incidents: inc?.items ?? [],
        seg: meta?.segmentCount ?? 0,
        bands: meta?.segmentBands ?? {},
      });
      setLoaded(true);
    });
  }, []);

  const rain72 = useMemo(
    () => (d.rain?.recent ?? []).slice(-3)
      .reduce((a, x) => a + (x.precipitationSumMm ?? 0), 0),
    [d.rain],
  );
  const wet = rain72 >= 1;

  const byMech = d.shortlist?.byMechanism ?? {};
  const shortlistN = d.shortlist?.count ?? 0;

  // Districts ordered by how much work they carry, not by name.
  const topDistricts = useMemo(
    () => [...d.districts]
      .filter((x) => x.shortlistCount > 0)
      .sort((a, b) => b.shortlistCount - a.shortlistCount)
      .slice(0, 8),
    [d.districts],
  );

  const corroborated = d.incidents.filter((i) => i.corroborated).length;
  const recent = useMemo(
    () => [...d.incidents]
      .sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1))
      .slice(0, 6),
    [d.incidents],
  );

  const critical = (d.bands.critical ?? 0) + (d.bands.high ?? 0);

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
              ? 'الماء الظاهر على الأسفلت الآن يُقرأ ضعف تصريف. المقاطع التي يبقى ماؤها بعد ٤٨ ساعة هي المرشّحة للفحص، وترتيبها جاهز قبل نزول القطرة.'
              : 'لا مطر الآن — وهذه أفضل نافذة للعمل الهندسي: الترتيب محسوب من شكل الأرض لا من البلاغات، فهو جاهز قبل الموسم لا بعده.'}
          </p>
        </div>

        <div className="ov-grid">
          <Tile href="/dashboard/segments" k="مقطع شارع مُقيَّم"
                v={loaded ? fmt(d.seg) : '—'}
                s={`${fmt(d.meta?.networkKm ?? 5280)} كم من الشبكة`}
                c="var(--lp-water)" />
          <Tile href="/dashboard/segments?band=critical" k="مقطعاً مرشّحاً للفحص"
                v={loaded ? fmt(shortlistN) : '—'}
                s={loaded ? `${((shortlistN / (d.seg || 1)) * 100).toFixed(1)}% من الشبكة` : '—'}
                c="var(--sev-2)" />
          <Tile href="/dashboard/districts" k="حيّاً مغطّى"
                v={loaded ? fmt(d.districts.length) : '—'}
                s={loaded ? `${fmt(topDistricts.length ? d.districts.filter((x) => x.shortlistCount > 0).length : 0)} منها عليه عمل` : '—'} />
          <Tile href="/dashboard/cases" k="واقعة مؤرَّخة"
                v={loaded ? fmt(d.incidents.length) : '—'}
                s={loaded ? `${fmt(corroborated)} مؤكَّدة بمصدرين` : '—'}
                c="var(--lp-signal)" />
        </div>

        {/* ── the three mechanisms: what kind of work each shortlist item is ── */}
        <section className="card2">
          <div className="card2-h">
            <h2>آليّات تجمّع المياه</h2>
            <Link href="/dashboard/map" className="dt-go">على الخريطة ←</Link>
          </div>
          <div className="card2-b">
            {shortlistN ? (
              <>
                <div className="hbar">
                  {MECHANISM_ORDER.filter((k) => byMech[k]).map((k) => (
                    <span key={k} className="hseg"
                          style={{ flex: byMech[k], background: MECHANISMS[k].color }}
                          title={`${MECHANISMS[k].ar}: ${byMech[k]}`} />
                  ))}
                </div>
                <div className="mech-legend">
                  {MECHANISM_ORDER.filter((k) => byMech[k]).map((k) => (
                    <div key={k} className="mech-item">
                      <i style={{ background: MECHANISMS[k].color }} />
                      <div>
                        <b className="num">{fmt(byMech[k])}</b>
                        <span>{MECHANISMS[k].ar}</span>
                        <em>{MECHANISMS[k].actionAr}</em>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="card2-note">
                  لكل آليّة علاجٌ مختلف وميزانية مختلفة — والخلط بينها يصرف الميزانية
                  على الحلّ الخطأ. والباقي من الشبكة له رتبة بلا تصنيف: لا تنطبق
                  عليه أيٌّ من القواعد الثلاث.
                </p>
              </>
            ) : (
              <p className="card2-note">جارٍ التحميل…</p>
            )}
          </div>
        </section>

        {/* ── where the work is ── */}
        <section className="card2">
          <div className="card2-h">
            <h2>الأحياء الأولى بالفحص</h2>
            <Link href="/dashboard/districts" className="dt-go">كل الأحياء ←</Link>
          </div>
          <div className="card2-b">
            {topDistricts.length ? (
              <>
                {topDistricts.map((x) => (
                  <Link key={x.id} href={`/dashboard/segments?district=${encodeURIComponent(x.name)}`}
                        className="dist-row">
                    <span className="dr-name">{x.name}</span>
                    <span className="dr-bar">
                      <i style={{
                        width: `${(x.shortlistCount / topDistricts[0].shortlistCount) * 100}%`,
                      }} />
                    </span>
                    <b className="num">{fmt(x.shortlistCount)}</b>
                    {x.incidentCount ? (
                      <em className="dr-inc num" title="وقائع مؤرَّخة في هذا الحي">
                        {x.incidentCount} واقعة
                      </em>
                    ) : <em className="dr-inc muted">—</em>}
                  </Link>
                ))}
                <p className="card2-note">
                  الترتيب بعدد المقاطع المرشّحة للفحص. عمود الوقائع يبيّن أين يوجد
                  سجلٌّ مؤرَّخ فعلاً — وغيابه ليس غياب غرق، بل غياب بلاغ.
                </p>
              </>
            ) : (
              <p className="card2-note">جارٍ التحميل…</p>
            )}
          </div>
        </section>

        {/* ── the dated record ── */}
        <section className="card2">
          <div className="card2-h">
            <h2>آخر الوقائع المؤرَّخة</h2>
            <Link href="/dashboard/cases" className="dt-go">كل الوقائع ←</Link>
          </div>
          <div className="card2-b">
            {recent.length ? (
              <>
                {recent.map((i, n) => (
                  <div className="kv" key={`${i.date}-${n}`}>
                    <span>
                      <b className="num" dir="ltr">{String(i.date).slice(0, 10)}</b>
                      {' · '}{i.district && i.district !== '—' ? i.district : 'حي غير محدَّد'}
                    </span>
                    <b>
                      {i.place}
                      {i.corroborated ? <em className="corr"> ✓</em> : null}
                    </b>
                  </div>
                ))}
                <p className="card2-note">
                  <span className="num">{fmt(corroborated)}</span> من{' '}
                  <span className="num">{fmt(d.incidents.length)}</span> واقعة مؤكَّدة
                  بمصدرين مستقلّين. هذه هي كل الحقيقة الأرضية المتاحة —
                  والنظام لم يُدرَّب عليها.
                </p>
              </>
            ) : (
              <p className="card2-note">جارٍ التحميل…</p>
            )}
          </div>
        </section>

        <p className="dnote">
          دورة إعادة الزيارة <b>أيام</b> والسيل الومضي <b>ساعات</b> — فالقمر ليس نظام إنذار
          لحظي. وظيفته خريطة القابلية والتحقّق بعد الحدث؛ الإنذار اللحظي من تنبّؤ الطقس
          مضروباً في تلك الخريطة. و{fmt(critical)} مقطعاً في النطاقين الحرج والمرتفع.
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
