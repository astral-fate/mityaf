# -*- coding: utf-8 -*-
"""Draw the tunnel survey sheet from tunnels-inspect.json.

Every line on the page is real geometry: the plan views are the OSM centrelines
projected to metres, the profiles are the Copernicus DEM sampled every 15 m
along those same centrelines. Nothing is illustrative.

The page has to answer three questions the count «47» cannot:

  what are they      42 roofed, 4 open cuttings, 1 neither -- and an open
                     cutting is not a tunnel, whatever the layer tag says
  how many are there 47 ways cluster to 20 structures, because OSM splits a
                     dual carriageway into one way per direction
  why a tag at all   the DEM profile runs FLAT across the dip, because the
                     satellite measured the deck over the road. That is the
                     whole case for reading this class from a map instead

SVG is generated here rather than in the browser so the page stays static and
carries no runtime.

    .venv/Scripts/python.exe render_tunnel_page.py
"""
from __future__ import annotations

import html
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "tunnels-inspect.json"
CACHE = HERE / "cache" / "madinah"
OUT = HERE / "tunnels-inspect.html"

R_EARTH = 111_320.0


def project(pts, cx, cy):
    """Equirectangular metres about a local origin -- fine at city scale."""
    k = math.cos(math.radians(cy))
    return [((lon - cx) * k * R_EARTH, -(lat - cy) * R_EARTH) for lon, lat in pts]


def fit(groups, w, h, pad):
    """Scale a set of projected polylines into a viewBox, preserving aspect."""
    pts = [p for g in groups for p in g]
    if not pts:
        return lambda p: (0, 0), 1.0
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    sx = (w - 2 * pad) / (x1 - x0) if x1 > x0 else 1e9
    sy = (h - 2 * pad) / (y1 - y0) if y1 > y0 else 1e9
    s = min(sx, sy)
    ox = pad + ((w - 2 * pad) - (x1 - x0) * s) / 2
    oy = pad + ((h - 2 * pad) - (y1 - y0) * s) / 2
    return (lambda p: (ox + (p[0] - x0) * s, oy + (p[1] - y0) * s)), s


def path_d(pts, tr):
    return "M" + "L".join(f"{tr(p)[0]:.1f} {tr(p)[1]:.1f}" for p in pts)


def esc(x):
    return html.escape(str(x)) if x is not None else "—"


# ── plan view of one structure ──────────────────────────────────────────────
def plan_svg(ways, w=340, h=150):
    cx = sum(p[0] for m in ways for p in m["geometry"]) / sum(
        len(m["geometry"]) for m in ways)
    cy = sum(p[1] for m in ways for p in m["geometry"]) / sum(
        len(m["geometry"]) for m in ways)
    projs = [project(m["geometry"], cx, cy) for m in ways]
    tr, scale = fit(projs, w, h, 16)
    out = [f'<svg viewBox="0 0 {w} {h}" class="plan" role="img" '
           f'aria-label="مخطط أفقي للمنشأة، {len(ways)} مسار">']
    for m, pr in zip(ways, projs):
        cls = "cut" if m["cutting"] else "roof"
        out.append(f'<path d="{path_d(pr, tr)}" class="ln {cls}"/>')
    # scale bar: a round number of metres in the drawing's own units
    if scale < 1e8:
        for step in (25, 50, 100, 200, 500):
            if step * scale > 42:
                break
        px = step * scale
        out.append(f'<g class="sb"><line x1="14" y1="{h-13}" x2="{14+px:.0f}" '
                   f'y2="{h-13}"/><line x1="14" y1="{h-17}" x2="14" '
                   f'y2="{h-9}"/><line x1="{14+px:.0f}" y1="{h-17}" '
                   f'x2="{14+px:.0f}" y2="{h-9}"/>'
                   f'<text x="{18+px:.0f}" y="{h-9}">{step} m</text></g>')
    out.append("</svg>")
    return "".join(out)


# ── DEM profile: the argument for the rule ──────────────────────────────────
def profile_svg(prof, w=340, h=86):
    if len(prof) < 2:
        return ('<div class="noprof">المسار أقصر من خليّة النموذج — '
                'لا يوجد مقطع رأسي</div>')
    lo, hi = min(prof), max(prof)
    span = max(hi - lo, 2.0)
    mid = (hi + lo) / 2
    lo, hi = mid - span / 2, mid + span / 2
    pad = 14
    xs = [pad + i * (w - 2 * pad) / (len(prof) - 1) for i in range(len(prof))]
    ys = [h - pad - (v - lo) / (hi - lo) * (h - 2 * pad) for v in prof]
    d = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in zip(xs, ys))
    area = d + f"L{xs[-1]:.1f} {h-pad}L{xs[0]:.1f} {h-pad}Z"
    return (
        f'<svg viewBox="0 0 {w} {h}" class="prof" role="img" '
        f'aria-label="مقطع ارتفاع النموذج الرقمي على طول المسار، '
        f'المدى {hi-lo:.1f} متر">'
        f'<path d="{area}" class="pf-a"/><path d="{d}" class="pf-l"/>'
        f'<text x="{pad}" y="11" class="pf-t">{hi:.0f} m</text>'
        f'<text x="{pad}" y="{h-3}" class="pf-t">{lo:.0f} m</text>'
        f'<text x="{w-pad}" y="11" class="pf-t r">Δ {hi-lo:.1f} m</text>'
        f"</svg>")


def main() -> None:
    d = json.loads(DATA.read_text(encoding="utf-8"))
    ways = {w["id"]: w for w in d["ways"]}
    structures = d["structures"]

    roofed = sum(w["roofed"] for w in d["ways"])
    cutting = sum(w["cutting"] for w in d["ways"])
    neither = sum(1 for w in d["ways"] if not w["roofed"] and not w["cutting"])
    r1 = sum(1 for w in d["ways"]
             if w["sink"] is not None and w["sink"] > 0.05 and w["hand"] < 0)
    above = sum(1 for w in d["ways"] if w["hand"] is not None and w["hand"] >= 0)
    lens = sorted(w["length_m"] for w in d["ways"])
    med = lens[len(lens) // 2]

    # ── overview plan, with the arterial network for orientation ────────────
    els = json.loads((CACHE / "roads.json").read_text(encoding="utf-8"))["elements"]
    major = [[(p["lon"], p["lat"]) for p in e.get("geometry", [])]
             for e in els
             if e.get("tags", {}).get("highway") in ("motorway", "trunk", "primary")
             and len(e.get("geometry", [])) > 1]
    lon0, lat0, lon1, lat1 = d["bbox"]
    cx, cy = (lon0 + lon1) / 2, (lat0 + lat1) / 2
    OW, OH = 1000, 560
    pm = [project(g, cx, cy) for g in major]
    pt = [project(w["geometry"], cx, cy) for w in d["ways"]]
    # Fit to the structures, not to the road network: the arterials run far out
    # into open desert, and fitting to them shrinks every underpass to a dot in
    # the middle of an empty sheet. 2.5 km of context on each side is enough to
    # place them against the ring roads.
    pad_m = 2500.0
    txs = [p[0] for g in pt for p in g]
    tys = [p[1] for g in pt for p in g]
    frame = [[(min(txs) - pad_m, min(tys) - pad_m),
              (max(txs) + pad_m, max(tys) + pad_m)]]
    tr, oscale = fit(frame, OW, OH, 26)
    ov = [f'<svg viewBox="0 0 {OW} {OH}" class="overview" role="img" '
          f'aria-label="مخطط المدينة المنورة يبيّن مواقع الـ47 مساراً تحت '
          f'منسوب الأرض على شبكة الطرق الرئيسية">']
    ov.append(f'<clipPath id="fr"><rect x="0" y="0" width="{OW}" '
              f'height="{OH}"/></clipPath>')
    ov.append('<g class="net" clip-path="url(#fr)">')
    for g in pm:
        ov.append(f'<path d="{path_d(g, tr)}"/>')
    ov.append("</g>")
    for w, g in zip(d["ways"], pt):
        cls = "cut" if w["cutting"] else "roof"
        ov.append(f'<path d="{path_d(g, tr)}" class="hit {cls}"/>')
    for w, g in zip(d["ways"], pt):
        p = tr(g[len(g) // 2])
        cls = "cut" if w["cutting"] else "roof"
        ov.append(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="5.5" '
                  f'class="dot {cls}"><title>{esc(w["name"])} · '
                  f'{w["length_m"]:.0f} m</title></circle>')
    for step in (500, 1000, 2000):
        if step * oscale > 90:
            break
    px = step * oscale
    ov.append(f'<g class="sb"><line x1="26" y1="{OH-24}" x2="{26+px:.0f}" '
              f'y2="{OH-24}"/><line x1="26" y1="{OH-29}" x2="26" y2="{OH-19}"/>'
              f'<line x1="{26+px:.0f}" y1="{OH-29}" x2="{26+px:.0f}" '
              f'y2="{OH-19}"/><text x="{31+px:.0f}" y="{OH-19}">'
              f'{step/1000:g} km</text></g>')
    ov.append("</svg>")

    # ── structure cards ─────────────────────────────────────────────────────
    cards = []
    for i, s in enumerate(structures, 1):
        mem = [ways[i_] for i_ in s["way_ids"]]
        longest = max(mem, key=lambda m: m["length_m"])
        kind = ("مغطّى" if s["roofed"] and not s["cutting"]
                else "حفر مكشوف" if s["cutting"] and not s["roofed"]
                else "مختلط")
        kcls = ("roof" if kind == "مغطّى" else "cut" if kind == "حفر مكشوف"
                else "mix")
        blind = longest["hand"] is not None and longest["hand"] >= 0
        cards.append(f"""
<article class="card">
  <header>
    <span class="rk">{i:02d}</span>
    <div class="hd">
      <h3>{esc(s["name"] or "مسار بلا اسم")}</h3>
      <p class="sub">{esc(s["district"])} · {esc(s["highway"])}</p>
    </div>
    <span class="tag {kcls}">{kind}</span>
  </header>
  {plan_svg(mem)}
  <dl class="facts">
    <div><dt>أطول مسار</dt><dd class="m">{longest["length_m"]:.0f} m</dd></div>
    <div><dt>مسارات OSM</dt><dd class="m">{s["ways"]}</dd></div>
    <div><dt>المستوى</dt><dd class="m">{longest["layer"]}</dd></div>
    <div><dt>الحارات</dt><dd class="m">{esc(longest["lanes"])}</dd></div>
  </dl>
  <div class="pwrap">
    <h4>مقطع النموذج الرقمي على طول المسار</h4>
    {profile_svg(longest["dem_profile"])}
    <p class="rd {"blind" if blind else ""}">
      {"النموذج يضع الطريق فوق المجرى (hand = " + f"{longest['hand']:+.2f}"
       + " m) — القاعدتان الأولى والثانية لا تريانه"
       if blind else
       "hand = " + f"{longest['hand']:+.2f}" + " m · sink = "
       + f"{longest['sink']:.2f}" + " m"}
    </p>
  </div>
</article>""")

    rows = []
    for w in sorted(d["ways"], key=lambda z: -z["length_m"]):
        kind = "حفر مكشوف" if w["cutting"] else "مغطّى" if w["roofed"] else "مستوى سالب"
        kcls = "cut" if w["cutting"] else "roof" if w["roofed"] else "mix"
        rows.append(
            f'<tr><td class="nm">{esc(w["name"])}</td>'
            f'<td>{esc(w["district"])}</td>'
            f'<td><span class="tag sm {kcls}">{kind}</span></td>'
            f'<td class="m">{esc(w["highway"])}</td>'
            f'<td class="m">{w["length_m"]:.0f}</td>'
            f'<td class="m">{w["layer"]}</td>'
            f'<td class="m">{w["hand"]:+.2f}</td>'
            f'<td class="m">{w["sink"]:.2f}</td>'
            f'<td class="m">{esc(w["id"])}</td></tr>')

    OUT.write_text(PAGE.format(
        overview="".join(ov), cards="".join(cards), rows="".join(rows),
        n_ways=len(d["ways"]), n_struct=len(structures), roofed=roofed,
        cutting=cutting, neither=neither, r1=r1, blind=len(d["ways"]) - r1,
        above=above, med=f"{med:.0f}", longest=f"{lens[-1]:.0f}",
        shortest=f"{lens[0]:.0f}", cluster=f"{d['cluster_m']:.0f}",
    ), encoding="utf-8")
    print(f"wrote {OUT.name}  ({OUT.stat().st_size/1024:.0f} KB)")


PAGE = """<title>مسح أنفاق المدينة</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">
<style>
:root {{
  --paper:#eceef0; --card:#f6f7f8; --ink:#131a1f; --muted:#5c666e;
  --rule:#c3c9cd; --hair:#d7dcdf;
  --roof:#10556f; --cut:#a8541f; --mix:#5b6d54; --dem:#7d8790;
  --net:#b9c1c6;
  --ar:"IBM Plex Sans Arabic",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,monospace;
  --dis:"Archivo","IBM Plex Sans Arabic",system-ui,sans-serif;
}}
@media (prefers-color-scheme:dark) {{
  :root:not([data-theme="light"]) {{
    --paper:#0f1418; --card:#161d23; --ink:#dfe5e9; --muted:#93a0a9;
    --rule:#2a333a; --hair:#212a30;
    --roof:#4aa8cd; --cut:#e0975c; --mix:#9dbb90; --dem:#6f7c85; --net:#2d373e;
  }}
}}
:root[data-theme="dark"] {{
  --paper:#0f1418; --card:#161d23; --ink:#dfe5e9; --muted:#93a0a9;
  --rule:#2a333a; --hair:#212a30;
  --roof:#4aa8cd; --cut:#e0975c; --mix:#9dbb90; --dem:#6f7c85; --net:#2d373e;
}}
*{{box-sizing:border-box}}
body{{background:var(--paper);color:var(--ink);font-family:var(--ar);
  direction:rtl;line-height:1.6;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:1180px;margin:0 auto;padding:32px 22px 90px}}
.m,.mono{{font-family:var(--mono);font-variant-numeric:tabular-nums;
  direction:ltr;unicode-bidi:isolate}}

/* ── drawing-sheet title block ────────────────────────────────────────── */
.sheet{{border:1.5px solid var(--ink);background:var(--card)}}
.sheet .ttl{{padding:22px 26px 18px;border-bottom:1.5px solid var(--ink)}}
.eyebrow{{font-family:var(--mono);font-size:11.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--muted);margin:0 0 8px}}
h1{{font-family:var(--dis);font-weight:700;font-size:clamp(26px,4.2vw,40px);
  line-height:1.15;margin:0;text-wrap:balance}}
.lede{{margin:12px 0 0;max-width:66ch;color:var(--muted);font-size:15.5px}}
.blk{{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr))}}
.blk > div{{padding:14px 18px;border-inline-start:1px solid var(--hair)}}
.blk > div:first-child{{border-inline-start:0}}
.blk dt{{font-size:11.5px;letter-spacing:.06em;color:var(--muted);margin:0 0 3px}}
.blk dd{{margin:0;font-family:var(--mono);font-size:23px;font-weight:600;
  direction:ltr;unicode-bidi:isolate;text-align:start}}
.blk .u{{font-size:12px;color:var(--muted);font-weight:400}}

h2{{font-family:var(--dis);font-weight:600;font-size:22px;margin:46px 0 6px;
  padding-bottom:8px;border-bottom:1px solid var(--rule)}}
h2 .n{{font-family:var(--mono);font-size:13px;color:var(--muted);
  margin-inline-end:10px}}
.note{{color:var(--muted);font-size:14.5px;max-width:74ch;margin:10px 0 18px}}

/* ── overview plan ────────────────────────────────────────────────────── */
.ovwrap{{background:var(--card);border:1px solid var(--rule);padding:8px;
  overflow-x:auto}}
svg.overview{{display:block;width:100%;height:auto;min-width:640px}}
.overview .net path{{fill:none;stroke:var(--net);stroke-width:1.1}}
.overview .hit{{fill:none;stroke-width:3.4;stroke-linecap:round}}
.overview .dot{{stroke:var(--card);stroke-width:1.5}}
.hit.roof,.dot.roof{{stroke:var(--roof)}} .dot.roof{{fill:var(--roof)}}
.hit.cut,.dot.cut{{stroke:var(--cut)}}  .dot.cut{{fill:var(--cut)}}
.sb line{{stroke:var(--muted);stroke-width:1.2}}
.sb text{{font-family:var(--mono);font-size:11px;fill:var(--muted);
  direction:ltr}}

.legend{{display:flex;flex-wrap:wrap;gap:18px;margin:12px 0 0;
  font-size:13.5px;color:var(--muted)}}
.legend i{{display:inline-block;width:22px;height:3px;vertical-align:middle;
  margin-inline-end:7px}}
.legend .r{{background:var(--roof)}} .legend .c{{background:var(--cut)}}
.legend .n{{background:var(--net)}}

/* ── the explainer section ────────────────────────────────────────────── */
figure{{margin:0}}
figcaption{{font-size:13.5px;color:var(--muted);margin-top:10px;max-width:70ch}}
.xs{{background:var(--card);border:1px solid var(--rule);padding:14px;
  overflow-x:auto}}
.xs svg{{display:block;width:100%;height:auto;min-width:520px}}

/* ── structure cards ──────────────────────────────────────────────────── */
.grid{{display:grid;gap:16px;
  grid-template-columns:repeat(auto-fill,minmax(322px,1fr))}}
.card{{background:var(--card);border:1px solid var(--rule);padding:15px 16px 14px}}
.card header{{display:flex;gap:11px;align-items:flex-start;
  padding-bottom:11px;border-bottom:1px solid var(--hair)}}
.rk{{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--muted);
  border:1px solid var(--rule);padding:2px 6px;flex:none;margin-top:2px}}
.hd{{flex:1;min-width:0}}
.card h3{{font-size:16px;font-weight:600;margin:0;line-height:1.35;
  overflow-wrap:anywhere}}
.sub{{margin:2px 0 0;font-size:12.5px;color:var(--muted)}}
.tag{{font-size:11.5px;font-weight:600;padding:3px 8px;flex:none;
  border:1px solid currentColor;white-space:nowrap}}
.tag.roof{{color:var(--roof)}} .tag.cut{{color:var(--cut)}}
.tag.mix{{color:var(--mix)}}
.tag.sm{{font-size:10.5px;padding:1px 5px}}
svg.plan{{display:block;width:100%;height:auto;margin:12px 0 4px}}
.plan .ln{{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}}
.plan .roof{{stroke:var(--roof)}} .plan .cut{{stroke:var(--cut)}}
.facts{{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0 0;
  padding:10px 0;border-block:1px solid var(--hair)}}
.facts div{{min-width:0}}
.facts dt{{font-size:10.5px;color:var(--muted);margin:0}}
.facts dd{{margin:1px 0 0;font-family:var(--mono);font-size:14px;font-weight:600;
  direction:ltr;unicode-bidi:isolate;text-align:start}}
.pwrap h4{{font-size:11.5px;font-weight:500;color:var(--muted);margin:11px 0 2px;
  letter-spacing:.02em}}
svg.prof{{display:block;width:100%;height:auto}}
.pf-a{{fill:var(--dem);opacity:.17}}
.pf-l{{fill:none;stroke:var(--dem);stroke-width:1.9}}
.pf-t{{font-family:var(--mono);font-size:9.5px;fill:var(--muted);direction:ltr}}
.pf-t.r{{text-anchor:end}}
.noprof{{font-size:12px;color:var(--muted);padding:14px 0}}
.rd{{margin:6px 0 0;font-size:12px;color:var(--muted);font-family:var(--mono);
  direction:ltr;unicode-bidi:isolate;text-align:start}}
.rd.blind{{color:var(--cut);font-family:var(--ar);direction:rtl;text-align:start}}

/* ── table ────────────────────────────────────────────────────────────── */
.tw{{overflow-x:auto;border:1px solid var(--rule);background:var(--card)}}
table{{border-collapse:collapse;width:100%;min-width:780px;font-size:13px}}
th,td{{padding:7px 11px;text-align:start;border-bottom:1px solid var(--hair);
  white-space:nowrap}}
th{{font-size:11px;letter-spacing:.05em;color:var(--muted);font-weight:600;
  position:sticky;top:0;background:var(--card);
  border-bottom:1.5px solid var(--rule)}}
td.m{{font-family:var(--mono);font-variant-numeric:tabular-nums;direction:ltr;
  unicode-bidi:isolate}}
td.nm{{max-width:270px;overflow:hidden;text-overflow:ellipsis}}
tbody tr:last-child td{{border-bottom:0}}
footer{{margin-top:46px;padding-top:16px;border-top:1px solid var(--rule);
  font-size:12.5px;color:var(--muted)}}
@media (max-width:600px){{
  .blk > div{{border-inline-start:0;border-top:1px solid var(--hair)}}
  .facts{{grid-template-columns:repeat(2,1fr)}}
}}
</style>

<div class="wrap">

<div class="sheet">
  <div class="ttl">
    <p class="eyebrow">مِطياف · تدقيق التصنيف الثالث</p>
    <h1>ما هي الـ<span class="m">{n_ways}</span> «نفقاً» فعلاً؟</h1>
    <p class="lede">القاعدة الثالثة وحدها لا تُقرأ من التضاريس بل من وسم في
      الخريطة، لأنّ النموذج الرقمي يقيس السقف لا الطريق. وهذا يجعلها القاعدة
      الأجدر بالفحص بالعين: لا شيء في بيانات الارتفاع يستطيع أن يكذّب وسماً
      خاطئاً.</p>
  </div>
  <dl class="blk">
    <div><dt>مسارات OSM</dt><dd>{n_ways}</dd></div>
    <div><dt>منشآت فعلية</dt><dd>{n_struct}</dd></div>
    <div><dt>مغطّى</dt><dd>{roofed}</dd></div>
    <div><dt>حفر مكشوف</dt><dd>{cutting}</dd></div>
    <div><dt>لا يراها النموذج</dt><dd>{blind}<span class="u"> / {n_ways}</span></dd></div>
    <div><dt>الطول الوسيط</dt><dd>{med}<span class="u"> m</span></dd></div>
  </dl>
</div>

<h2><span class="n">01</span>أين هي</h2>
<p class="note">كل خط أدناه هو المحور الحقيقي للمسار من OpenStreetMap، مسقطاً
  على شبكة الطرق الرئيسية للمدينة. المواقع تتبع الطرق السريعة والدوائر
  والتقاطعات الكبرى — لا الأحياء السكنية: <span class="m">23</span> رئيسياً
  و<span class="m">16</span> سريعاً و<span class="m">4</span> على الطرق
  الشريانية، مقابل مسار سكني واحد.</p>
<div class="ovwrap">{overview}</div>
<p class="legend">
  <span><i class="r"></i>مغطّى — <span class="m">tunnel=yes</span></span>
  <span><i class="c"></i>حفر مكشوف — <span class="m">cutting=yes</span></span>
  <span><i class="n"></i>الطرق الرئيسية والسريعة</span>
</p>

<h2><span class="n">02</span>لماذا وسمٌ لا تضاريس</h2>
<figure>
  <div class="xs">
  <svg viewBox="0 0 760 210" role="img" aria-label="مقطع عرضي: النموذج الرقمي يقيس سطح الجسر فوق النفق، بينما الطريق الحقيقي يمرّ تحته ويغرق، فتصف قِيَم sink وhand السطح الخطأ.">
    <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>
    <g fill="none" stroke="currentColor">
      <path d="M40 74 L720 74" stroke-dasharray="7 5" stroke-width="2"
            opacity=".5"/>
      <path d="M40 74 L250 74 L250 150 L510 150 L510 74 L720 74"
            stroke-width="2.6"/>
    </g>
    <rect x="256" y="136" width="248" height="14" fill="currentColor"
          opacity=".3"/>
    <text x="40" y="62" font-size="12" direction="ltr"
      font-family="IBM Plex Sans Arabic, sans-serif" fill="currentColor"
      opacity=".72">ما يقيسه النموذج الرقمي — سطحٌ متّصل</text>
    <g stroke="currentColor" stroke-width="1.6" marker-end="url(#ar)"
       opacity=".6"><path d="M300 82 L300 132" fill="none"/></g>
    <text x="312" y="112" font-size="11.5" direction="ltr"
      font-family="IBM Plex Mono, monospace" fill="currentColor"
      opacity=".72">≈ 6–9 m</text>
    <text x="380" y="176" text-anchor="middle" font-size="12.5"
      font-family="IBM Plex Sans Arabic, sans-serif" fill="currentColor"
      opacity=".9">الطريق الحقيقي — وهو ما يغرق</text>
    <text x="40" y="198" font-size="11.5" direction="ltr"
      font-family="IBM Plex Mono, monospace" fill="currentColor"
      opacity=".72">sink = 0.00 m</text>
    <text x="176" y="198" font-size="11.5" direction="ltr"
      font-family="IBM Plex Mono, monospace" fill="currentColor"
      opacity=".72">hand &gt; 0</text>
  </svg>
  </div>
  <figcaption>النموذج يرى السطح المتّصل فوق النفق، فيحسب
    <span class="m">sink = 0</span> و<span class="m">hand</span> موجباً — أي
    «أرضٌ مستوية مرتفعة عن المجرى»، وهو عكس ما تبحث عنه القاعدة الأولى تماماً.
    وهذا ليس رسماً توضيحياً لفكرة بل وصفٌ لما يحدث في البيانات:
    من الـ<span class="m">{n_ways}</span> مساراً، القاعدة الأولى
    (<span class="m">sink &gt; 0.05 m AND hand &lt; 0</span>) كانت ستلتقط
    <span class="m">{r1}</span> فقط، ويضع النموذج
    <span class="m">{above}</span> منها <em>فوق</em> المجرى الطبيعي.
    فـ<span class="m">{blind}</span> من <span class="m">{n_ways}</span> لا
    تراها بيانات الارتفاع إطلاقاً — وهذا وحده هو مبرّر القاعدة الثالثة.</figcaption>
</figure>

<h2><span class="n">03</span>المنشآت — <span class="m">{n_struct}</span> لا <span class="m">{n_ways}</span></h2>
<p class="note">‏OpenStreetMap يقسّم الطريق المزدوج إلى مسار لكل اتجاه، فالمسار
  الواحد قد يُعدّ مرّتين أو أكثر. بتجميع المسارات التي تلتقي أطرافها ضمن
  <span class="m">{cluster}</span> متراً تصبح الـ<span class="m">{n_ways}</span>
  مساراً <span class="m">{n_struct}</span> منشأة فعلية. المقطع الرمادي أسفل كل
  بطاقة هو ارتفاع النموذج الرقمي على طول المحور، بخطوة
  <span class="m">15</span> متراً — وانبساطه فوق الانخفاض هو الدليل نفسه.</p>
<div class="grid">{cards}</div>

<h2><span class="n">04</span>الجدول الكامل</h2>
<p class="note">كل مسار على حدة، مرتّباً بالطول.
  <span class="m">hand</span> هو الارتفاع فوق أقرب مجرى طبيعي —
  والقيمة الموجبة تعني أنّ النموذج يظنّ الطريق مرتفعاً عن المجرى.</p>
<div class="tw"><table>
  <thead><tr><th>الاسم</th><th>الحي</th><th>النوع</th><th>التصنيف</th>
    <th>الطول m</th><th>المستوى</th><th>hand m</th><th>sink m</th>
    <th>OSM id</th></tr></thead>
  <tbody>{rows}</tbody>
</table></div>

<footer>
  المصادر: هندسة المسارات ووسومها من OpenStreetMap (نسخة مخزَّنة محلياً،
  <span class="m">18,320</span> مساراً)؛ الارتفاعات من
  <span class="m">Copernicus DEM GLO-30</span> بدقّة <span class="m">30</span> م.
  التجميع في منشآت تقديري — يعتمد على تقارب الأطراف، وقد يدمج منشأتين
  متجاورتين على الطريق نفسه أو يفصل واحدة تعبر حدّ حيّ.
  التوليد: <span class="m">research/inspect_tunnels.py</span> ثم
  <span class="m">research/render_tunnel_page.py</span>.
</footer>

</div>
"""

if __name__ == "__main__":
    main()
