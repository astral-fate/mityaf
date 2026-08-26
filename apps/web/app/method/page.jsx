export const metadata = { title: 'المنهجية — مِطياف' };

const SOURCES = [
  ['Sentinel-2', '10 م (20 م لنطاقات SWIR)', '~5 أيام', 'مؤشرات الخضرة والمياه والرطوبة'],
  ['Sentinel-1 رادار', '~10 م', '6–12 يوماً', 'كشف المياه عبر السحب وليلاً · الأرشيف منذ 2014'],
  ['Copernicus DEM', '30 م', 'ثابت', 'الانحدار · تراكم الجريان · TWI · HAND'],
  ['Landsat 8/9 حراري', '100 م', '~8 أيام', 'حرارة السطح — دليل مساند على الإفراط'],
  ['Open-Meteo', 'نقطي', 'ساعي + تنبؤ', 'البوابة الفاصلة بين الوحدتين والإنذار المبكر'],
  ['OpenStreetMap', 'متجهات', 'مستمر', 'الشوارع · الحدائق · الأودية'],
];

const INDICES = [
  ['NDVI', '(NIR − Red)/(NIR + Red)', 'حيوية الغطاء النباتي'],
  ['NDWI', '(Green − NIR)/(Green + NIR)', 'مياه سطحية مكشوفة'],
  ['MNDWI', '(Green − SWIR)/(Green + SWIR)', 'مياه — أدق في الوسط الحضري'],
  ['NDMI', '(NIR − SWIR)/(NIR + SWIR)', 'رطوبة المظلّة النباتية'],
  ['NDBI', '(SWIR − NIR)/(SWIR + NIR)', 'الأسطح غير النفّاذة'],
];

const LIMITS = [
  ['الدقة المكانية', '10 م بصري، 20 م لمؤشرات SWIR، 30 م تضاريس. الشوارع السكنية دون ~10 م بكسل مختلط، وتُوسم بثقة منخفضة.'],
  ['فجوة إعادة الزيارة', 'دورة الزيارة أيام والسيل الومضي ساعات. القمر لا يصوّر الذروة — يبني خريطة القابلية ويتحقّق بعد الحدث.'],
  ['الرادار في المدن', 'الماء بين المباني يسطع بدل أن يُظلم (انعكاس ثنائي). ظل الرادار يخلق مناطق عمياء دائمة تُقنَّع وتُعلَن.'],
  ['نموذج الارتفاع', 'Copernicus DEM نموذج سطح يشمل المباني والأشجار، لا أرضاً عارية. المخرج ترتيب نسبي لا منسوب مطلق.'],
  ['ندرة التسميات', 'لا جرد ميداني للغرق. التسميات تُولَّد ذاتياً من أرشيف الرادار، ومستوى التحقّق يبقى «قمر صناعي فقط» حتى حملة ميدانية.'],
  ['ندرة الأمطار', '30 حدثاً فقط ≥ 5 ملم منذ 2015. عيّنة صغيرة للتعلّم المُشرَف — لذا يحمل المؤشّر غير المُشرَف العبء.'],
];

export default function Method() {
  return (
    <main>
      <section className="band">
        <div className="wrap">
          <p className="eyebrow">المنهجية والشفافية</p>
          <h2 className="sec-title">كيف نصل إلى الحكم — وأين نتوقّف</h2>
          <p className="sec-lede">
            هذه الصفحة تعرض المصادر والصيغ والحدود المعروفة. منتجات الاستشعار عن بُعد تكذب
            بهدوء حين تُبلّغ بصفر بينما لم تستطع الرؤية أصلاً — ولهذا نفصل صراحةً بين
            «لم يُرصد» و«تعذّر الرصد».
          </p>
        </div>
      </section>

      <section className="band alt">
        <div className="wrap">
          <h3 className="sec-title" style={{ fontSize: 'clamp(21px,3vw,28px)' }}>مصادر البيانات</h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>المصدر</th><th>الدقة</th><th>التكرار</th><th>الاستخدام</th></tr>
              </thead>
              <tbody>
                {SOURCES.map((r) => (
                  <tr key={r[0]}>
                    <td className="k">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note-inline">
            كل المصادر مجانية ومفتوحة. هذا قيد تصميمي مقصود: تكلفة رصد الأصل الإضافي يجب أن
            تساوي صفراً، وإلا لا تتوسّع المنصّة إلى مدينة كاملة.
          </p>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <h3 className="sec-title" style={{ fontSize: 'clamp(21px,3vw,28px)' }}>المؤشّرات الطيفية</h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>المؤشّر</th><th>الصيغة</th><th>الدلالة</th></tr></thead>
              <tbody>
                {INDICES.map((r) => (
                  <tr key={r[0]}>
                    <td className="k">{r[0]}</td>
                    <td><code dir="ltr">{r[1]}</code></td>
                    <td>{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note-inline">
            <strong>MNDWI وNDMI وNDBI</strong> مشتقّة من نطاقات <strong>20 متراً</strong> لا 10.
            لا شيء يُخفي ذلك: كل رصدة تسجّل دقّتها الأصلية في حقل مستقل.
          </p>
        </div>
      </section>

      <section className="band alt">
        <div className="wrap">
          <h3 className="sec-title" style={{ fontSize: 'clamp(21px,3vw,28px)' }}>العتبات التكيّفية</h3>
          <p className="sec-lede">
            لا نستخدم عتبة عامة واحدة. حديقة على حافة الصحراء وحديقة مركزية مرويّة بكثافة لهما
            قراءتان طبيعيتان مختلفتان تماماً؛ عتبة واحدة إمّا تُغرقك بإنذارات كاذبة على الأولى
            أو تُفوّت كل شيء على الثانية. القاعدة هي: <strong>هذا الموقع خرج عن سلوكه المعتاد هو</strong>،
            محسوبة بانحراف معياري متدحرج على نافذة 12 أسبوعاً.
          </p>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <h3 className="sec-title" style={{ fontSize: 'clamp(21px,3vw,28px)' }}>الحدود المعروفة</h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>القيد</th><th>الأثر</th></tr></thead>
              <tbody>
                {LIMITS.map((r) => (
                  <tr key={r[0]}><td className="k">{r[0]}</td><td>{r[1]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="band alt">
        <div className="wrap narrow">
          <h3 className="sec-title" style={{ fontSize: 'clamp(21px,3vw,28px)' }}>ما لا تفعله المنصّة</h3>
          <ul className="denylist">
            <li>لا إنذار لحظي بالسيل من القمر الصناعي</li>
            <li>لا قياس لعمق المياه بالسنتيمتر</li>
            <li>لا بديل عن النمذجة الهيدروليكية في التصميم التفصيلي</li>
            <li>لا تقييم موثوق للشوارع السكنية الضيّقة</li>
            <li>لا حكم إطلاقاً في المناطق العمياء للرادار</li>
          </ul>
          <p className="note-inline">
            المنصّة طبقة <strong>فرز واستهداف وتحقّق</strong>. المهندس يظلّ هو من يصمّم —
            لكنه يبدأ من الساعة العشرين لا من الصفر.
          </p>
        </div>
      </section>
    </main>
  );
}
