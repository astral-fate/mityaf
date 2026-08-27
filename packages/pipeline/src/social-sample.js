/**
 * A synthetic corpus of citizen reports, for demos and for testing the
 * classifier without spending on the X API.
 *
 * EVERY RECORD HERE IS INVENTED. The handles are fictional (@resident_NN), the
 * flag `synthetic: true` rides on each one, and the UI labels the whole feed
 * as a sample. Writing plausible Arabic complaints and attributing them to
 * real accounts — or to the Amanah's own — would be manufacturing evidence
 * about a real organisation, which is not something a demo needs.
 *
 * The text is written to exercise the classifier honestly rather than to
 * flatter it: it includes posts that should NOT fire (thanks-for-fixing-it
 * messages), posts with no district named, and posts that straddle two
 * categories. A corpus where everything classifies cleanly proves nothing.
 */

// Real district names, because the district extractor has to match the same
// strings the rest of the platform uses.
export const SAMPLE_POSTS = [
  ['الدفاع', 'تجمع مياه كبير في شارع الملك عبدالعزيز عند حي الدفاع من يومين والوضع خطر على الأطفال الذاهبين للمدرسة', -2],
  ['الدفاع', 'البالوعات مسدودة في الدفاع والمياه ما تصرف نهائيا، أرجو المعالجة عاجل', -2],
  ['الدفاع', 'ثالث يوم والمياه واقفة في نفس المكان بحي الدفاع، مرارا نبلغ ولا حل', -1],
  ['الملك فهد', 'رشاشات الحديقة في حي الملك فهد تعمل نهارا والماء يسيل على الشارع، هدر مياه واضح', -3],
  ['الملك فهد', 'تسرب من ماسورة عند مدخل حي الملك فهد والماء على الأسفلت من أسبوع', -1],
  ['الملك فهد', 'كسر ماسورة قرب الحديقة في الملك فهد، الماء يهدر منذ الصباح', 0],
  ['الجامعة', 'أشجار الشارع في حي الجامعة يابسة تماما، يبدو أنها ما تسقى من مدة', -5],
  ['الجامعة', 'نخيل الحديقة في الجامعة ذابلة وبعضها ميتة، تحتاج متابعة', -3],
  ['الخالدية', 'حفرة كبيرة في شارع فرعي بحي الخالدية بعد المطر الأخير، خطر على السيارات', -4],
  ['الخالدية', 'الأسفلت متشقق وفيه هبوط في الشارع عند الخالدية', -2],
  ['وعيرة', 'تجمعات مياه في حي وعيرة كل ما نزل مطر، التصريف ضعيف', -6],
  ['وعيرة', 'المياه تغمر المدخل في وعيرة، نرجو حل جذري', -3],
  ['النقاء', 'الحديقة في حي النقاء تحتاج ري، العشب كله ذابل', -4],
  ['العيون', 'شكرا للأمانة، تم إصلاح البالوعة في حي العيون والمياه تصرف الحين', -1],
  ['العيون', 'أشجار حي العيون بحالة ممتازة بعد الصيانة الأخيرة، شكرا', -2],
  ['نبلاء', 'بركة مياه ثابتة في حي نبلاء من ثلاثة أيام ولا أحد تحرك', -2],
  [null, 'المياه تتجمع في الشارع بعد كل مطرة والتصريف ما يكفي', -3],
  [null, 'في حفريات مفتوحة من أسبوعين بدون أي علامات تحذيرية', -5],
  [null, 'رشاشات تشتغل الظهر والشمس حارة، هذا هدر مياه', -1],
  ['الدفاع', 'نظافة الشارع سيئة والنفايات متراكمة عند الحاوية في الدفاع', -2],
  ['الجامعة', 'روائح كريهة من مجاري حي الجامعة', -1],
  ['الخالدية', 'الرصيف مكسور أمام المسجد في الخالدية', -6],
  ['الملك فهد', 'تجمع مياه عند دوار حي الملك فهد يسبب ازدحام', 0],
  ['وعيرة', 'انسداد في شبكة التصريف بحي وعيرة، الماء يطفح للشارع', -1],
  [null, 'الحديقة العامة تحتاج صيانة، بعض الأشجار عطشانة', -7],
  ['النقاء', 'حفرة في مدخل حي النقاء تتسع كل يوم', -3],
  ['نبلاء', 'مياه الري تسيل على الرصيف في نبلاء طول اليوم', -2],
  ['العيون', 'تصريف الأمطار ممتاز هالسنة في العيون، ما صار تجمع', -4],
  ['الدفاع', 'سيول جرفت الرمل إلى الشارع في حي الدفاع', -8],
  ['الجامعة', 'أشجار جديدة زرعت في الجامعة وتبدو بحالة جيدة', -3],
];

/**
 * Materialise the corpus with dates and fictional handles.
 * `daysAgo` on each row keeps the feed looking like a timeline rather than a
 * single burst, and keeps the alert clustering meaningful.
 */
export function sampleFeed(nowIso = new Date().toISOString()) {
  const now = new Date(nowIso).getTime();
  return SAMPLE_POSTS.map(([district, text, daysAgo], i) => ({
    id: `sample_${String(i + 1).padStart(3, '0')}`,
    text,
    author: `@resident_${String((i % 17) + 1).padStart(2, '0')}`,
    createdAt: new Date(now + daysAgo * 864e5).toISOString(),
    hintDistrict: district,
    source: 'sample',
    synthetic: true,
  }));
}
