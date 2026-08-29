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
    ar: 'حفريات',
    color: '#4aa3ff',
    hint: 'يصله الماء ولا يجد منفذاً — فيبقى راكداً أياماً',
    actionAr: 'شبكة تصريف داخل المنخفض',
  },
  convergence: {
    ar: 'شارع انبساطي',
    color: '#f0a35a',
    hint: 'تلتقي عنده مياه المنحدر على أرض مستوية — يغمر أثناء المطر ثمّ ينحسر',
    actionAr: 'اعتراض الجريان أعلى المنحدر',
  },
  tunnel: {
    ar: 'شارع انشائي',
    color: '#e8596b',
    hint: 'أخفض نقطة في الطريق بحكم الإنشاء — والجاذبية لا ترفع الماء إلى مخرج',
    actionAr: 'ضخّ ميداني ومتابعة موسمية',
  },
};

export const MECHANISM_ORDER = ['depression', 'convergence', 'tunnel'];

/** Arabic label for a segment, including the unflagged case. */
export function mechanismOf(seg) {
  const m = seg?.mechanism;
  return m && MECHANISMS[m] ? MECHANISMS[m] : { ar: 'غير مُصنَّف', color: '#66739a', hint: 'لا ينطبق عليه أيّ من الآليات الثلاث', actionAr: '—' };
}
