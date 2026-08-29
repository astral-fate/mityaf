"""Pull the benchmark-relevant facts out of the downloaded PDFs.

Reading 17 full papers is not practical; what the benchmark table needs is
narrow — study area, sample counts, how positives and negatives were built,
how the data was split, which models were compared and what they scored. This
extracts sentences matching those, so the digest is a few KB per paper instead
of a few hundred.

    python digest_papers.py > digest.txt
    python digest_papers.py seleem2022 vemula2025    # just these
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
REFS = HERE / "references"

# What the benchmark table actually needs, by column.
PATTERNS = {
    "data": r"\b(?:study area|dataset|inventory|flood(?:ed)? (?:points|locations|"
            r"records|inventory)|non-flood|negative samples|pseudo-absence|"
            r"presence|sample(?:d|s)? (?:size|points)|grid cell|resolution|"
            r"\d[\d,]{2,} (?:points|samples|cells|records|locations|complaints))\b",
    "split": r"\b(?:cross-?validation|k-?fold|train(?:ing)?[ /-]test|split|"
             r"hold-?out|spatial(?:ly)? (?:block|blocked|split|cross)|"
             r"leave-one-|out-of-(?:area|sample|domain)|70[:/]30|80[:/]20)\b",
    "models": r"\b(?:random forest|xgboost|lightgbm|catboost|adaboost|"
              r"gradient boost|support vector|SVM|logistic regression|"
              r"naive bayes|k-?nearest|neural network|CNN|ANN|MLP|"
              r"graph (?:neural|attention|transformer)|GNN|GAT|GCN|MaxEnt|"
              r"maximum entropy|TabPFN|decision tree|ensemble|stacking)\b",
    "metric": r"\b(?:AUC|ROC|PR-?AUC|average precision|accuracy|F1|precision|"
              r"recall|kappa|RMSE|R2|R²|MAE|specificity|sensitivity)\b"
              r"[^.]{0,90}?\d",
}
LIMIT = {"data": 9, "split": 7, "models": 6, "metric": 12}


def text(pdf: Path, max_pages: int = 30) -> str:
    from pypdf import PdfReader
    try:
        r = PdfReader(str(pdf))
    except Exception as e:                                     # noqa: BLE001
        return f"[unreadable: {e}]"
    out = []
    for pg in r.pages[:max_pages]:
        try:
            out.append(pg.extract_text() or "")
        except Exception:                                      # noqa: BLE001
            continue
    t = " ".join(out)
    t = re.sub(r"-\s*\n\s*", "", t)          # de-hyphenate across line breaks
    return re.sub(r"\s+", " ", t)


def sentences(t: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z(])", t)
            if 40 < len(s.strip()) < 420]


def main() -> None:
    want = sys.argv[1:]
    pdfs = sorted(REFS.glob("*.pdf"))
    if want:
        pdfs = [p for p in pdfs if p.stem in want]

    for pdf in pdfs:
        t = text(pdf)
        print("=" * 78)
        print(f"## {pdf.stem}")
        print("=" * 78)
        if t.startswith("[unreadable"):
            print(t, "\n")
            continue

        head = t[:340].strip()
        print(f"HEAD: {head}\n")

        sents = sentences(t)
        for tag, pat in PATTERNS.items():
            rx = re.compile(pat, re.I)
            hits, seen = [], set()
            for s in sents:
                if not rx.search(s):
                    continue
                k = s[:60].lower()
                if k in seen:
                    continue
                seen.add(k)
                hits.append(s)
                if len(hits) >= LIMIT[tag]:
                    break
            if hits:
                print(f"-- {tag.upper()} --")
                for h in hits:
                    print(f"  * {h}")
                print()
        print()


if __name__ == "__main__":
    main()
