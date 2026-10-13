# Agreement Machinery

An independent study and thesis project on the syntax of agreement, published from its LaTeX sources.

**Live site:** https://dudugan.github.io/agreement-machinery/

- `site/` is the website. The chapters, phenomena, macros and bibliography are in `site/content/`; see [site/README.md](site/README.md) for how to write and add them.
- `sketch/` is the original static design sketch.

Every push to `main` republishes the site through GitHub Actions (`.github/workflows/pages.yml`).

To preview locally:

```bash
python3 site/serve.py
```
