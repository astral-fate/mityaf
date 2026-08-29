# Mityaf — manuscript source

LaTeX source for *Measuring Where Water Will Stand: satellite-derived street-flood
susceptibility for a city that has never recorded a flood*.

```
mityaf.tex      manuscript
refs.bib        29 references, BibTeX
figures/        10 vector diagrams (PDF) + 4 EDA figures (PNG)
build.sh        pdflatex → bibtex → pdflatex ×2
```

## Building

```sh
sh build.sh
```

or, if you have `latexmk`:

```sh
latexmk -pdf mityaf.tex
```

Both need a LaTeX distribution on `PATH`. This tree was compiled with
**MiKTeX 25.12 / pdfTeX 4.23**, which installs missing packages on first run. The
document uses `booktabs`, `siunitx`, `tcolorbox`, `natbib`, `setspace`, `microtype`
and `hyperref` — all standard.

Four passes are required, not one: `pdflatex` writes the citation keys to `.aux`,
`bibtex` resolves them against `refs.bib`, and the two further passes settle
cross-references and the table of contents. Running `pdflatex` alone leaves every
citation as `[?]`.

## Manuscript spacing

Many journals want 1.5 or double spacing for the review copy. Near the top of
`mityaf.tex`:

```latex
% \onehalfspacing   % ~38 pp
% \doublespacing    % ~46 pp
\singlespacing      % ~26 pp (default)
```

Uncomment one and comment the others.

## Retargeting a journal

Replace the `\documentclass` line with the publisher's class — `elsarticle`,
`IEEEtran`, `svjour3`, `acmart` — and delete the `\geometry` line, since those
classes set their own page geometry. The body markup is class-agnostic: no
custom sectioning, no hard-coded page breaks, no manual float placement beyond
`[htbp]`.

Two things will need attention when you switch:

- **The `tcolorbox` callouts.** Four environments (`keybox`, `notebox`, `limitbox`,
  `trapbox`) are defined in the preamble. Some publisher classes forbid coloured
  boxes; if so, redefine them as plain `quote` environments — the semantics survive.
- **The bibliography style.** `plainnat` is set; swap for the publisher's `.bst`.

## Figures

The ten diagrams in `figures/*.pdf` are **vector**, not raster, so they scale
without loss and stay legible at any print size. They were authored as SVG and
converted through Chromium; the SVG originals live inside
`../docs/mityaf-chapter-en.html` if you need to edit one.

The four `*.png` figures are the real exploratory-analysis outputs and regenerate
from `../research/eda_figures.py`.

## A note on the references

Entries were compiled for orientation. Verify volume, issue and page numbers
against the publisher of record before submitting — particularly `dano2019`,
`escwa2017` and `almazroui2020`, which were included as supporting context rather
than as primary methodological sources.
