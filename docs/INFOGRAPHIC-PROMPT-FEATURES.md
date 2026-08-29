# Infographic brief — قاموس خصائص مِطياف

A visual dictionary of the model's nine features, in the style of the agricultural
indices card the reference image uses.

---

## Before you send this anywhere

**Image generators cannot render Arabic.** Midjourney, DALL·E, Imagen and the
Nano Banana family all produce decorative gibberish where Arabic letterforms
should be — they break the connected script and mangle diacritics. They also
garble precise Latin labels like `load_per_road`.

The reference infographic was made in a design tool, not generated. So:

| Target | Will it work? |
|---|---|
| Gemini Canvas, Claude, ChatGPT Canvas — anything that outputs **HTML/SVG** | ✅ Real text, correct Arabic |
| Canva Magic Design, Figma AI | ✅ Real text |
| Midjourney / Imagen / DALL·E / Nano Banana | ❌ Arabic will be gibberish |

Send the prompt below to a **tool that renders real text**. If you want to use an
image generator anyway, use it only for the background texture and overlay all
type yourself.

---

## The prompt

> Design a single-page Arabic infographic titled **«قاموس خصائص مِطياف.. دليلك
> السريع لقراءة نموذج غرق الشوارع»**. It is a visual dictionary explaining the
> nine input features of a street-flood susceptibility model to a non-specialist.
>
> **Output format:** a self-contained HTML page with inline CSS, RTL layout
> (`dir="rtl"`), using the font "IBM Plex Sans Arabic" with a sans-serif fallback.
> Real selectable text — do not render any text as an image.
>
> **Layout:** a rounded dark-green header pill across the top carrying the title
> and a small satellite icon. Below it, nine feature cards as wide rounded pills,
> two per row, arranged in two labelled groups. Each pill has a pale mint fill, a
> dark green border, the feature's Latin name in large bold Latin type, its Arabic
> plain-language definition beneath in smaller text, an importance percentage
> badge on the leading edge, and a small square thumbnail slot on the trailing
> edge. Leave the thumbnail slots as empty placeholder squares with a dashed
> border and a caption saying what image belongs there.
>
> **Group 1 heading:** «من نموذج الارتفاع الرقمي DEM — التضاريس» with the
> subtitle «ستّ خصائص تُحسب من شبكة ارتفاعات الأرض». Six cards:
>
> - `sink` — 11.7% — «عمق الحفرة المغلقة التي لا مخرج لها. أقرب تمثيل رياضي
> لكلمة "بركة".» — thumbnail: a filled depression map
> - `hand` — 10.3% — «كم يرتفع الموقع فوق أقرب خط تصريف طبيعي. الاسم اختصار
> لـ Height Above Nearest Drainage.» — thumbnail: a drainage-distance map
> - `relelev` — 9.6% — «هل الموقع منخفض عن جيرانه أم مرتفع عنهم؟ يُقاس مقابل
> متوسط منزلق ١٧×١٧.» — thumbnail: a relative-elevation map
> - `logacc` — 7.1% — «كم من المساحة العليا يصرّف ماؤها مارّاً عبر هذه النقطة.» —
> thumbnail: a flow-accumulation network
> - `slope` — 6.2% — «انحدار السطح بالدرجات. الأرض المستوية تصرّف ببطء.» —
> thumbnail: a slope map
> - `twi` — 6.0% — «ميل الموقع لتجميع الماء، ويُحسب من المساحة المصرِّفة مقسومة
> على الميل.» — thumbnail: a wetness-index map
>
> **Group 2 heading:** «من خريطة الشوارع المفتوحة OSM — الشكل الحضري» with the
> subtitle «ثلاث خصائص تُحسب من هندسة الطرق». Three cards:
>
> - `road_density` — 26.0% — «كم متراً من الطريق في كل كيلومتر مربّع. أعلى خاصية
> وزناً في النموذج كلّه.» — thumbnail: a road-density heatmap
> - `major_frac` — 12.9% — «حصّة الطرق الشريانية من إجمالي طول الطرق في الخلية.» —
> thumbnail: an arterial-road map
> - `load_per_road` — 10.2% — «الماء الوارد مقسوماً على طول الطريق. الخاصية
> المُهندَسة الوحيدة في النموذج.» — thumbnail: a load-per-road map
>
> **Footer band**, visually distinct, carrying the headline finding: «الشكل
> الحضري يحمل ٣٨٫٨٪ من وزن النموذج مجتمعاً — أعلى من أي متغيّر تضاريسي منفرد.
> الآلية: النفاذية.» Beneath it in smaller type: «تسع خصائص · لا صور ولا مستشعرات
> · المصدر: MODEL-CARD.md §٥٫٣».
>
> **Palette:** dark forest green #1E5B3A for the header and borders, pale mint
> #EAF3EC for card fills, near-black #14261C for the Arabic body text, warm gold
> #C9AC6D for the importance badges. Off-white page ground.
>
> **Rules:**
> - Sort each group by importance, highest first.
> - Keep the Latin feature names in Latin script exactly as written — they are
> code identifiers, do not translate or transliterate them.
> - Every percentage must appear exactly as given. Do not round or recalculate.
> - The Arabic must read right-to-left throughout, including the card order
> within each row.
> - No decorative stock imagery, no gradients on the text, no drop shadows.

---

## Thumbnail images

The prompt leaves nine placeholder squares. Real map thumbnails come from the
project's own figures rather than stock art:

- `masareb/paper/figures/` — the ten vector diagrams and four EDA figures
- `masareb/docs/mityaf-chapter-en.html` — the SVG originals, if one needs editing

If you would rather ship it without thumbnails, delete the thumbnail sentence
from the layout paragraph — the card layout holds up without them.

---

## Fact-check before you use it

Every number in the prompt traces to `MODEL-CARD.md`:

| Feature | Importance | Source |
|---|---|---|
| `road_density` | 26.0% | §5.3 |
| `major_frac` | 12.9% | §5.3 |
| `sink` | 11.7% | §5.3 |
| `hand` | 10.3% | §5.3 |
| `load_per_road` | 10.2% | §5.3 |
| `relelev` | 9.6% | §5.3 |
| `logacc` | 7.1% | §5.3 |
| `slope` | 6.2% | §5.3 |
| `twi` | 6.0% | §5.3 |

Sum = 100.0%. Urban form (`road_density` + `major_frac` + `load_per_road`) = 38.8%.

---

## A note on the reference image

The card that inspired this — NDVI, NDWI, NDRE, NDMI, SAVI, TVI, LCI — is a
dictionary of **spectral indices**. Those are arithmetic ratios of reflectance
bands from multispectral imagery: NDVI, for instance, is (NIR − Red) ÷ (NIR + Red).
They measure how a surface *reflects light*.

Mityaf's nine features are a different family entirely. Six are **terrain
derivatives** computed from an elevation grid, and three are **urban-form metrics**
computed from road geometry. Not one of them touches a reflectance band, and the
model consumes no imagery at all.

The visual format transfers. The category does not — worth knowing before a judge
asks whether Mityaf "uses NDVI."
