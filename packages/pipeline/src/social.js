/**
 * Citizen reports from X — ingestion, Arabic classification, and alerting.
 *
 * Satellite tells you where water IS. A resident tells you where water HURTS,
 * and does it within minutes rather than within a revisit cycle. The two fail
 * in opposite directions: the satellite is blind between passes but sees the
 * whole city, while reports are instant but only arrive from neighbourhoods
 * whose residents complain. Neither is the ground truth; agreement between
 * them is the strongest signal the platform can produce.
 *
 * Two adapters behind one interface:
 *
 *   `x`      — the live X API. Reading posts is billed per post since
 *              February 2026, so this only runs when a token is configured.
 *   `sample` — a synthetic corpus committed to the repo, so the dashboard and
 *              the demo work with no credentials and no spend.
 *
 * The sample corpus is SYNTHETIC and labelled as such on every record and in
 * the UI. Inventing posts and attributing them to real people or to the
 * Amanah's own account would be fabricating evidence about a real
 * organisation, so every handle in it is fictional and marked.
 *
 * Classification is rule-based on purpose. A municipal officer acting on an
 * alert has to be able to see why it fired, and "these four words matched, in
 * this window, with no rain in 72 hours" is auditable in a way that a model
 * logit is not. `matched` is stored on every record for that reason.
 */

const CATEGORIES = [
  {
    key: 'flooding',
    ar: 'تجمّع مياه وغرق',
    weight: 3,
    terms: ['غرق', 'غرقت', 'تجمع مياه', 'تجمعات مياه', 'برك', 'بركة', 'سيول', 'سيل',
      'مستنقع', 'طفح', 'طوفان', 'المياه تغمر', 'غمرت'],
  },
  {
    key: 'drainage',
    ar: 'تصريف وبالوعات',
    weight: 3,
    terms: ['تصريف', 'بالوعة', 'بالوعات', 'صرف صحي', 'مجاري', 'شبكة التصريف',
      'مسدودة', 'انسداد', 'تصرف المياه'],
  },
  {
    key: 'irrigation',
    ar: 'ريّ وتسرّب',
    weight: 2,
    terms: ['ري', 'الري', 'رشاش', 'رشاشات', 'تسرب', 'تسريب', 'ماء على الشارع',
      'هدر المياه', 'هدر مياه', 'كسر ماسورة', 'ماسورة'],
  },
  {
    key: 'vegetation',
    ar: 'أشجار ومسطّحات',
    weight: 2,
    terms: ['شجرة', 'أشجار', 'نخل', 'نخيل', 'حديقة', 'الحديقة', 'مسطح أخضر',
      'يابس', 'يابسة', 'ذابل', 'ذابلة', 'ميتة', 'عطشانة', 'تموت'],
  },
  {
    key: 'roads',
    ar: 'طرق وحفريات',
    weight: 2,
    terms: ['حفرة', 'حفر', 'حفريات', 'أسفلت', 'الأسفلت', 'رصيف', 'الرصيف',
      'مطبات', 'تشققات', 'هبوط في الشارع'],
  },
  {
    key: 'cleanliness',
    ar: 'نظافة',
    weight: 1,
    terms: ['نظافة', 'نفايات', 'قمامة', 'أوساخ', 'مخلفات', 'روائح'],
  },
];

// Words that raise urgency regardless of category.
const INTENSIFIERS = ['خطر', 'خطير', 'عاجل', 'اليوم الثالث', 'منذ أيام', 'أسبوع',
  'لا نستطيع', 'انقطع', 'حادث', 'أطفال', 'مدرسة', 'مستشفى', 'أرجو', 'نرجو', 'مرارا'];

const NEGATIONS = ['لا يوجد', 'ما فيه', 'تم إصلاح', 'تم حل', 'شكرا', 'شكراً', 'أشكر'];

const norm = (s) => (s ?? '')
  .replace(/[ؐ-ًؚ-ٰٟ]/g, '')   // strip harakat
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Classify one post. Returns the category, an urgency score, the district if
 * one is named, and the exact terms that fired — never a bare label.
 */
export function classifyPost(text, districts = []) {
  const t = norm(text);

  const scored = CATEGORIES.map((c) => {
    const matched = c.terms.filter((term) => t.includes(norm(term)));
    return { key: c.key, ar: c.ar, weight: c.weight, matched, score: matched.length * c.weight };
  }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

  const top = scored[0] ?? null;
  const intensifiers = INTENSIFIERS.filter((w) => t.includes(norm(w)));
  const negated = NEGATIONS.some((w) => t.includes(norm(w)));

  // A post naming a district is far more actionable than one that does not,
  // so the name is extracted rather than left in the prose.
  //
  // Several Madinah districts are named with ordinary nouns — الحديقة, العيون,
  // النقاء — which collide with the vocabulary of the complaints themselves.
  // "الحديقة في حي النقاء" matched الحديقة and filed a report about a garden
  // under a district of that name. So a match preceded by حي wins outright,
  // and only failing that does the longest bare match apply: a longer name is
  // far less likely to be an accidental substring.
  const hits = districts.filter((d) => t.includes(norm(d)));
  const district =
    hits.find((d) => t.includes(`حي ${norm(d)}`))
    ?? [...hits].sort((a, b) => b.length - a.length)[0]
    ?? null;

  let urgency = 0;
  if (top) urgency = top.weight;
  urgency += Math.min(2, intensifiers.length);
  if (district) urgency += 1;
  if (negated) urgency = Math.max(0, urgency - 3);
  urgency = Math.max(0, Math.min(5, urgency));

  const level = urgency >= 5 ? 'critical' : urgency >= 4 ? 'high' : urgency >= 2 ? 'medium' : 'low';

  return {
    category: top?.key ?? 'other',
    categoryAr: top?.ar ?? 'غير مصنّف',
    district,
    urgency,
    level,
    matched: top?.matched ?? [],
    intensifiers,
    negated,
    // The sentence an officer reads instead of a score.
    explanationAr: top
      ? `صُنّف «${top.ar}» لمطابقة ${top.matched.length} من مفردات الفئة `
        + `(${top.matched.join('، ')})`
        + (district ? ` · ورد اسم حي ${district} في النص` : ' · لم يُذكر حي بالاسم')
        + (intensifiers.length ? ` · مؤشرات إلحاح: ${intensifiers.join('، ')}` : '')
        + (negated ? ' · صيغة النص تدل على شكر أو إصلاح تم، فخُفِّض الإلحاح' : '')
      : 'لم تُطابق أي فئة معروفة — يُعرض للمراجعة اليدوية',
  };
}

/** Group classified posts into district-level alerts. */
export function buildAlerts(posts, { minPosts = 2 } = {}) {
  const byKey = new Map();
  for (const p of posts) {
    if (!p.district || p.urgency < 2) continue;
    const key = `${p.district}::${p.category}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        district: p.district, category: p.category, categoryAr: p.categoryAr,
        posts: [], maxUrgency: 0,
      });
    }
    const a = byKey.get(key);
    a.posts.push(p.id);
    a.maxUrgency = Math.max(a.maxUrgency, p.urgency);
  }

  // One complaint is a complaint. Several from one district about one thing in
  // a short window is a signal, and only the second is worth an alert.
  return [...byKey.values()]
    .filter((a) => a.posts.length >= minPosts)
    .map((a) => {
      // nPosts cannot be read off `a` inside the same object literal that
      // defines it — that produced "undefined بلاغات" in every alert title.
      const nPosts = a.posts.length;
      return {
        ...a,
        nPosts,
        level: a.maxUrgency >= 5 ? 'critical' : a.maxUrgency >= 4 ? 'high' : 'medium',
        titleAr: `${nPosts} بلاغات عن ${a.categoryAr} في حي ${a.district}`,
      };
    })
    .sort((a, b) => b.maxUrgency - a.maxUrgency || b.nPosts - a.nPosts);
}

/* ── adapters ──────────────────────────────────────────────────────────── */

/**
 * Live X ingestion.
 *
 * Reading posts has been billed per post since X moved to pay-per-use in
 * February 2026, so this is opt-in: without X_BEARER_TOKEN the pipeline uses
 * the sample corpus instead of failing. A demo that cannot run without a
 * funded API key is a demo that cannot run.
 */
export async function fetchFromX({ query, maxResults = 100, token }) {
  if (!token) throw new Error('X_BEARER_TOKEN is not set');
  const url = new URL('https://api.twitter.com/2/tweets/search/recent');
  url.searchParams.set('query', query);
  url.searchParams.set('max_results', String(Math.min(100, maxResults)));
  url.searchParams.set('tweet.fields', 'created_at,lang,geo,public_metrics');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`X API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  return (json.data ?? []).map((t) => ({
    id: t.id,
    text: t.text,
    author: t.author_id ? `id:${t.author_id}` : null,
    createdAt: t.created_at,
    source: 'x',
    synthetic: false,
  }));
}

/** Default Arabic query for Al Madinah water and greenery complaints. */
export const MADINAH_QUERY =
  '(أمانة المدينة OR أمانة_المدينة_المنورة OR المدينة المنورة) '
  + '(تجمع مياه OR غرق OR تصريف OR بالوعة OR سيول OR ري OR تسرب OR أشجار OR حفرة) '
  + '-is:retweet lang:ar';
