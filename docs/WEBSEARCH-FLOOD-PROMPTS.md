# Web-search prompts — Madinah street-flooding incidents

Three tools, three formats. Google wants **operators**, Perplexity wants a
**research question with an output contract**, and a deep-research agent wants a
**task brief**. The same prose pasted into all three gets poor results from at
least two of them.

Everything here carries the lessons already paid for:

- Saudi sources date in **Hijri** — one confirmed report was `1445/10/20هـ`
  (29 April 2024, a Monday, matching the post's own اليوم الاثنين).
- **Fence the geography.** A search on منحدر returned a road accident in
  قسنطينة, Algeria. North African civil-protection bulletins use بلدية and
  الطريق الوطني and read like Saudi incident reports.
- **Two mechanisms.** Water that *stays for days* (a closed depression) and
  water that *sheets across during the storm* (runoff convergence) are
  different phenomena. Ask about both.
- **ERA5 is blind to August.** Summer convective storms are missing from the
  reanalysis but real on the ground — 30 Aug 2024 measured 27.5 mm in NASA
  POWER and 0.4 mm in ERA5. Do not discard a summer report for lack of
  recorded rain.

---

## 1 · Google — paste these one at a time

Arabic first; these return the most.

```
"غرق شوارع" "المدينة المنورة" أمطار
"تجمعات مياه" "المدينة المنورة" شوارع
"شفط المياه" OR "صهاريج" "المدينة المنورة" أمطار حي
أمطار "المدينة المنورة" "حي" غرق -وادي -جدة -مكة
"المدينة المنورة" أمطار غزيرة شوارع site:sabq.org
"المدينة المنورة" أمطار غرق site:okaz.com.sa
"المدينة المنورة" أمطار تجمعات site:al-madina.com
أمانة "المدينة المنورة" "تجمعات مياه الأمطار" معالجة
"الدفاع المدني" "المدينة المنورة" أمطار انقاذ مركبة
```

English, fewer but sometimes better dated:

```
Madinah OR Medina Saudi street flooding rain "district"
"Al Madinah" flooded streets rainfall report 2018..2026
```

**Restrict by date** in Tools → Any time → Custom range, around the heaviest
recorded days:

```
2018-10-31   41 mm in 21 h   ← largest on record
2019-01-28   29 mm
2020-12-27   21 mm
2022-12-23   16 mm
2023-01-03   44 mm in 18 h
2024-03-19   12 mm
2026-03-26   26 mm in 11 h
```

Also try **YouTube** directly — video is often the only record:
`أمطار المدينة المنورة غرق شوارع` filtered by upload date.

---

## 2 · Perplexity — one prompt, expects sources

> Research reported incidents of **rainwater flooding or standing water on
> streets in Al Madinah (المدينة المنورة), Saudi Arabia**, from 2015 to today.
> Search in Arabic and English. Use news sites (Sabq, Okaz, Al-Madina,
> Al-Arabiya, Al-Riyadh), municipal and civil-defence statements, and YouTube
> descriptions.
>
> For every incident you find, give me:
>
> | Gregorian date | Hijri date if the source uses one | District (حي) | Street or landmark, quoted exactly | What the source says | Did water remain for hours/days, or only during the storm? | Source URL |
>
> **Constraints:**
> - **Al Madinah, Saudi Arabia only.** Exclude Jeddah, Mecca, Riyadh, Taif and
>   everything outside Saudi Arabia. Reject North African results — Algerian,
>   Moroccan and Tunisian civil-protection bulletins use بلدية and
>   الطريق الوطني and can look like Saudi reports.
> - **Exclude wadi and flash-flood coverage** (وادي, سيل, جريان الأودية) unless
>   the same source also describes water standing on a residential street.
> - **Convert all Hijri dates** and give both.
> - Quote place names **verbatim**; do not normalise or infer a district.
> - Every row needs a **working URL**. No URL, no row.
> - If you find fewer than 20, say so rather than padding.
>
> Note especially whether each report describes water that **stayed for days
> and had to be pumped by tankers**, versus water that **covered the road during
> the rain and drained afterwards** — I am studying these as two separate
> phenomena.

---

## 3 · Deep-research agent (Manus, ChatGPT deep research, Claude, Gemini)

> **Task.** Build a dated register of street-flooding incidents in Al Madinah,
> Saudi Arabia, 2015–2026, from open web sources. Output a CSV I can merge into
> an existing register.
>
> **Columns:** `date_gregorian, date_hijri, district_ar, street_ar,
> description_ar, duration (storm-only / hours / days), tankers_mentioned
> (y/n), media (photo/video/none), source_url, source_type
> (news/official/social/video), confidence (high/medium/low)`
>
> **Sources to work through:** Saudi news (Sabq, Okaz, Al-Madina, Al-Riyadh,
> Al-Arabiya, Al-Watan), أمانة منطقة المدينة المنورة statements and their X
> account, الدفاع المدني bulletins, YouTube uploads, local forums, and Google
> Maps reviews mentioning تجمع مياه or غرق on specific streets.
>
> **Search terms:** غرق شوارع · تجمعات مياه الأمطار · أمطار المدينة المنورة ·
> مياه راكدة · صهريج شفط المياه · وايت شفط · طفح · انغمار · حجز مياه ·
> غرق الشارع — each alone and combined with the district names below.
>
> **Districts:** الملك فهد · السلام · قباء · العزيزية · التلعة · النقاء ·
> الخالدية · الدفاع · الجامعة · جماء أم خالد · الرانوناء · البركة · المبعوث ·
> العاقول · السيح · الروابي · شوران · قربان · بني خدرة · بني ظفر · العوالي ·
> الراية · المناخة · الجمعة · الفتح · سلطانة
>
> **Rules:**
> - Saudi Arabia, Al Madinah only. Explicitly reject Algerian/Moroccan/Tunisian
>   civil-protection reports, which use بلدية and الطريق الوطني.
> - Exclude wadi flash floods unless streets are also described.
> - Convert every Hijri date and give both.
> - **Do not discard summer (June–September) reports for lack of recorded
>   rainfall.** Reanalysis datasets systematically miss convective storms here;
>   30 August 2024 shows 27.5 mm in NASA POWER and 0.4 mm in ERA5, and the
>   street flooding that day is on video.
> - Mark `confidence: low` rather than dropping a partial record, and never
>   invent a date, place or URL.
>
> Return the CSV plus a short note on which searches produced nothing, so I
> know what has been ruled out.

---

## 4 · The targeted queries that matter most

These test predictions rather than gathering more of what we have.

**Districts the model flags that nobody has reported.** If flooding turns up
here, the method generalises beyond the districts already known:

```
"حي الدفاع" "المدينة المنورة" أمطار OR غرق OR "تجمع مياه"
"حي الجامعة" "المدينة المنورة" أمطار غرق
"جماء أم خالد" أمطار مياه
"حي الخالدية" "المدينة المنورة" غرق أمطار
"حي الرانوناء" "المدينة المنورة" تجمعات مياه
```

**The largest event on record**, 31 October 2018 (41 mm in 21 hours), which
should have generated coverage:

```
أمطار "المدينة المنورة" أكتوبر 2018 غرق شوارع
"المدينة المنورة" أمطار "2018" سيول شوارع صور
```

**Semi-official records** — tanker dispatches and road closures are dated,
located and already written down:

```
أمانة "المدينة المنورة" صهاريج شفط مياه الأمطار عدد المواقع
"المدينة المنورة" إغلاق طريق بسبب تجمع مياه الأمطار
```

---

## What happens to the results

Send me any table. Each row gets checked against the rainfall archive the way
the existing nine were — **two independent sources**, since ERA5 alone misses
summer storms. Then the location is matched to the nearest scored street
segment and added to `out/incidents/incident_register.csv`.

Current state: **14 incidents, 11 corroborated**, 3 with precise coordinates.
