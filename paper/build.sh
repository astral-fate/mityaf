#!/bin/sh
# Build the manuscript. Requires a LaTeX distribution on PATH.
set -e
pdflatex -interaction=nonstopmode mityaf.tex
bibtex   mityaf
pdflatex -interaction=nonstopmode mityaf.tex
pdflatex -interaction=nonstopmode mityaf.tex
echo "built: mityaf.pdf"
