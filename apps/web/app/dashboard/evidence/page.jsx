'use client';

/**
 * The evidence view: what is actually known, and how it was checked.
 *
 * Ordered as an argument rather than a dashboard. A resident named a street;
 * the elevation model had already found a basin there; the rainfall record
 * confirmed the dates independently. Everything else on this site is a
 * prediction, and this page is the only place a measured claim appears.
 */
import { useEffect, useState } from 'react';
import { loadBasin, loadIncidents, loadPondingRain, fmt } from '@/lib/data';
import { MECHANISMS, MECHANISM_ORDER } from '@/lib/mechanisms';

export default function Evidence() {
  const [basin, setBasin] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [rain, setRain] = useState([]);

  useEffect(() => {
    loadBasin().then(setBasin);
    loadIncidents().then((d) => setIncidents(d?.items ?? []));
    loadPondingRain().then((d) => setRain(d?.items ?? []));
  }, []);

  if (!basin) return <main className="pg"><div className="pg-loading">جارٍ التحميل…</div></main>;

  const confirmed = incidents.filter((i) => i.corroborated);
  const unconfirmed = incidents.length - confirmed.length;

  return (
    <main dir="rtl" className="pg evidence">
      <header className="pg-head">
        <div>
          <h1>الأدلّة الميدانية</h1>
          <p>ما هو مقيس فعلياً، وكيف جرى التحقّق منه — لا تنبّؤ في هذه الصفحة إلّا ما قيل إنّه تنبّؤ.</p>
        </div>
      </header>

      <div className="pg-body">
        {/* 1. the prediction that landed */}
        <section className="panel highlight">
          <h2>حوض حي الملك فهد</h2>
          <p>
            حُسب أعمق نقطة في الحوض من نموذج الارتفاع الرقمي عند
            <b> {basin.core.lat.toFixed(4)}، {basin.core.lon.toFixed(4)} </b>
            قبل وصول الإحداثي الثالث من الساكن. ثم جاء الإحداثي عند
            <b> 24.5037، 39.7022 </b> — على بُعد <b>٣٨ متراً</b> فقط من النقطة التي
            توقّعها النموذج مسبقاً.
          </p>
          <ul className="evidence-facts">
            <li><b className="num">{fmt(basin.segmentCount)}</b> مقطع شارع داخل المنخفض</li>
            <li>أقصى عمق <b className="num">{fmt(basin.maxSinkM, 2)}</b> م</li>
            <li>الميل الوسيط <b className="num">{fmt(basin.medianSlopeDeg, 2)}</b>° — ضمن أقلّ ١٪ انحداراً في المدينة</li>
            <li>الارتفاع فوق المجرى <b className="num">{fmt(basin.medianHandM, 2)}</b> م — أي تحت خطّ التصريف المحلّي</li>
          </ul>
        </section>

        {/* 2. the register */}
        <section className="panel">
          <h2>سجلّ البلاغات</h2>
          <p>
            <b className="num">{fmt(incidents.length)}</b> بلاغاً مؤرّخاً من أربعة مصادر مستقلّة
            (صحف، منصّة X، بلاغات ساكن، وبحث ميداني)، منها
            <b className="num"> {fmt(confirmed.length)} </b> مؤكّدة بسجلّ الأمطار المستقلّ،
            و<b className="num">{fmt(unconfirmed)}</b> غير مؤكّدة — تُعرض ولا تُحذف.
          </p>
          <div className="dt-scroll evidence-table-wrap">
            <table className="dt-table evidence-register">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الحي</th>
                  <th>المكان</th>
                  <th>ERA5 (ملم)</th>
                  <th>NASA POWER (ملم)</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={`${i.date}-${i.place}`} className={i.corroborated ? 'confirmed' : 'unverified'}>
                    <td className="num">{i.date}</td>
                    <td>{i.district ?? '—'}</td>
                    <td className="place">{i.place ?? '—'}</td>
                    <td className="num">{fmt(i.era5_peak_mm, 1)}</td>
                    <td className="num">{fmt(i.power_peak_mm, 1)}</td>
                    <td>
                      {i.corroborated ? (
                        <span className="verified-badge">✔ مؤكّد ({i.which_source})</span>
                      ) : (
                        <span className="unverified-badge">بلاغ غير مؤكّد</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            البلاغات غير المؤكّدة تُعرض بجانب المؤكّدة عمداً: أغلبها يقع في أشهر الصيف حيث يسجّل
            ERA5 صفر (٠٫٠٠) أيام فوق ٥ ملم عبر ١١٫٧ سنة، بينما قاست NASA POWER ٢٧٫٥ ملم في
            ٣٠ أغسطس ٢٠٢٤ — وهو يوم صُوّر فيه غرق الشوارع فعلياً. أربعة بلاغات مؤكّدة بمصدر
            NASA POWER وحده تحديداً، لأنّ ERA5 لا يرصد ذلك اليوم أصلاً.
          </p>
          <p className="hint">
            حيّ الغربية هو الموضع الوحيد الذي وثّقت له مدّة بقاء الماء — حتى خمسة أيام، بحسب
            صحيفة المدينة (١٩ نوفمبر ٢٠١٥). هذا الحيّ غير موجود ضمن بيانات الـ٩١ حيّاً في هذه
            المنصّة، ولذلك لا يمكن التحقّق من ترتيبه أو فحص تنبّؤاته — وهو ما تُظهره خانة
            "الحي" أعلاه بعلامة "—" في البلاغات التي لا تحمل حيّاً مطابقاً.
          </p>
        </section>

        {/* 3. the three mechanisms */}
        <section className="panel">
          <h2>ثلاث آليات، ثلاثة حلول</h2>
          <div className="mech-grid">
            {MECHANISM_ORDER.map((k) => (
              <div key={k} className="mech-card" style={{ borderColor: MECHANISMS[k].color }}>
                <h3 style={{ color: MECHANISMS[k].color }}>{MECHANISMS[k].ar}</h3>
                <p className="hint">{MECHANISMS[k].hint}</p>
                <p className="action">الإجراء المقترح: {MECHANISMS[k].actionAr}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 4. the honest caveat, not in small print */}
        <section className="panel caution">
          <h2>ما لم يُختبر</h2>
          <p>
            لا يوجد سجلّ غرق مُعتمَد في المدينة المنورة، ولذلك لم يُدرَّب أيّ نموذج عليها
            ولم يُختبر عليها. كلّ ترتيب أو درجة معروضة في هذه المنصّة — في الأحياء، المقاطع،
            أو الخريطة — تنبّؤ لا احتمال غرق، والدليل الوحيد المقيس هنا هو حوض حيّ الملك فهد
            أعلاه و<b className="num">{fmt(confirmed.length)}</b> بلاغاً مؤكّداً بسجلّ الأمطار.
          </p>
          <p>
            و<b className="num">{fmt(rain.length)}</b> يوماً سجّل فيه المطر أكثر من ٥ ملم منذ
            ٢٠١٥ دون أن يقابله أيّ بلاغ — وهي أيضاً تنبّؤات قابلة للفحص الميداني، لا تأكيدات.
          </p>
        </section>
      </div>
    </main>
  );
}
