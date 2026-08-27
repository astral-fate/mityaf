import Link from 'next/link';
import './landing.css';
import HeroScene from '../components/HeroScene';
import AlertStack from '../components/AlertStack';

export const metadata = {
  title: 'مِطياف — رصد مياه المدينة من المدار',
  description:
    'رصد مستمر لتصريف الأمطار وهدر الري في المدينة المنورة من الأقمار الصناعية، يُخرج قائمة عمل مرتّبة بالأولوية — بلا مستشعر واحد.',
};

const METRICS = [
  { v: '٣٢٤', l: 'أصلاً أخضر مبنيّاً في قاعدة البيانات' },
  { v: '٣٠٬٣٣٧', l: 'مقطع شارع جاهز للترتيب' },
  { v: '٥٬٢٨٠', l: 'كيلومتراً من شبكة الطرق' },
  { v: '١١', l: 'سنة من الأرشيف الفضائي' },
  { v: '٠', l: 'مستشعراً يُركَّب في الأرض', hi: true },
];

const TODAY = [
  {
    t: 'المعرفة تصل بعد الضرر',
    d: 'يُعرف الغرق حين يتّصل مواطن بـ٩٤٠ أو يرفع بلاغاً في بلدي. البلاغ يصل بعد أن يقف الماء، ومن الأحياء التي يبلّغ سكانها — لا من الأحياء التي فيها المشكلة.',
    m: 'التغطية تتبع من يشتكي، لا أين تقع المشكلة',
  },
  {
    t: 'الجولة الميدانية لا تسع المدينة',
    d: 'الفرق تمسح ما تستطيع الوصول إليه في يومها. شبكة المدينة ٣٠٬٣٣٧ مقطع شارع، والجولة تلمس جزءاً صغيراً منها؛ الباقي يبقى مجهولاً حتى الحادثة التالية.',
    m: 'ما لا يُزار لا يُعرف حاله',
  },
  {
    t: 'يُبنى الكثير، ولا يُقاس الأثر',
    d: 'نُفّذ في المملكة أكثر من ٨ ملايين متر طولي من شبكات تصريف الأمطار. لا توجد أداة مستقلة تقول أي متر منها غيّر سلوك الشارع فعلاً بعد التشغيل.',
    m: 'التحقّق يأتي من تقرير المنفّذ نفسه',
  },
];

const IMPACT = [
  {
    who: 'أمانة منطقة المدينة المنورة',
    role: 'إدارة الطرق وتصريف مياه الأمطار',
    q: 'أين يذهب المتر التالي من الشبكة؟',
    a: 'قائمة مقاطع مرتّبة بالأولوية، لكل مقطع حِمله الهيدرولوجي وتاريخ غرقه المرصود من الأرشيف والإجراء المقترح — بدل انتظار البلاغ الأول من الحيّ.',
  },
  {
    who: 'إدارة الحدائق والتشجير',
    role: 'تشغيل وصيانة المسطّحات الخضراء',
    q: 'أي موقع يُعاد ضبط ريّه هذا الأسبوع؟',
    a: 'المواقع التي خرج ماؤها إلى الأسفلت المجاور في أيام بلا مطر، مرتّبة بالخطورة، مع سلسلة زمنية تُظهر متى بدأ الخلل — لا متى لاحظه أحد.',
  },
  {
    who: 'وزارة البلديات والإسكان',
    role: 'متابعة أداء المشاريع المنفّذة',
    q: 'هل نجح ما بنيناه؟',
    a: 'مقارنة مستقلة قبل/بعد مبنيّة على أرشيف رادار يعود إلى ٢٠١٤. المشروع الذي نُفّذ عام ٢٠٢٠ له صورة «قبل» محفوظة سلفاً، سواء طلبها أحد وقتها أو لم يطلبها.',
  },
  {
    who: 'ساكن المدينة وزائرها',
    role: 'المستفيد النهائي',
    q: '—',
    a: 'شارع يُعالَج قبل أن يغرق، لا بعد أن يغرق. والمياه التي كانت تسيل على الأسفلت تعود إلى ما زُرعت لأجله.',
  },
];

const ECON = [
  {
    t: 'التكلفة الحدّية صفر',
    d: 'الصورة الواحدة تغطي المدينة كاملة. رصد الأصل رقم ٣٢٥ يكلّف ما كلّفه رصد الأصل الأول: لا شيء. المستشعر الأرضي يكلّف لكل وحدة، إلى الأبد.',
  },
  {
    t: 'مصدر بيانات مضمون',
    d: 'كوبرنيكوس برنامج أوروبي عام ممول لما بعد ٢٠٣٥، والأسطول يتجدّد — أُطلق Sentinel-2C في ٢٠٢٤ وSentinel-1C في ديسمبر ٢٠٢٤. لا اشتراك يُلغى ولا مورّد ينسحب.',
  },
  {
    t: 'يعمل بأثر رجعي',
    d: 'الأرشيف موجود سلفاً منذ ٢٠١٤. لا انتظار سنة لتراكم البيانات: أول يوم تشغيل يعطي إحدى عشرة سنة من التاريخ دفعةً واحدة.',
  },
  {
    t: 'ينتقل بلا إعادة بناء',
    d: 'المدخلات عالمية — القمر نفسه يمرّ فوق كل أمانة. ما يعمل في المدينة المنورة ينتقل إلى أي منطقة أخرى بتغيير حدود، لا بتغيير معمارية.',
  },
];

export default function Landing() {
  return (
    <main className="lp">
      {/* ── hero ─────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-media">
          <img src="/img/madinah-hero.jpg" alt="صورة قمر صناعي للمدينة المنورة" />
          <HeroScene />
        </div>
        <div className="lp-hero-scrim" />
        <span className="lp-hero-tag">Sentinel-2 · 10 m · Copernicus / EOX</span>

        <div className="lp-hero-inner">
          <div className="lp-hero-col">
            <p className="lp-kicker">
              <i />
              أمانة منطقة المدينة المنورة · المتابعة الذكية للخدمات
            </p>

            <h1 className="lp-h1">
              رصدٌ مستمر لمياه المدينة — <em>بلا مستشعر واحد</em>
            </h1>

            <p className="lp-hero-sub">
              يحوّل <strong>مِطياف</strong> مرور الأقمار الصناعية فوق المدينة المنورة إلى قائمة
              عمل مرتّبة: أي شارع يحتاج تصريفاً قبل المطر القادم، وأي مسطّح أخضر يُهدر ماءه
              اليوم — ولماذا، وبأي دليل.
            </p>

            <div className="lp-hero-cta">
              <Link href="/dashboard" className="lp-btn lp-btn-primary">
                افتح لوحة الرصد
              </Link>
              <a href="#stack" className="lp-btn lp-btn-ghost">
                كيف يُبنى تنبيه؟
              </a>
            </div>

            <div className="lp-sources">
              <b>يعمل على:</b>
              <span>Sentinel-2 البصري</span>
              <span>Sentinel-1 الراداري</span>
              <span>Copernicus DEM</span>
              <span>Open-Meteo</span>
              <span>OpenStreetMap</span>
            </div>
          </div>
        </div>
      </section>

      <div className="lp-metrics">
        {METRICS.map((m) => (
          <div className={`lp-metric${m.hi ? ' hi' : ''}`} key={m.l}>
            <div className="v">{m.v}</div>
            <div className="l">{m.l}</div>
          </div>
        ))}
      </div>

      {/* ── the problem, operationally ───────────────────── */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <p className="lp-eyebrow">الوضع اليوم</p>
          <h2 className="lp-h2">المشكلة ليست في التنفيذ. المشكلة أنّ أحداً لا يرى.</h2>
          <p className="lp-lede">
            الأمانة تبني شبكات التصريف وتوسّع المسطّحات الخضراء. لكن القرار — أين يُبنى المتر
            التالي، وأي موقع يُعاد ضبط ريّه — يُتّخذ اليوم على معلومة تصل متأخّرة وناقصة.
          </p>

          <div className="lp-today">
            {TODAY.map((c) => (
              <div key={c.t}>
                <h3>{c.t}</h3>
                <p>{c.d}</p>
                <div className="metric">{c.m}</div>
              </div>
            ))}
          </div>

          <p className="lp-turn">
            المدينة تُصوَّر من المدار كل خمسة أيام منذ عام ٢٠١٤، مجاناً.
            <b> الصور موجودة بالفعل — الغائب هو قراءتها.</b>
          </p>
        </div>
      </section>

      {/* ── the alert stack ──────────────────────────────── */}
      <section className="lp-sec alt" id="stack">
        <div className="lp-wrap">
          <p className="lp-eyebrow">داخل المنتج</p>
          <h2 className="lp-h2">كيف يُبنى تنبيه واحد</h2>
          <p className="lp-lede">
            التنبيه ليس بكسلاً أزرق على خريطة. إنه ستّ طبقات تتراكب حتى تصير أمر تشغيل يمكن
            لمهندس أن يتصرّف بناءً عليه — وأن يراجع كل طبقة فيه.
          </p>
          <AlertStack />
        </div>
      </section>

      {/* ── the two modules ──────────────────────────────── */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <p className="lp-eyebrow">وحدتان، منصّة واحدة</p>
          <h2 className="lp-h2">سؤال واحد يفصل مشكلتين متناقضتين</h2>
          <p className="lp-lede">
            المسطّح الأخضر الذي يفيض ماؤه على الشارع، والشارع الذي يحتجز ماء المطر — كلاهما
            «ماء على سطح غير نفّاذ». القمر لا يفرّق بينهما في الصورة الواحدة.
            <strong> الطقس يفرّق.</strong> ولأن ٢٫٣٪ فقط من أيام المدينة ممطرة، فبوابة «بلا
            مطر» مفتوحة في كل مرور تقريباً.
          </p>

          <div className="lp-mods">
            <article className="lp-mod a">
              <div className="lp-mod-fig">
                <img src="/img/madinah-core.jpg" alt="" />
                <svg viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <radialGradient id="lp-ring-g">
                      <stop offset="55%" stopColor="#50ff4a" stopOpacity="0" />
                      <stop offset="78%" stopColor="#50ff4a" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="#50ff4a" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <circle cx="80" cy="45" r="30" fill="url(#lp-ring-g)" />
                  <circle cx="80" cy="45" r="19" fill="none" stroke="#50ff4a" strokeWidth="0.9" strokeDasharray="3 3" opacity="0.85" />
                  <circle cx="80" cy="45" r="27" fill="none" stroke="#50ff4a" strokeWidth="0.9" opacity="0.65" />
                  <text x="80" y="82" textAnchor="middle" fill="#50ff4a" fontSize="6" fontWeight="700" fontFamily="system-ui, sans-serif">
                    spill ring · 2–20 m
                  </text>
                </svg>
              </div>
              <div className="lp-mod-body">
                <span className="lp-mod-tag">وحدة الهَدْر</span>
                <h3>ماء بلا مطر</h3>
                <p>
                  نرصد «حزام التماس»: شريط الأسفلت الملاصق لكل مسطّح أخضر. الأدبيات تقيس
                  الرطوبة داخل النبات؛ نحن نقيس الماء الذي خرج منه. ماءٌ هناك في يوم بلا مطر
                  ليس التباساً — إنه تسرّب أو إفراط ريّ.
                </p>
                <dl>
                  <div><dt>يخدم</dt><dd>إدارة الحدائق والتشجير</dd></div>
                  <div><dt>يُخرج</dt><dd>مواقع مرتّبة بالخطورة، وأسبوع بدء الخلل</dd></div>
                  <div><dt>الأثر</dt><dd>ترشيد الري، وحماية طبقة أساس الطريق من التفكّك</dd></div>
                </dl>
              </div>
            </article>

            <article className="lp-mod b">
              <div className="lp-mod-fig">
                <img src="/img/madinah-core.jpg" alt="" />
                <svg viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">
                  <g fill="none" strokeLinecap="round">
                    <path d="M10 70 C 45 62, 70 76, 105 66 S 145 52, 155 58" stroke="#2fd8ef" strokeWidth="1.1" opacity="0.75" />
                    <path d="M8 56 C 44 48, 68 62, 104 52 S 144 38, 154 44" stroke="#2fd8ef" strokeWidth="0.9" opacity="0.5" />
                    <path d="M12 40 C 46 33, 70 47, 106 37 S 146 24, 156 30" stroke="#2fd8ef" strokeWidth="0.7" opacity="0.32" />
                  </g>
                  <circle cx="72" cy="70" r="9" fill="#e8596b" opacity="0.2" />
                  <circle cx="72" cy="70" r="3" fill="#e8596b" />
                  <circle cx="118" cy="63" r="7" fill="#f08a5a" opacity="0.2" />
                  <circle cx="118" cy="63" r="2.4" fill="#f08a5a" />
                  <text x="80" y="84" textAnchor="middle" fill="#2fd8ef" fontSize="6" fontWeight="700" fontFamily="system-ui, sans-serif">
                    flow accumulation · ponding
                  </text>
                </svg>
              </div>
              <div className="lp-mod-body">
                <span className="lp-mod-tag">وحدة الغَرَق</span>
                <h3>ماء بعد مطر — وبطء انحسار</h3>
                <p>
                  الماء الذي ينحسر خلال ساعتين هو طقس. الماء الباقي بعد ٤٨ ساعة هو عيب. إيقاع
                  القمر أعمى عن العابر ومطابق تماماً للمزمن — وهذا تعريف المنتج، لا قصورٌ فيه.
                </p>
                <dl>
                  <div><dt>يخدم</dt><dd>إدارة الطرق وتصريف الأمطار</dd></div>
                  <div><dt>يُخرج</dt><dd>ترتيب المقاطع، والتحقّق قبل/بعد للمشاريع</dd></div>
                  <div><dt>الأثر</dt><dd>استهداف الإنفاق، وإنذار مبكر قبل الحدث المطري</dd></div>
                </dl>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ── product surfaces ─────────────────────────────── */}
      <section className="lp-sec alt">
        <div className="lp-wrap">
          <p className="lp-eyebrow">الواجهة</p>
          <h2 className="lp-h2">قائمة عمل، لا خريطة ملوّنة</h2>
          <p className="lp-lede">
            اللقطات أدناه تُظهر بنية الواجهة، وقيمها الرقمية توضيحية إلى أن يُربط مفتاح
            Google&nbsp;Earth&nbsp;Engine. أمّا الأعداد المذكورة في الصفحة — ٣٢٤ أصلاً و٣٠٬٣٣٧
            مقطعاً و٣٠ حدثاً مطرياً منذ ٢٠١٥ — فمبنيّة فعلاً في قاعدة البيانات.
          </p>

          <div className="lp-screens">
            <div className="lp-screen">
              <div className="lp-screen-h"><i /><i /><i /><span>أولويات اليوم</span></div>
              <div className="lp-screen-body">
                {[
                  ['مقطع SEG-1042', 'حوض شرق · ٤٠٠ م', '0.87', 'var(--sev-3)'],
                  ['مقطع SEG-0778', 'حوض شمال · ٣٢٠ م', '0.79', 'var(--sev-2)'],
                  ['أصل GRN-0113', 'حزام تماس · بلا مطر ٧ أيام', '0.74', 'var(--lp-signal)'],
                  ['مقطع SEG-2410', 'حوض غرب · ٥٦٠ م', '0.61', 'var(--sev-1)'],
                  ['مقطع SEG-0356', 'حوض جنوب · ٢٤٠ م', '0.44', 'var(--sev-0)'],
                ].map(([t, s, v, c]) => (
                  <div className="lp-srow" key={t}>
                    <i style={{ background: c }} />
                    <span><div className="t">{t}</div><div className="s">{s}</div></span>
                    <span className="v num" style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="lp-screen-cap">
                <h4>ترتيب واحد للوحدتين</h4>
                <p>الهدر والغرق في قائمة واحدة، لأن الفريق الذي يخرج صباحاً واحد.</p>
              </div>
            </div>

            <div className="lp-screen">
              <div className="lp-screen-h"><i /><i /><i /><span>بطاقة المقطع · الأدلة</span></div>
              <div className="lp-screen-body">
                <div className="lp-ev" style={{ gap: '10px' }}>
                  {[
                    ['مؤشر الرطوبة الطبوغرافي', '8.4'],
                    ['الارتفاع فوق أقرب مصرف', '1.2 م'],
                    ['نسبة الأسطح غير النفّاذة', '81٪'],
                    ['مساحة الجريان الوارد', '2.1 هكتار'],
                    ['غرق مرصود من الأرشيف', '6 / 19'],
                    ['تغطية الرصد', '74٪'],
                  ].map(([k, v]) => (
                    <div key={k}><span>{k}</span><b className="num">{v}</b></div>
                  ))}
                </div>
                <p className="lp-rec" style={{ marginTop: '4px' }}>
                  كل رقم هنا قابل للتتبّع إلى المشهد والتاريخ الذي اشتُقّ منه.
                </p>
              </div>
              <div className="lp-screen-cap">
                <h4>لا درجة بلا سبب</h4>
                <p>الدرجة وحدها لا تُقنع مهندساً. الأدلة التي بُنيت عليها تُقنعه.</p>
              </div>
            </div>

            <div className="lp-screen">
              <div className="lp-screen-h"><i /><i /><i /><span>التحقّق قبل / بعد</span></div>
              <div className="lp-screen-body">
                <div className="lp-ba">
                  <img src="/img/madinah-core.jpg" alt="" style={{ opacity: 0.55 }} />
                  <svg viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden="true">
                    <g opacity="0.9">
                      <ellipse cx="42" cy="42" rx="22" ry="14" fill="#e8596b" opacity="0.34" />
                      <ellipse cx="34" cy="66" rx="15" ry="9" fill="#e8596b" opacity="0.3" />
                      <ellipse cx="58" cy="72" rx="11" ry="7" fill="#e8596b" opacity="0.26" />
                    </g>
                    <g opacity="0.9">
                      <ellipse cx="118" cy="44" rx="7" ry="4.5" fill="#f5c15c" opacity="0.42" />
                      <ellipse cx="126" cy="66" rx="4" ry="3" fill="#f5c15c" opacity="0.34" />
                    </g>
                    <line x1="80" y1="0" x2="80" y2="100" stroke="#eef2ff" strokeWidth="0.7" opacity="0.6" />
                    <text x="40" y="12" textAnchor="middle" fill="#eef2ff" fontSize="6.5" fontWeight="700" fontFamily="system-ui, sans-serif">2019</text>
                    <text x="120" y="12" textAnchor="middle" fill="#eef2ff" fontSize="6.5" fontWeight="700" fontFamily="system-ui, sans-serif">2024</text>
                  </svg>
                </div>
                <div className="lp-ev" style={{ marginTop: '4px' }}>
                  <div><span>أحداث مطرية في المقارنة</span><b className="num">19</b></div>
                  <div><span>مصدر المقارنة</span><b>أرشيف Sentinel-1</b></div>
                </div>
              </div>
              <div className="lp-screen-cap">
                <h4>الميزة التي لا يملكها أحد</h4>
                <p>
                  أرشيف الرادار منذ ٢٠١٤ يحمل صورة «قبل» لكل مشروع تصريف نُفّذ — حتى لو لم
                  يطلبها أحد وقتها.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── validation ───────────────────────────────────── */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <p className="lp-eyebrow">مُتحقَّق منه</p>
          <h2 className="lp-h2">اختبرنا الفكرة على مدينة تملك بيانات ميدانية مُصنَّفة</h2>
          <p className="lp-lede">
            المدينة المنورة لا تملك سجلاً مصنّفاً لحوادث الغرق — فلا شيء نتدرّب عليه ولا نختبر
            عليه. لذلك دُرِّب النموذج ونُفِّذ اختباره على <strong>نيويورك</strong>، حيث يحمل
            نظام البلاغات ٢١٬٢٨٧ بلاغ «تجمّع مياه في شارع» موقّعاً جغرافياً ومستمرّاً منذ ٢٠٢٠.
            ما ينتقل إلى المدينة المنورة هو <strong>شكل النموذج</strong>، لا أوزانه.
          </p>

          <div className="lp-proof">
            <div className="lp-pcard">
              <div className="v">21,287</div>
              <div className="k">بلاغاً ميدانياً مُصنَّفاً استُخدم في التدريب والاختبار</div>
            </div>
            <div className="lp-pcard">
              <div className="v">0.391</div>
              <div className="k">PR-AUC بتجزئة مكانية مُجزَّأة — مقابل خط أساس 0.274</div>
            </div>
            <div className="lp-pcard">
              <div className="v">1.43×</div>
              <div className="k">تحسّن حقيقي فوق خط الأساس. متواضع، ونقوله كما هو</div>
            </div>
            <div className="lp-pcard">
              <div className="v">37٪</div>
              <div className="k">وزن الشكل الحضري في القرار — أعلى من أي متغيّر تضاريسي</div>
            </div>
          </div>

          <div
            style={{
              border: '1px solid var(--lp-line)',
              borderRadius: 'var(--lp-r)',
              padding: '28px',
              background: 'var(--lp-surface)',
            }}
          >
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '17px',
                fontWeight: 600,
                margin: '0 0 6px',
              }}
            >
              نتيجة خالفت حدسنا: كثافة الطرق تزيد الغرق، لا تقلّله
            </h3>
            <p style={{ fontSize: '14px', lineHeight: 1.75, color: 'var(--lp-fg-2)', margin: '0 0 22px' }}>
              معدّل بلاغات الغرق حسب خُمس كثافة الطرق (كم/كم²). العلاقة مطّردة: الشبكة الكثيفة
              تغرق أربعة أضعاف الشبكة المتفرّقة، لأن الكثافة تُمثّل الأسطح غير النفّاذة — وما
              لا ينفذ يجري.
            </p>
            <div className="lp-bars">
              {[
                ['الخُمس الأول · الأقل كثافة', 9.6, 'var(--sev-0)'],
                ['الخُمس الثاني', 22.6, 'var(--sev-1)'],
                ['الخُمس الثالث', 30.5, 'var(--sev-1)'],
                ['الخُمس الرابع', 36.2, 'var(--sev-2)'],
                ['الخُمس الخامس · الأكثف', 38.2, 'var(--sev-3)'],
              ].map(([lab, pct, c]) => (
                <div className="lp-bar" key={lab}>
                  <span className="lab">{lab}</span>
                  <span className="track">
                    <span className="fill" style={{ width: `${(pct / 40) * 100}%`, background: c }} />
                  </span>
                  <span className="pct">{pct}٪</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--lp-fg-3)', margin: '22px 0 0' }}>
              الأرقام أعلاه من تجزئة مكانية بكتل بطول ٥٫٥ كم. التجزئة العشوائية المعتادة تضخّم
              النتيجة لأن متغيّرات التضاريس مترابطة مكانياً — وهذا أشهر خطأ منهجي في أدبيات
              قابلية الغرق. نعرض الرقمين معاً، والفجوة بينهما جزء من النتيجة.
            </p>
          </div>
        </div>
      </section>

      {/* ── impact ───────────────────────────────────────── */}
      <section className="lp-sec alt">
        <div className="lp-wrap">
          <p className="lp-eyebrow">لمن، ولماذا</p>
          <h2 className="lp-h2">كل مستخدم لديه قرار واحد يحتاج حسمه</h2>
          <p className="lp-lede">
            المنصّة لا تبيع خريطة. تبيع الإجابة على السؤال الذي يقف أمام كل جهة صباح كل يوم.
          </p>
          <div className="lp-impact">
            {IMPACT.map((i) => (
              <div className="lp-imp" key={i.who}>
                <div>
                  <h3>{i.who}</h3>
                  <div className="who">{i.role}</div>
                  {i.q !== '—' && (
                    <div className="who" style={{ color: 'var(--lp-water)', marginTop: '8px' }}>
                      {i.q}
                    </div>
                  )}
                </div>
                <div className="what">{i.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── economics ────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <p className="lp-eyebrow">الاستدامة</p>
          <h2 className="lp-h2">لماذا يبقى هذا الحل قائماً بعد انتهاء التمويل</h2>
          <p className="lp-lede">
            المشاريع التقنية البلدية تموت عادةً في سنتها الثانية: العتاد يتعطّل، والاشتراك
            يُلغى، والمورّد ينسحب. مِطياف لا يملك أياً من نقاط الفشل هذه.
          </p>
          <div className="lp-econ">
            {ECON.map((e) => (
              <div className="lp-ecard" key={e.t}>
                <div
                  style={{
                    width: '34px',
                    height: '2px',
                    background: 'var(--lp-signal)',
                    borderRadius: '2px',
                  }}
                />
                <h3>{e.t}</h3>
                <p>{e.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── honesty ──────────────────────────────────────── */}
      <section className="lp-sec alt">
        <div className="lp-wrap tight">
          <p className="lp-eyebrow">بصراحة</p>
          <h2 className="lp-h2">ما لا ندّعيه</h2>
          <p className="lp-lede">
            دورة إعادة الزيارة تُقاس بالأيام، والسيل الومضي يُقاس بالساعات. القمر الصناعي ليس
            نظام إنذار لحظي ولن يكون. وظيفته بناء خريطة القابلية والتحقّق بعد الحدث؛ والإنذار
            اللحظي يأتي من تنبّؤ الطقس مضروباً في تلك الخريطة.
          </p>
          <ul className="denylist">
            <li>لا إنذار لحظي بالسيل من الفضاء</li>
            <li>لا قياس لعمق المياه بالسنتيمتر</li>
            <li>لا بديل عن النمذجة الهيدروليكية في مرحلة التصميم</li>
            <li>لا حكم في المناطق العمياء للرادار — تُعرَض «غير قابلة للتقييم»، لا «سليمة»</li>
          </ul>
          <p className="note-inline">
            الشارع الذي لم نستطع رؤيته لا يُعرض آمناً أبداً. التمييز بين «لم نرصد غرقاً»
            و«تعذّر علينا الرصد» مكتوب في قاعدة البيانات كقيد، لا كنيّة حسنة.
          </p>
        </div>
      </section>

      {/* ── cta ──────────────────────────────────────────── */}
      <section className="lp-cta">
        <div className="lp-wrap tight">
          <h2>الأمانة تبني الحلّ بالفعل.</h2>
          <p>نحن نضيف العين التي تُخبرها أين تبني — وهل نجحت.</p>
          <div className="lp-hero-cta">
            <Link href="/dashboard" className="lp-btn lp-btn-primary">
              افتح لوحة الرصد
            </Link>
            <Link href="/method" className="lp-btn lp-btn-ghost">
              المنهجية والحدود
            </Link>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <div className="lp-foot-grid">
            <div>
              <p>
                <b>مصادر البيانات:</b> Copernicus Sentinel-1/2 و Copernicus DEM (ESA) ·
                صورة الغلاف من فسيفساء Sentinel-2 cloudless بواسطة EOX IT Services
                (CC&nbsp;BY&nbsp;4.0) · Landsat (USGS/NASA) · OpenStreetMap contributors (ODbL) ·
                Open-Meteo (CC&nbsp;BY&nbsp;4.0) · البيانات المفتوحة لأمانة منطقة المدينة المنورة ·
                بلاغات NYC&nbsp;311 المفتوحة للتحقّق من النموذج.
              </p>
              <p>
                جميع القيم المعروضة إمّا محسوبة من بيانات حقيقية أو موسومة صراحةً كتقدير أو
                كمثال توضيحي.
              </p>
            </div>
            <div className="lp-foot-brand">
              مِطياف
              <div style={{ fontSize: '12px', fontWeight: 400, color: 'var(--lp-fg-3)', marginTop: '6px' }}>
                برمجان المنورة ٢٠٢٦
              </div>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
