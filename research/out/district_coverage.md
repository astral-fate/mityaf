# District coverage gap — five missing districts

Five district names appear in verified flood reports but do not appear as
`district_ar` values in `research/out/madinah_segments_features.csv` (91
distinct districts checked, exact and substring match, none found):
**حي الغربية, الجبور, سلطانة, المعيقلة, مخطط باقدو**.

## Method

Each name was geocoded with Nominatim
(`https://nominatim.openstreetmap.org/search?q=<name>+المدينة+المنورة&format=json&countrycodes=sa`),
one request per second, `User-Agent` header set. Several query variants were
tried per name (with/without country-code restriction, with/without the city
suffix, alternate spellings, and the road context from the source report —
"طريق الهجرة") before concluding a name could not be located. Returned
coordinates were checked against the AOI bbox `(39.50, 24.36)–(39.72, 24.58)`
(`research/cities.py`) and against the mean lat/lon (centroid) of each of the
91 `district_ar` groups in the features CSV, using haversine distance.

**Sanity check on the method:** geocoding "العزيزية المدينة المنورة" (a
district we know is in our data) returned an OSM administrative boundary at
(24.4196432, 39.5006558), only 783 m from that district's own centroid in our
features CSV (24.419254, 39.508376). This confirms the geocode-then-nearest-centroid
approach correctly resolves a real, in-AOI district to itself, which is the
baseline the five unknowns are judged against.

## Findings

| Name | Geocoded lat/lon | Inside bbox? | Nearest district in our data (distance) | Conclusion |
|---|---|---|---|---|
| سلطانة | 24.4889300, 39.5819469 (OSM: "طريق سلطانة" / Sultana Road, بئر عثمان, way, highway=primary) | **yes** | بئر عثمان — 583 m | **(a)** present under a different name. "سلطانة" is a road/informal locality inside the بئر عثمان district polygon already in our data; it is not a missing area, just a name our district labels don't carry. |
| حي الغربية | not found | — | — | **neither (a) nor (b) confirmed** — see caveat below |
| الجبور | not found | — | — | **neither (a) nor (b) confirmed** — see caveat below |
| المعيقلة | not found (only unrelated hit: "الميقلة", Ibb governorate, Yemen — ~1,500 km away, discarded) | — | — | **neither (a) nor (b) confirmed** — see caveat below |
| مخطط باقدو | not found | — | — | **neither (a) nor (b) confirmed** — see caveat below |

Query variants tried per not-found name (all returned zero Al-Madinah-region
results, or results in other regions of Saudi Arabia — Riyadh, Jeddah,
Jazan — that are clearly not the referenced place):
- `<name> المدينة المنورة`, `<name>` alone, `حي <name>`, `<name> طريق الهجرة المدينة المنورة`, and spelling variants (e.g. `معيقله`, `قدو`).

## Caveat — do not read "not found" as "outside the AOI"

Nominatim/OSM has no entry for حي الغربية, الجبور, المعيقلة, or مخطط باقدو
anywhere in the Al Madinah region under any query variant tried. This is
**not the same as confirming they lie outside the bbox** — option (b). OSM
coverage of informal neighbourhood names, small residential subdivisions
(مخطط = a licensed land-subdivision plan, a common Saudi naming pattern that
often postdates or sits below the level OSM's community mapping reaches),
and colloquial district nicknames is known to be incomplete, especially
compared to a name like العزيزية that has a formal administrative boundary.

The one substantive lead: the 2018-02-25 source report places سلطانة and
مخطط باقدو together with "طريق الهجرة" (Al-Hijra Road), and سلطانة resolved
inside the AOI on that same road corridor (بئر عثمان, western part of the
city, near العزيزية). That is circumstantial support for مخطط باقدو and
possibly الجبور/حي الغربية also sitting inside the AOI along the same
corridor or an adjacent one — but it is not a geocode-confirmed match, and no
bbox coordinate exists for these four names to test.

**Consequence flagged per the brief:** حي الغربية / الجبور is the district
carrying the only documented flood *duration* in the project (water
remaining up to five days, per the 2015-11-19 Al-Madina report — now in
`research/incident_register.py`). Its absence from `district_ar` in the
features CSV is confirmed; whether that absence is (a) a labeling gap over
ground we already cover, or (b) a genuine hole in the AOI, is **not
resolved** by this task. Recommend this be escalated as an open item before
any coverage claim is made public — resolving it would need either an
official Al Madinah municipality district-boundary shapefile/GIS layer (to
place مخطط باقدو and حي الغربية precisely) or manual identification from the
source article's fuller text/imagery, both out of scope for this task per
the brief ("do not widen the bbox or re-fetch OSM — report only").
