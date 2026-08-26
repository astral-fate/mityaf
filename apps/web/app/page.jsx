import Link from 'next/link';

export const metadata = {
  title: 'مِطياف — منصّة رصد المياه الحضرية بالأقمار الصناعية',
};

const STATS = [
  { v: '324', l: 'أصل أخضر تحت الرصد' },
  { v: '30,326', l: 'مقطع شارع مُحلَّل' },
  { v: '5,272', l: 'كم من شبكة الطرق' },
  { v: '11', l: 'سنة من الأرشيف الفضائي' },
];

const STEPS = [
  {
    n: '١',
    t: 'نرصد',
    d: 'أقمار Sentinel-2 البصرية وSentinel-1 الرادارية تمرّ فوق المدينة كل خمسة أيام. الرادار يخترق السحب والظلام — وهو ما نحتاجه بالضبط وقت المطر.',
  },
  {
    n: '٢',
    t: 'نفصل',
    d: 'الماء على الأسفلت يبدو واحداً في الصورة. سؤال واحد يفصله: هل أمطرت خلال 72 ساعة؟ بلا مطر ← هدر ريّ. بعد مطر ← ضعف تصريف.',
  },
  {
    n: '٣',
    t: 'نُرتّب',
    d: 'لكل مقطع شارع درجة مخاطر مبنية على التضاريس والجريان والنفاذية وتاريخ الغرق المرصود — مع الأدلة التي بُنيت عليها.',
  },
  {
    n: '٤',
    t: 'نتحقّق',
    d: 'أرشيف الرادار منذ 2014 يحمل صورة «قبل» و«بعد» لكل مشروع تصريف نُفّذ. نقيس أثره فعلياً، لا من تقرير المقاول.',
  },
];

const VALUE = [
  {
    icon: '💧',
    t: 'ماء لا يُهدَر',
    d: 'كشف الري المفرط من الفضاء عبر «حزام التماس» — شريط الأسفلت الملاصق للمسطّح الأخضر. ماء عليه في يوم بلا مطر ليس التباساً، بل مخالفة.',
  },
  {
    icon: '🛣️',
    t: 'طرق تدوم',
    d: 'الماء المتسرّب أسفل الأسفلت يفكّك طبقة الأساس ويُقصّر عمر الطريق. رصده مبكراً يحمي أصلاً أغلى من الماء نفسه.',
  },
  {
    icon: '🎯',
    t: 'إنفاق موجَّه',
    d: 'المملكة نفّذت أكثر من 8 ملايين متر طولي من شبكات التصريف. نحدّد أين يذهب المتر التالي — بالأدلة، لا بالشكاوى.',
  },
  {
    icon: '📡',
    t: 'صفر عتاد',
    d: 'لا مستشعرات تُركَّب أو تُصان أو تُسرَق. تكلفة رصد الأصل الثالث والعشرين بعد الثلاثمئة تساوي صفراً.',
  },
];

export default function Landing() {
  return (
    <main>
      {/* ── hero ── */}
      <section className="hero">
        <div className="hero-inner">
          <p className="hero-eyebrow">
            برمجان المنورة <span className="num">2026</span> · مسار المتابعة الذكية للخدمات
          </p>
          <h1 className="hero-title">
            في المدينة، الماء إمّا
            <br />
            <span className="g-neon">يُهـدَر</span> على الأسفلت…
            <br />
            أو <span className="g-cyan">يُحـاصَـر</span> فيه.
          </h1>
          <p className="hero-sub">
            والاثنان — رغم تناقضهما — يظهران في <strong>الصورة نفسها</strong> من القمر الصناعي.
            لا نحتاج نظامين، بل أن نقرأ الصورة قراءةً صحيحة.
          </p>
          <div className="hero-cta">
            <Link href="/dashboard" className="btn btn-primary">
              افتح لوحة الرصد ←
            </Link>
            <Link href="/method" className="btn btn-ghost">
              كيف يعمل؟
            </Link>
          </div>
        </div>

        <div className="hero-stats">
          {STATS.map((s) => (
            <div className="hero-stat" key={s.l}>
              <div className="v num">{s.v}</div>
              <div className="l">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── the discriminator ── */}
      <section className="band">
        <div className="wrap">
          <p className="eyebrow">الفكرة الجوهرية</p>
          <h2 className="sec-title">سؤال واحد يفصل مشكلتين</h2>
          <p className="sec-lede">
            المسطّح الأخضر الذي يفيض ماؤه على الشارع، والشارع الذي يحتجز ماء المطر — كلاهما
            «ماء على سطح غير نفّاذ في مكان غير مقصود». القمر الصناعي لا يفرّق بينهما في صورة
            واحدة. الطقس يفرّق.
          </p>

          <div className="splitter">
            <div className="splitter-q">هل أمطرت خلال ٧٢ ساعة؟</div>
            <div className="splitter-arms">
              <div className="arm arm-a">
                <div className="arm-tag">لا</div>
                <h3>وحدة الهَدْر</h3>
                <p>ماء بلا مطر = ريّ مفرط أو تسرّب</p>
                <span className="arm-out">← ترشيد الري وحماية الطريق</span>
              </div>
              <div className="arm arm-b">
                <div className="arm-tag">نعم</div>
                <h3>وحدة الغَرَق</h3>
                <p>ماء بعد مطر + بطء انحسار = ضعف تصريف</p>
                <span className="arm-out">← استهداف الإنفاق وإنذار مبكر</span>
              </div>
            </div>
          </div>

          <p className="note-inline">
            في المدينة المنورة <strong className="num">2.3٪</strong> فقط من الأيام ممطرة — أي أن
            بوابة «بلا مطر» مفتوحة دائماً تقريباً، ووحدة الهدر تعمل في كل مرور للقمر.
          </p>
        </div>
      </section>

      {/* ── how it works ── */}
      <section className="band alt">
        <div className="wrap">
          <p className="eyebrow">كيف يعمل</p>
          <h2 className="sec-title">من الصورة الفضائية إلى أمر التشغيل</h2>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <div className="step-n">{s.n}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── value ── */}
      <section className="band">
        <div className="wrap">
          <p className="eyebrow">القيمة</p>
          <h2 className="sec-title">حلٌّ واحد، أثرٌ مضاعف</h2>
          <div className="cards4">
            {VALUE.map((v) => (
              <div className="vcard" key={v.t}>
                <div className="vicon" aria-hidden="true">{v.icon}</div>
                <h3>{v.t}</h3>
                <p>{v.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── honesty ── */}
      <section className="band alt">
        <div className="wrap narrow">
          <p className="eyebrow">بصراحة</p>
          <h2 className="sec-title">ما لا ندّعيه</h2>
          <p className="sec-lede">
            دورة إعادة الزيارة <strong>أيام</strong>، والسيل الومضي <strong>ساعات</strong>. القمر
            الصناعي ليس نظام إنذار لحظي، ولن يكون. وظيفته بناء خريطة القابلية والتحقّق بعد
            الحدث؛ والإنذار اللحظي يأتي من تنبّؤ الطقس مضروباً في تلك الخريطة.
          </p>
          <ul className="denylist">
            <li>لا إنذار لحظي بالسيل من الفضاء</li>
            <li>لا قياس لعمق المياه بالسنتيمتر</li>
            <li>لا بديل عن النمذجة الهيدروليكية في التصميم</li>
            <li>لا حكم في المناطق العمياء للرادار — تُعرَض «غير قابلة للتقييم»</li>
          </ul>
          <p className="note-inline">
            الماء الذي ينحسر خلال ساعتين هو طقس. الماء الباقي بعد ٤٨ ساعة هو <strong>عيب</strong>.
            إيقاع القمر الصناعي أعمى عن العابر، ومطابق تماماً للمزمن — وهذا تعريف المنتج، لا قصور فيه.
          </p>
        </div>
      </section>

      {/* ── cta ── */}
      <section className="cta-band">
        <div className="wrap narrow">
          <h2 className="cta-title">الأمانة تبني الحلّ بالفعل.</h2>
          <p className="cta-sub">
            نحن نضيف العين التي تُخبرها <span className="g-neon">أين تبني</span>، و
            <span className="g-cyan">هل نجحت</span>.
          </p>
          <Link href="/dashboard" className="btn btn-primary btn-lg">
            افتح لوحة الرصد ←
          </Link>
        </div>
      </section>

      <footer className="site-footer">
        <div className="wrap">
          <p>
            بيانات: Copernicus Sentinel-1/2 و DEM (ESA) · Landsat (USGS/NASA) ·
            OpenStreetMap contributors (ODbL) · Open-Meteo (CC-BY) · البيانات المفتوحة لأمانة
            منطقة المدينة المنورة.
          </p>
          <p className="dim2">مِطياف · برمجان المنورة <span className="num">2026</span></p>
        </div>
      </footer>
    </main>
  );
}
