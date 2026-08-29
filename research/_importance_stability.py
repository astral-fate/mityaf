"""How stable is the 38.8% urban-form figure?

MODEL-CARD.md reports gain importances from a single fit with a single seed.
Gain is known to be noisy. This refits the pooled model across seeds and
reports mean +/- sd per feature, so we know whether "38.8%" is a finding or a
coincidence of seed 42.

    .venv/Scripts/python.exe _importance_stability.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from cities import CITIES
from models import build
from train_multi import build_matrix

HERE = Path(__file__).parent
SEEDS = [42, 1, 7, 2024, 31337]


def main() -> None:
    data = {c: build_matrix(c) for c in CITIES if CITIES[c].get("labels_url")
            and (HERE / "cache" / c / "meta.json").exists()}
    keys = next(iter(data.values()))[3]
    X = np.vstack([d[0] for d in data.values()])
    y = np.concatenate([d[1] for d in data.values()])

    runs = []
    for s in SEEDS:
        m = build("xgboost", y, seed=s).fit(X, y)
        gain = m.get_booster().get_score(importance_type="gain")
        vec = np.zeros(len(keys))
        for k, v in gain.items():
            vec[int(k[1:])] = v
        runs.append(100 * vec / vec.sum())
    R = np.array(runs)

    print(f"\ngain importance across {len(SEEDS)} seeds (pooled, {len(y):,} cells)\n")
    print(f"{'feature':16} {'mean':>7} {'sd':>6} {'min':>7} {'max':>7}   published")
    PUB = {"road_density": 26.0, "major_frac": 12.9, "sink": 11.7, "hand": 10.3,
           "load_per_road": 10.2, "relelev": 9.6, "logacc": 7.1, "slope": 6.2,
           "twi": 6.0}
    order = np.argsort(-R.mean(axis=0))
    for i in order:
        k = keys[i]
        print(f"{k:16} {R[:, i].mean():7.1f} {R[:, i].std():6.2f} "
              f"{R[:, i].min():7.1f} {R[:, i].max():7.1f}   {PUB.get(k, float('nan')):6.1f}")

    ui = [keys.index("road_density"), keys.index("major_frac")]
    urban = R[:, ui].sum(axis=1)
    lpr = R[:, keys.index("load_per_road")]
    print(f"\nurban form (road_density + major_frac)")
    print(f"  this environment : {urban.mean():.1f}% +/- {urban.std():.2f}  "
          f"(range {urban.min():.1f}-{urban.max():.1f})")
    print(f"  published        : 38.8%")
    print(f"\nincluding load_per_road : {(urban + lpr).mean():.1f}% "
          f"+/- {(urban + lpr).std():.2f}")

    top_terrain = max(R[:, keys.index(k)].mean()
                      for k in ("sink", "hand", "relelev", "logacc", "slope", "twi"))
    print(f"\nheadline claim — urban form beats any single terrain variable:")
    print(f"  urban form {urban.mean():.1f}%  vs  best terrain {top_terrain:.1f}%  "
          f"-> {'HOLDS' if urban.mean() > top_terrain else 'FAILS'}")


if __name__ == "__main__":
    main()
