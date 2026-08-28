/**
 * Excel export for the green asset register.
 *
 * The file outlives the screen it came from. Someone will open it next month,
 * on a different machine, and try to act on a row — so every sheet carries the
 * filters that produced it, the date it was cut, and the limits of the data.
 * A spreadsheet that silently drops its own caveats is how a "not assessable"
 * verdict turns into "this park is fine" in a meeting.
 *
 * Loaded lazily: SheetJS is ~800 KB and nobody should download it to look at
 * a table they are not exporting.
 */

/** Arabic column order, right to left as the sheet will be read. */
const COLUMNS = [
  ['المعرّف', (r) => r.id],
  ['الاسم', (r) => r.name ?? ''],
  ['النوع', (r) => r.kindAr ?? ''],
  ['الحي', (r) => r.district ?? ''],
  ['أقرب شارع مسمّى', (r) => r.street ?? ''],
  ['المسافة إلى الشارع (م)', (r) => r.streetM ?? ''],
  ['خط الطول', (r) => r.lon ?? ''],
  ['خط العرض', (r) => r.lat ?? ''],
  ['المساحة (م²)', (r) => r.area ?? ''],
  ['العرض الفعّال (م)', (r) => r.widthM ?? ''],
  ['يُتوقَّع أن يكون أخضر', (r) => (r.expectsVeg ? 'نعم' : 'لا')],
  ['الحالة', (r) => r.statusAr ?? ''],
  ['يستحقّ إجراءً', (r) => (r.actionable ? 'نعم' : 'لا')],
  ['الأولوية', (r) => r.priority ?? ''],
  ['درجة الأداء', (r) => (r.score === null || r.score === undefined ? '' : r.score)],
  ['NDVI الوسيط', (r) => num(r.health?.ndviMedian, 3)],
  ['NDMI الوسيط', (r) => num(r.health?.ndmiMedian, 3)],
  ['ميل NDVI سنوياً', (r) => num(r.health?.ndviSlopeYr, 3)],
  ['ميل NDMI سنوياً', (r) => num(r.health?.ndmiSlopeYr, 3)],
  ['عدد الأرصاد الصافية', (r) => r.health?.nObservations ?? ''],
  ['تاريخ التقييم', (r) => String(r.health?.assessedOn ?? '').slice(0, 10)],
  ['سبب التصنيف', (r) => r.health?.reasonAr ?? ''],
  ['الإجراء المقترح', (r) => r.health?.actionAr ?? r.action?.ar ?? ''],
];

const num = (v, dp) =>
  (v === null || v === undefined ? '' : Number(Number(v).toFixed(dp)));

function rollup(rows, keyOf, keyName) {
  const by = new Map();
  for (const r of rows) {
    const k = keyOf(r) || '—';
    if (!by.has(k)) by.set(k, { n: 0, area: 0, actionable: 0, scores: [] });
    const b = by.get(k);
    b.n++;
    b.area += r.area ?? 0;
    if (r.actionable) b.actionable++;
    if (r.score !== null && r.score !== undefined) b.scores.push(r.score);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].actionable - a[1].actionable || b[1].n - a[1].n)
    .map(([k, b]) => ({
      [keyName]: k,
      'عدد الأصول': b.n,
      'المساحة (م²)': Math.round(b.area),
      'يستحقّ إجراءً': b.actionable,
      'متوسط درجة الأداء': b.scores.length
        ? Math.round(b.scores.reduce((x, y) => x + y, 0) / b.scores.length)
        : '',
    }));
}

/**
 * @param rows    the rows exactly as displayed, already filtered
 * @param filters the active filter state, recorded into the file
 * @param extra   { generatedAt, kind, status, total } context for the notes sheet
 */
export async function exportGreenWorkbook(rows, filters = {}, extra = {}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  // Arabic sheets should open right-to-left rather than needing to be flipped.
  wb.Workbook = { Views: [{ RTL: true }] };

  const main = rows.map((r) => Object.fromEntries(COLUMNS.map(([h, f]) => [h, f(r)])));
  const ws = XLSX.utils.json_to_sheet(main, { header: COLUMNS.map(([h]) => h) });
  ws['!cols'] = COLUMNS.map(([h]) => ({ wch: Math.max(12, Math.min(42, h.length + 8)) }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  ws['!freeze'] = { xSplit: '0', ySplit: '1' };
  XLSX.utils.book_append_sheet(wb, ws, 'الأصول الخضراء');

  XLSX.utils.book_append_sheet(
    wb, XLSX.utils.json_to_sheet(rollup(rows, (r) => r.district, 'الحي')), 'ملخّص حسب الحي');
  XLSX.utils.book_append_sheet(
    wb, XLSX.utils.json_to_sheet(rollup(rows, (r) => r.kindAr, 'النوع')), 'ملخّص حسب النوع');

  const notes = XLSX.utils.aoa_to_sheet([
    ['مِطياف — سجلّ الأصول الخضراء'],
    [],
    ['تاريخ التصدير', new Date().toISOString().slice(0, 10)],
    ['آخر تحديث للبيانات', String(extra.generatedAt ?? '—').slice(0, 10)],
    ['عدد الصفوف المصدَّرة', rows.length],
    ['إجمالي الأصول في القاعدة', extra.total ?? '—'],
    [],
    ['المرشّحات المطبَّقة'],
    ['الحي', filters.district ?? 'كل الأحياء'],
    ['النوع', extra.kind && extra.kind !== 'all' ? extra.kind : 'كل الأنواع'],
    ['الحالة', extra.status && extra.status !== 'all' ? extra.status : 'كل الحالات'],
    ['من تاريخ', filters.from ?? 'بلا حد'],
    ['إلى تاريخ', filters.to ?? 'بلا حد'],
    [],
    ['حدود يجب أن تُقرأ مع الأرقام'],
    ['«خارج نطاق التقييم» ليست حالة سيئة ولا جيدة — تعني أن القمر لا يستطيع الحكم:'],
    ['  ملعب بسطح صلب لا غطاء نباتي له بالتصميم، أو شريط أضيق من بكسل Sentinel-2'],
    ['  الواحد (١٠ م) فتعود قراءته إلى الأسفلت المجاور لا إلى النبات.'],
    ['«أرض غير مزروعة» تعني أنه لم يُرصد فيها غطاء قط — وهي مسألة تخطيط لا صيانة.'],
    ['«فقد الغطاء» تعني أنها كانت خضراء ثم لم تعد — وهذه وحدها إنذار صيانة.'],
    ['الحكم على الاتجاه (تدهور/إجهاد ريّ) يحتاج ٢٠ رصداً صافياً على الأقل؛ ما دونه'],
    ['  يُوصف الأصل بمستواه ولا يُنسب إليه اتجاه.'],
    ['صفوف أشجار الشوارع مرسومة بتوسيع الخط المرسوم في الخريطة، فعرضها مُفترَض لا مقيس.'],
    ['حدود الأحياء مشتقّة من نقاط مراكزها (Voronoi) وليست حدوداً رسمية.'],
    ['«أقرب شارع مسمّى» دليل موقع لا عنوان رسمي — انظر عمود المسافة قبل الاعتماد عليه.'],
    [],
    ['المصادر: OpenStreetMap (ODbL) · Copernicus Sentinel-2 · Open-Meteo (CC BY 4.0)'],
  ]);
  notes['!cols'] = [{ wch: 34 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, notes, 'عن هذا الملف');

  const tag = [filters.district, extra.kind !== 'all' ? extra.kind : null,
    extra.status !== 'all' ? extra.status : null].filter(Boolean).join('_') || 'all';
  XLSX.writeFile(wb, `mityaf_green_${tag}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Arabic labels for the terrain features, shared by the sheet and the UI. */
export const TERRAIN_AR = {
  twi: 'مؤشّر الرطوبة الطبوغرافي',
  hand: 'الارتفاع فوق أقرب مجرى (م)',
  sink: 'عمق المنخفض المغلق (م)',
  slope: 'الانحدار (٪)',
};

const BAND_AR = {
  critical: 'حرج', high: 'مرتفع', moderate: 'متوسط',
  stable: 'مستقر', insufficient_data: 'غير مُقيَّم',
};

const SEG_COLUMNS = [
  ['المعرّف', (r) => r.id],
  ['اسم الشارع', (r) => r.name ?? ''],
  ['الحي', (r) => r.d ?? ''],
  ['الترتيب', (r) => r.rk ?? ''],
  ['الدرجة المئوية', (r) => (r.s ?? '')],
  ['النطاق', (r) => BAND_AR[r.b] ?? r.b ?? ''],
  [TERRAIN_AR.twi, (r) => r.twi ?? ''],
  [TERRAIN_AR.hand, (r) => r.hand ?? ''],
  [TERRAIN_AR.sink, (r) => r.sink ?? ''],
  [TERRAIN_AR.slope, (r) => r.slope ?? ''],
];

/** The street susceptibility register. */
export async function exportSegmentsWorkbook(rows, filters = {}, extra = {}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) => Object.fromEntries(SEG_COLUMNS.map(([h, f]) => [h, f(r)]))),
    { header: SEG_COLUMNS.map(([h]) => h) });
  ws['!cols'] = SEG_COLUMNS.map(([h]) => ({ wch: Math.max(12, Math.min(38, h.length + 8)) }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  XLSX.utils.book_append_sheet(wb, ws, 'قابلية احتجاز الماء');

  const byBand = {};
  for (const r of rows) byBand[r.b] = (byBand[r.b] ?? 0) + 1;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    Object.entries(byBand).map(([k, n]) => ({ النطاق: BAND_AR[k] ?? k, 'عدد المقاطع': n }))),
  'ملخّص النطاقات');

  const notes = XLSX.utils.aoa_to_sheet([
    ['مِطياف — سجلّ قابلية الشوارع لاحتجاز الماء'],
    [],
    ['تاريخ التصدير', new Date().toISOString().slice(0, 10)],
    ['عدد الصفوف المصدَّرة', rows.length],
    ['الحي', filters.district ?? 'كل الأحياء'],
    ['النطاق', extra.band && extra.band !== 'all' ? (BAND_AR[extra.band] ?? extra.band) : 'كل النطاقات'],
    [],
    ['كيف تُقرأ «الدرجة المئوية»'],
    ['هي ترتيب مئوي داخل المدينة المنورة، لا احتمال غرق.'],
    ['درجة ٩٨ تعني: هذا المقطع ضمن أعلى ٢٪ من مقاطع المدينة قابليةً لاحتجاز الماء.'],
    ['ولا تعني أنّ احتمال غرقه ٩٨٪.'],
    [],
    ['أساس النموذج وحدوده'],
    ['دُرِّب على ١٠١٬٧٥٦ بلاغاً حقيقياً من نيويورك وشيكاغو (بيانات بلدية مفتوحة).'],
    ['اختبار «اترك مدينة»: دُرِّب على مدينة واختُبر على أخرى لم يرَها، فبقي أعلى'],
    ['  من خط الأساس بـ١٫٢٤ و١٫٣٠ ضعف. هذا ما يبرّر نقله إلى المدينة المنورة.'],
    ['لكنه لم يُتحقَّق منه ميدانياً في المدينة المنورة بعد — الترتيب ينتقل، أمّا'],
    ['  المعايرة المطلقة فلا تنتقل بين نظامين مطريين مختلفين.'],
    ['الخصائص تضاريسية وحضرية فقط: لا تعرف مواقع شبكة التصريف المنفَّذة،'],
    ['  فالمقطع المخدوم بشبكة جديدة قد يظهر مرتفعاً وهو معالَج فعلياً.'],
    [],
    ['المصادر: FABDEM (بارز الأرض ٣٠ م) · OpenStreetMap (ODbL) · NYC Open Data · Chicago Data Portal'],
  ]);
  notes['!cols'] = [{ wch: 32 }, { wch: 54 }];
  XLSX.utils.book_append_sheet(wb, notes, 'عن هذا الملف');

  const tag = [filters.district, extra.band !== 'all' ? extra.band : null]
    .filter(Boolean).join('_') || 'all';
  XLSX.writeFile(wb, `mityaf_streets_${tag}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
