# Agreement Machinery

The site reads LaTeX directly: every page is converted from a `.tex` file in the browser when it loads, so there is no build step.

## Preview locally

```bash
python3 site/serve.py
```

Then open http://localhost:8765. The page has to be served over http; opening `index.html` as a file won't work. Reload after editing a `.tex` file.

## Where things live

| File | What it is |
| --- | --- |
| `content/manifest.json` | reading order (parts → chapters), the list of phenomena, the categories, and the names of the feature symbols |
| `content/macros.tex` | your preamble. Every `\newcommand` here is expanded exactly as LaTeX would, and macros in this file override the site's built-ins |
| `content/refs.bib` | the bibliography (natbib-style `\citet`, `\citep`, `\citealt`, `\citeyear`, …) |
| `content/chapters/*.tex` | one file per chapter |
| `content/phenomena/*.tex` | one file per Encyclopedia entry |

## Metadata blocks

The first lines of each file, written as `%%` comments so the file still compiles:

```latex
%% title: Agree and the Probe
%% category: theories          % languages | properties | phenomena | theories
```

Phenomena use the same format:

```latex
%% type: phenomenon
%% name: English Subject-Verb Agreement
%% language: English
%% probe: T
%% goal: subject DPs
%% features: \#, $\pi$
%% blockers: --                 % "--" means none known
%% discussed: sec:basic         % one or more \label keys, comma-separated
```

A chapter's synopsis is its `abstract` environment. A `\label` placed before the first `\section` labels the chapter itself, so `\ref{ch:agree}` prints "2".

A chapter with no body shows up as "not drafted" in the sidebar.

## What's understood

* **Examples (expex):** `\ex … \xe`, `\pex \a … \a … \xe`, judgments (`*`, `?`, `??`, `\#`, `\%`, `\ljudge{}`), `\hfill` annotations, `\noexno`.
* **Glosses:** `\begingl \gla … // \glb … // \glc … // \glft … // \endgl`.
* **References:**
  * labels and refs: `\dref`/`\deftagex`, `\label`, `\gref[a]{…}`, `\ref`, `\Cref`;
  * relative examples: `\Next[a]`, `\Last`, `\NNext`, `\LLast[c]`, `\LLLast`. These work across chapters ("(1a) of Chapter 4") and show a hover preview.
* **Trees (forest):** `\\` stacks a realization under its node with no connecting line. Also supported: `roof`, `draw`, `name=`, `for tree={s sep, l sep}`, and `\draw … to[out=,in=,looseness=] node[…]{…} (…)` between named nodes, including `[xshift,yshift]` coordinates and scopes.
* **TikZ:**
  * nodes, including `draw` and `circle`;
  * paths: `--`, `to[…]`, `edge[bend left]`, `rectangle`, `circle`, `++`/`+` offsets, anchors;
  * styles: arrows, `dashed`/`dotted`, colours, line widths, `pattern=north east lines`, `.style` definitions.
* **pstricks:** `\rnode` with `\ncbar` / `\ncline` / `\nccurve` and `\ncput*`, drawn over the example.
* **Layout:** `multicols` with `\columnbreak`, and `paracol` with `\columnratio` and `\switchcolumn`.
* **Notes:** `\footnote` becomes a numbered margin note; `\comment`, `\todo`, `\marginpar` become margin comments.
* **Shorthands:**
  * `\headchain{ C (you) [*T *Aux Vc]{should} [V]{eat} }` draws head-chain diagrams (notation explained in `macros.tex`);
  * `\feat{…}` prints a small feature line under a tree node.

Anything the converter doesn't recognise is shown in red in the page and listed in the browser console under "LaTeX: n warnings". Nothing fails silently.
