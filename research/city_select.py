# -*- coding: utf-8 -*-
"""Weight the city selection, not the individual rows.

Row-level importance weighting failed (domain_adapt.py): reweighting 107,152 US
cells toward Madinah collapsed the effective sample to 9.2% and cost 8.5% skill.
The trade was bad because it shreds the sample to buy distributional closeness.

City-level selection is the same idea without the shredding. The discriminator
already ranks whole cities by how much they resemble the target -- San Francisco
3.21, Dallas 1.60, New York 0.70, Chicago 0.31 against Madinah. So drop the
cities that do not resemble the target and keep the survivors whole.

Two parts:

  A. VALIDATION. For each held-out US city, compute similarity of the three
     candidates, then compare pooling all three against the most-similar two,
     the most-similar one, and every single city on its own. If picking by
     similarity beats pooling, the heuristic is real.

  B. APPLICATION. Train on the subset the heuristic picks for Madinah and score
     all 30,337 segments. Madinah has no labels, so the only checks available
     are the three resident coordinates and agreement with the hydrology
     ranking that currently ships.

    .venv/Scripts/python.exe city_select.py
"""
from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata, spearmanr
from sklearn.metrics import average_precision_score

import models as M
from cities import CITIES
from domain_adapt import DEM, importance_weights, rank_norm, skill
from train_multi import build_matrix

HERE = Path(__file__).parent
OUT = HERE / "results_city_select.json"
SEEDS = [42, 1, 7]
MODEL = "catboost"

PINS = [(24.5040022, 39.7000415), (24.504608, 39.700796),
        (24.503704, 39.702222)]


def similarity(data, target: str, cands: list[str], seed: int = 42) -> dict:
    """Mean discriminator weight of each candidate city against the target.

    Reuses the density-ratio discriminator from domain_adapt: a city whose
    cells the discriminator cannot tell apart from the target's gets a high
    mean weight.
    """
    # The discriminator must see all candidates AT ONCE. importance_weights
    # normalises its output to mean 1, so scoring each city in a separate call
    # returns 1.00 for every one of them and measures nothing. Pool first, then
    # slice -- which is what domain_adapt.py did, and why its numbers varied.
    Xs = np.vstack([data[c][0] for c in cands])
    w = importance_weights(Xs, data[target][0], seed)
    out, k = {}, 0
    for c in cands:
        n = len(data[c][0])
        out[c] = float(w[k:k + n].mean())
        k += n
    return out


def train_eval(data, train_cities, held, seed, dem_cols) -> float:
    Xtr = np.vstack([rank_norm(data[c][0], dem_cols) for c in train_cities])
    ytr = np.concatenate([data[c][1] for c in train_cities])
    Xte = rank_norm(data[held][0], dem_cols)
    est = M.build(MODEL, ytr, seed)
    M.fit(est, Xtr, ytr, MODEL)
    return skill(data[held][1], est.predict_proba(Xte)[:, 1])


def main() -> None:
    us = [c for c in CITIES if c != "madinah" and CITIES[c].get("labels_url")
          and (HERE / "cache" / c / "meta.json").exists()]
    full = {c: build_matrix(c) for c in us}
    data = {c: v[:2] for c, v in full.items()}
    keys = list(full[us[0]][3])
    dem_cols = [i for i, k in enumerate(keys) if k in DEM]

    # ── A. does picking by similarity beat pooling? ──────────────────────────
    print("\n" + "=" * 74)
    print("A. LOCO — each city stands in for Madinah; which training set wins?")
    print("=" * 74)
    rows, sims = [], {}
    for held in us:
        cands = [c for c in us if c != held]
        sim = similarity(data, held, cands)
        sims[held] = sim
        order = sorted(cands, key=lambda c: -sim[c])
        print(f"\nheld-out {held}   similarity: " +
              "  ".join(f"{c} {sim[c]:.2f}" for c in order))

        options = {"all three": cands,
                   f"top-2 ({'+'.join(order[:2])})": order[:2],
                   f"top-1 ({order[0]})": order[:1],
                   f"worst-1 ({order[-1]})": order[-1:]}
        for c in cands:
            options.setdefault(f"only {c}", [c])

        for label, tr in options.items():
            vals = [train_eval(data, tr, held, s, dem_cols) for s in SEEDS]
            rows.append({"held": held, "option": label,
                         "cities": tr, "skill": float(np.mean(vals)),
                         "sd": float(np.std(vals))})
            print(f"   {label:26} {np.mean(vals):+.4f}  ±{np.std(vals):.4f}")

    print("\n" + "-" * 74)
    print("Does the similarity heuristic beat pooling everything?\n")
    wins = 0
    for held in us:
        allv = next(r for r in rows if r["held"] == held and r["option"] == "all three")
        top2 = next(r for r in rows if r["held"] == held and r["option"].startswith("top-2"))
        best = max((r for r in rows if r["held"] == held), key=lambda r: r["skill"])
        d = top2["skill"] - allv["skill"]
        wins += d > 0
        print(f"  {held:9} all-three {allv['skill']:+.4f}   top-2 {top2['skill']:+.4f}"
              f"   delta {d:+.4f}    best was: {best['option']} ({best['skill']:+.4f})")
    print(f"\n  top-2 beat pooling in {wins} of {len(us)} cities")

    # ── B. apply to Madinah ─────────────────────────────────────────────────
    print("\n" + "=" * 74)
    print("B. Madinah — train on the picked subset, score all 30,337 segments")
    print("=" * 74)
    mad_grid = build_matrix("madinah")[0]
    sim_mad = similarity(data, "madinah", us) if "madinah" in data else None
    if sim_mad is None:
        data["madinah"] = (mad_grid, np.zeros(len(mad_grid), dtype="int8"))
        sim_mad = similarity(data, "madinah", us)
    order = sorted(us, key=lambda c: -sim_mad[c])
    print("\n  similarity to Madinah: " +
          "  ".join(f"{c} {sim_mad[c]:.2f}" for c in order))
    picked = order[:2]
    print(f"  picked subset: {' + '.join(picked)}")

    seg = pd.read_csv(HERE / "out" / "madinah_segments_features.csv")
    Xseg = seg[keys].to_numpy("float32")
    Xseg = rank_norm(Xseg, dem_cols)
    hyd = pd.read_csv(HERE / "out" / "madinah_native_risk.csv")[
        ["unit_id", "rank_hydrology"]]

    def score(train_cities):
        Xtr = np.vstack([rank_norm(data[c][0], dem_cols) for c in train_cities])
        ytr = np.concatenate([data[c][1] for c in train_cities])
        ps = []
        for s in SEEDS:
            est = M.build(MODEL, ytr, s)
            M.fit(est, Xtr, ytr, MODEL)
            ps.append(est.predict_proba(Xseg)[:, 1])
        return rankdata(np.mean(ps, axis=0)) / len(Xseg)

    variants = {"all four": us, f"picked ({'+'.join(picked)})": picked}
    out_b = {}
    for label, tr in variants.items():
        r = score(tr)
        d = seg[["unit_id", "lat", "lon"]].copy()
        d["r"] = r
        m = d.merge(hyd, on="unit_id", how="left")
        rho = float(spearmanr(m.r, m.rank_hydrology, nan_policy="omit").statistic)
        pin_ranks = []
        for plat, plon in PINS:
            k = ((d.lat - plat) ** 2 + (d.lon - plon) ** 2).idxmin()
            pin_ranks.append(round(float(d.loc[k, "r"]), 4))
        out_b[label] = {"cities": tr, "spearman_vs_hydrology": rho,
                        "pin_ranks": pin_ranks,
                        "pin_mean": float(np.mean(pin_ranks))}
        print(f"\n  {label}")
        print(f"     agreement with hydrology (Spearman)  {rho:+.3f}")
        print(f"     the three resident pins              " +
              "  ".join(f"{v:.3f}" for v in pin_ranks))
        print(f"     mean pin rank                        {np.mean(pin_ranks):.3f}")

    print("\n  reference — the hydrology ranking that ships puts the pins at "
          "0.990 / 0.987 / 0.994")

    OUT.write_text(json.dumps(
        {"model": MODEL, "seeds": SEEDS, "loco": rows,
         "similarity_loco": sims, "similarity_madinah": sim_mad,
         "madinah": out_b}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT.name}")


if __name__ == "__main__":
    main()
