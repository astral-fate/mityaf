# NotebookLM — podcast brief for the Mityaf technical explainer

Goal: an Audio Overview that teaches the whole system from zero — satellite data,
terrain hydrology, the DEM, and the XGBoost classifier — to someone who built the
product but has no remote-sensing or ML background.

---

## 1 · Sources to upload

Upload these, in this order. NotebookLM weights earlier sources slightly more.

| File | Why |
|---|---|
| `masareb/docs/mityaf-chapter-en.pdf` | **Primary.** 55 pp, written as a teaching text in plain English, 14 figures, 21 tables. |
| `masareb/docs/MODEL-CARD.md` | Exact hyperparameters, feature importances, the four transfer results. |
| `masareb/docs/TECHNICAL-DOSSIER.md` | System architecture, pipeline stages, data provenance. |
| `masareb/paper/mityaf.pdf` | Optional. Same content, tighter and more formal — add it only if the audio comes back too shallow. |

Do **not** upload the Arabic documentation in the same notebook as the English
ones. Mixed-language sources make the hosts hedge and code-switch. Build a second
notebook if you want an Arabic episode.

---

## 2 · Settings

- Format: **Deep Dive** (two hosts)
- Length: **Longer**
- Language: English (switch to Arabic in notebook settings for an Arabic episode —
  use the Arabic source doc for that one)

---

## 3 · The prompt

Paste into the **Customize** box before generating.

> You are teaching one specific person: the founder who built this system and now
> has to explain and defend it on stage to technical judges. She is smart and
> technically capable but has no background in remote sensing, hydrology, or
> machine learning, and she has said plainly that jargon-first explanations do not
> work for her. Assume zero prior knowledge of every technical term and build each
> one up from scratch before you use it.
>
> Teach it in this order:
>
> 1. The problem in one minute. Why a city that gets rain on roughly eight days a
> year has a street-ponding problem, and why the rarity makes it worse rather than
> better.
>
> 2. What a DEM actually is. Say "Digital Elevation Model" in full the first time.
> Explain it as a grid where every cell holds exactly one number — the height of
> the ground. Then explain the difference between a DSM, the surface including
> rooftops and trees, and a DTM, the bare earth underneath; why that difference
> matters enormously when you are trying to find where water pools; and how large
> that error actually measures in this city.
>
> 3. Where the elevation data comes from. Make clear it is not a photograph.
> Explain radar interferometry: two satellites flying in close formation, measuring
> the phase difference in a returned radar pulse to derive height. Cover Copernicus
> DEM GLO-30 and TanDEM-X, what 30-metre resolution means in practice on a real
> street, and what it physically cannot resolve.
>
> 4. Terrain hydrology — the six features derived from that grid. Take them one at
> a time and give each a physical analogy before the definition: slope, depression
> or sink depth, flow accumulation, TWI (Topographic Wetness Index), HAND (Height
> Above Nearest Drainage), and relative elevation. Explain what depression filling
> is and why an early bug that raised sinks by only six centimetres left one
> feature completely dead until it was found and fixed.
>
> 5. The three urban features from OpenStreetMap: road density, major-road
> fraction, and the one engineered feature, load per road. Explain what "engineered
> feature" means and why anyone would build one.
>
> 6. The central move of the whole project. Al Madinah has no recorded flood
> incidents at all, so no model can be trained on it. Explain how the team trained
> on New York and Chicago 311 complaint data instead, what "transfer" means, and
> why this is a genuine scientific claim rather than a workaround.
>
> 7. XGBoost. Say "eXtreme Gradient Boosting" in full. Explain a single decision
> tree first, then boosting — each new tree correcting the mistakes the ensemble
> before it made. Then explain the actual settings in plain words: what max_depth
> of 5 means, what a learning rate of 0.06 does, what subsampling is for, and what
> scale_pos_weight fixes.
>
> 8. Why accuracy is the wrong metric here and what PR-AUC is instead. Explain
> precision and recall separately and concretely first, then the curve they trace,
> then what the area under it means. Explain why the baseline equals the prevalence
> of the thing you are predicting, and how to read a result like "1.44×" as a lift
> over that baseline rather than as a percentage.
>
> 9. Spatial cross-validation. Explain spatial autocorrelation in plain terms, why
> an ordinary random train/test split silently inflates scores on geographic data,
> and what grouping the folds into 5.5-kilometre blocks does about it.
>
> 10. Feature importance, and the result that surprised the team — that urban form
> outweighs any single terrain variable. Explain what that means physically and
> what it changed about the design.
>
> 11. The honest limits. Presence-only data and reporting bias. No
> drainage-infrastructure layer. No permeability layer. Thirty-metre cells inside a
> dense city. And the hard boundary: this models water standing on streets, not
> wadi flash flooding.
>
> Rules you must follow:
>
> - Expand every acronym out loud the first time you say it.
> - Every number you state must come from the uploaded sources. Do not invent,
> estimate, or round loosely. If something is not in the sources, say so out loud
> instead of filling the gap.
> - Use concrete physical analogies constantly, but always land back on the real
> mechanism afterwards. The analogy is the door, not the room.
> - Do not skip the mathematics. Explain it in words instead of dropping it.
> - Have one host stop regularly to ask the naive question a smart non-specialist
> would genuinely ask, and have the other answer it properly rather than
> deflecting or complimenting the question.
> - No hype, no trailer voice, no "this changes everything." This is a lesson.
> - Close by listing the five things she should be able to say from memory on
> stage.

---

## 4 · Compact version

The Customize box truncates long input. If the prompt above gets cut off, use
this instead — same intent, far shorter.

> Teach this to a smart founder with zero background in remote sensing,
> hydrology, or machine learning, who must defend it on stage. Assume no prior
> knowledge; build every term from scratch and expand every acronym out loud.
> Cover in order: the problem; what a DEM is and DSM vs DTM; how radar
> interferometry produces elevation from satellites; the six terrain features
> (slope, sink, flow accumulation, TWI, HAND, relative elevation) with a physical
> analogy each; the three OpenStreetMap urban features; why the model is trained on
> New York and Chicago rather than Al Madinah; how XGBoost works, starting from a
> single decision tree; why accuracy is the wrong metric and what PR-AUC and "1.44×
> lift" mean; why spatial cross-validation is necessary; the surprising dominance
> of urban form; and the honest limitations. Every number must come from the
> sources — never invent one. Use analogies but always return to the real
> mechanism. One host should keep asking the naive question and get a real answer.
> No hype. End with the five things she should know by heart.

---

## 5 · Follow-up questions for the chat panel

After the audio, use NotebookLM's chat to drill into anything that stayed fuzzy.
These are ordered from most to least commonly needed:

1. Walk me through one single 200-metre cell end to end: every number that gets
   computed for it and how the model turns those into one score.
2. Explain scale_pos_weight as if I have never heard of class imbalance.
3. What exactly does the model see that makes a dense-road cell riskier than a
   sparse one? What is the physical mechanism?
4. If a judge says "your model was never tested in Madinah, so it is worthless" —
   what is the strongest honest answer?
5. Explain HAND versus TWI. When do they disagree, and which one wins?
6. What would break first if this were deployed in a city with very different
   drainage infrastructure?

---

## 6 · What to check in the output

The failure mode with generated audio is confident wrong numbers. Spot-check these
against `MODEL-CARD.md` before you trust the episode:

- Four transfer results: **1.44× · 1.45× · 1.24× · 1.30×** — all four, not two
- **101,756** training labels (21,287 New York + 80,469 Chicago)
- Road density **26.0%** importance; urban form **38.8%** total
- Rain: **~20** days any rain · **8** days ≥1 mm · **2–3** days ≥5 mm
- Al Madinah: **8,647** cells, **30,337** segments, and **not** trained or tested on

If the hosts state a number that is not on this list and not in a source, regenerate
rather than correcting it by hand — a wrong number in audio is much harder to
un-learn than a wrong number on a page.
