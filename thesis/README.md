# The PDF edition

`build.py` compiles the website's chapters, the same `.tex` files in `site/content/`, into one LaTeX
document, `site/agreement-machinery.pdf`, which the site's **Read as PDF** button opens. GitHub runs it on
every push (see `.github/workflows/pages.yml`).

- **Layout:** `am-thesis.cls`, adapted from [jopetty/yale-thesis](https://github.com/jopetty/yale-thesis)
  (MIT, see `LICENSE-yale-thesis`): 12pt Computer Modern, letter paper, 1.5in binding margin, double spacing.
  Title-page details are at the top of `build.py`.
- **Packages:** `preamble.tex`: expex, forest (linguistics library), TikZ, multicols, paracol, and biblatex
  in the Unified Style Sheet for Linguistics. Your own macros come from `site/content/macros.tex`.
- **Chapters** follow `manifest.json`: each part becomes a `\chapter` and each of its pages a `\section`,
  with headings inside a page moved down one level, so the contents match the website's (part 2, page 3
  is section 2.3). A page with no text yet appears as its heading and "Not yet drafted."
- **Website-only notation** is translated before compiling:
  - `\headchain{…}` becomes TikZ;
  - `\rnode` / `\ncbar` arrows become TikZ (so no Ghostscript is needed);
  - `\pex \dref{x}` becomes expex's `\pex<x>`;
  - a `\hyperref` to an example label keeps just its words;
  - margin `\comment`s and `nodestream` forms are left out;
  - IPA characters that Latin Modern lacks are set in Charis SIL.

To build it on your Mac, press **Read as PDF** in the local preview (`python3 site/serve.py`): it compiles
the PDF and opens it, or shows the build's errors. Or from the terminal:

```bash
export PATH="$(echo ~/Library/TinyTeX/bin/*):$PATH"
python3 thesis/build.py
```

Either way it needs TinyTeX with the packages in `texlive-packages.txt`. To install them (about 300 MB, no
admin password), run these in the project folder:

```bash
curl -sL "https://yihui.org/tinytex/install-bin-unix.sh" | sh -s - "$(mktemp -d)" --no-path
~/Library/TinyTeX/bin/*/tlmgr update --self
~/Library/TinyTeX/bin/*/tlmgr install $(grep -v '^#' thesis/texlive-packages.txt)
```
