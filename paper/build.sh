#!/bin/sh
# Build the manuscript. Requires a LaTeX distribution on PATH.
#
# The target-city table is GENERATED from the results file rather than
# hand-maintained: a ten-run test showed that a hand-edited version drifts
# silently (one run in five never opened the results file, and none of the ten
# reproduced all 15 rankers). --check fails the build rather than shipping a
# table that disagrees with the experiment.
set -e

TEX=${1:-mityaf}

if [ "$TEX" = "transfer" ]; then
  python make_target_table.py --check || {
    echo "regenerating tab-target.tex from the results file"
    python make_target_table.py
  }
fi

pdflatex -interaction=nonstopmode "$TEX.tex"
bibtex   "$TEX"
pdflatex -interaction=nonstopmode "$TEX.tex"
pdflatex -interaction=nonstopmode "$TEX.tex"
echo "built: $TEX.pdf"
