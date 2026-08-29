# Grok prompt — finding Madinah street-flooding reports on X

Grok's one real advantage over other assistants is live access to X. So the
prompt below asks it to **retrieve posts**, not to reason or summarise from
memory. Everything it returns should be a post you can open and check.

Two lessons already paid for, both built into the prompt:

- **Saudi posts date in Hijri.** The one confirmed report so far was dated
  `1445/10/20هـ`, which converts to 29 April 2024 — a Monday, matching the
  post's own اليوم الاثنين. Ask for both calendars or you will lose half the
  results.
- **Fence the geography hard.** A search on منحدر (slope) returned a traffic
  accident in قسنطينة, Algeria. Algerian civil-protection bulletins use
  بلدية and الطريق الوطني and read superficially like incident reports.

---

## The prompt

> Search X for posts reporting rainwater flooding or standing water on streets
> in **Al Madinah / المدينة المنورة, Saudi Arabia only**. Go back as far as the
> archive allows, ideally to 2015.
>
> Search in Arabic. Use these terms and their variants, alone and combined with
> المدينة المنورة:
>
> غرق شوارع · تجمعات مياه الأمطار · أمطار المدينة المنورة · السيول ·
> غرق الشارع · مياه راكدة · صهريج شفط المياه · وايت شفط · طفح المجاري ·
> انغمار · حجز مياه · الأمطار الغزيرة المدينة
>
> Also search each district name with أمطار or غرق: حي الملك فهد · حي السلام ·
> حي النقاء · قباء · العوالي · الراية · بني خدرة · المناخة · الجمعة · الفتح ·
> شوران · بني ظفر · حي البحر · العزيزية · الدفاع · الخالدية · سلطانة
>
> **Return a table, one row per distinct incident:**
>
> | Date (Gregorian) | Date (Hijri, if the post uses it) | District / حي | Street or landmark named | What the post says | Post link | Account |
>
> **Rules:**
>
> - **Al Madinah, Saudi Arabia only.** Exclude Jeddah, Mecca, Riyadh, Taif, and
>   anything outside Saudi Arabia. Reject any post using بلدية or الطريق الوطني
>   in the Algerian/Moroccan/Tunisian sense — those are North African
>   civil-protection bulletins, not Saudi.
> - **Exclude wadi and flash-flood coverage** (وادي, سيل الوادي, جريان الأودية)
>   unless the post also describes water standing on a residential street. I am
>   studying water that pools and remains on streets, not torrents in valleys.
> - **Convert every Hijri date to Gregorian** and state both.
> - **Quote the location exactly as the post writes it** — do not normalise or
>   guess a district. If the post names a street, road, roundabout, mosque or
>   park, include it verbatim.
> - **Always include the link.** A row without a link is useless to me.
> - Note whether the post carries a **photo or video**, and whether any reply
>   gives a more precise location.
> - If you find fewer than 15 incidents, say so plainly rather than padding the
>   table. Do not invent posts, dates or links.
>
> Order the table by date, oldest first.

---

## Follow-up prompts

Run these after the first table comes back.

1. For each incident, search the replies and quote-tweets for a **more precise
   location** — a street name, a plus code, a dropped pin, or a landmark.
2. Which of these locations appears **more than once across different years**?
   Those are chronic sites and matter most to me.
3. Find posts from **أمانة المدينة المنورة**, **بلدية** accounts or
   **الدفاع المدني** about pumping, tankers (صهاريج), or road closures after
   rain in Madinah, with dates.
4. Search these specific dates for Madinah flooding posts — they are the
   heaviest rainfall days on record and are likely to have been posted about:
   **2018-10-31 (51 mm), 2019-01-28, 2020-12-27, 2022-12-23, 2023-01-03,
   2024-03-19, 2026-03-26**.

---

## What to do with the results

Anything that comes back with a **date and a district** can be checked the same
way the existing register was: the rainfall archive either confirms rain in
Madinah on that day or it does not. Six of nine reports so far were corroborated
that way, and the two that failed were dropped rather than argued for.

Send me the table and I will run each row against the rainfall record and
against the scored street segments, and add the confirmed ones to
`out/incidents/incident_register.csv`.

Highest value of all: a post with a **photo whose location data survived**.
`research/photo_locations.py` reads coordinates and timestamp straight out of
the file. Note, though, that images downloaded from X have their metadata
stripped — the value there is the caption and the replies, not the file.
