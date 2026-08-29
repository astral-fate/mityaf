/**
 * The three ways a street floods, which are three different problems.
 *
 * Lives beside bands.js and follows its shape, because several routes need it
 * and importing a constant from a page makes Next hoist that page into a
 * shared chunk for nothing.
 *
 * The distinction is operational, not academic: a hollow needs drainage built
 * into it or it gets pumped after every storm forever; a convergence point
 * needs the runoff intercepted upslope; an underpass needs a pump because it
 * is below grade by construction and no gravity outlet exists.
 */
export const MECHANISMS = {
  depression: {
    ar: 'منخفض مغلق',
    color: '#4aa3ff',
    hint: 'الماء يصل ولا يجد مخرجاً — يبقى أياماً',
    actionAr: 'إدراج في خطة التصريف',
  },
  convergence: {
    ar: 'تجمّع جريان',
    color: '#f0a35a',
    hint: 'الماء يمرّ بغزارة على أرض مستوية — يغمر أثناء المطر',
    actionAr: 'اعتراض الجريان أعلى المنحدر',
  },
  tunnel: {
    ar: 'نفق أو ممرّ سفلي',
    color: '#e8596b',
    hint: 'أخفض نقطة في الطريق بحكم الإنشاء — لا مخرج بالجاذبية',
    actionAr: 'ضخّ ميداني ومتابعة موسمية',
  },
};

export const MECHANISM_ORDER = ['depression', 'convergence', 'tunnel'];

/** Arabic label for a segment, including the unflagged case. */
export function mechanismOf(seg) {
  const m = seg?.mechanism;
  return m && MECHANISMS[m] ? MECHANISMS[m] : { ar: 'غير مُصنَّف', color: '#66739a', hint: 'لا ينطبق عليه أيّ من الآليات الثلاث', actionAr: '—' };
}
