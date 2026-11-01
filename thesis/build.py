"""Build the PDF edition of Agreement Machinery from the site's LaTeX sources.

    python3 thesis/build.py            # writes site/agreement-machinery.pdf

Chapters come from site/content/manifest.json in reading order (undrafted chapters are skipped);
each one's  %% title:  becomes its \\chapter, titled parts become \\part. The user's preamble
(site/content/macros.tex) is loaded as is, and thesis/preamble.tex supplies the packages.
Needs XeLaTeX and biber (TeX Live / TinyTeX).
"""
import json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site", "content")
HERE = os.path.join(ROOT, "thesis")
BUILD = os.path.join(HERE, "build")
OUT = os.path.join(ROOT, "site", "agreement-machinery.pdf")

TITLE_PAGE = {
    "title": "Agreement Machinery",
    "subtitle": "An Independent Study and Thesis Project",
    "author": "David Garsten",
    "advisor": "Robert Frank",
    "department": "Department of Linguistics",
    "institution": "Yale University",
    "date": "2027",
}


def front_matter(src):
    meta = {}
    for line in src.split("\n"):
        m = re.match(r"\s*%%\s*([\w-]+)\s*:\s*(.*)$", line)
        if m:
            meta[m.group(1).lower()] = m.group(2).strip()
        elif line.strip() and not line.lstrip().startswith("%"):
            break
    return meta


def is_stub(src):
    body = "\n".join(l for l in src.split("\n") if not l.lstrip().startswith("%"))
    body = re.sub(r"\\label\{[^}]*\}", "", body)
    return not body.strip()


def balanced(s, i, open_="{", close="}"):
    """s[i] == open_; return (inner, index after the closing bracket)."""
    d, j = 0, i
    while j < len(s):
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == open_:
            d += 1
        elif c == close:
            d -= 1
            if d == 0:
                return s[i + 1 : j], j + 1
        j += 1
    return s[i + 1 :], len(s)


def split_words(s):
    out, d, cur, math = [], 0, "", False
    i = 0
    while i < len(s):
        c = s[i]
        if c == "\\":
            cur += s[i : i + 2]
            i += 2
            continue
        if c == "$":
            math = not math
        if c == "{":
            d += 1
        elif c == "}":
            d -= 1
        if c.isspace() and d == 0 and not math:
            if cur:
                out.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    if cur:
        out.append(cur)
    return out


def headchain_tikz(spec):
    """\\headchain{ C (you) [*T *Aux Vc]{should} [V]{eat} } -> a tikzpicture (same notation as the site)."""
    seq, i, chains = [], 0, 0
    s = spec
    while i < len(s):
        c = s[i]
        if c.isspace():
            i += 1
            continue
        if c == "[":
            inner, i = balanced(s, i, "[", "]")
            while i < len(s) and s[i].isspace():
                i += 1
            word = None
            if i < len(s) and s[i] == "{":
                word, i = balanced(s, i)
            for m in split_words(inner):
                star = m.startswith("*")
                seq.append(("head", m[1:] if star else m, chains, star))
            seq.append(("chainword", word, chains, False))
            chains += 1
            continue
        if c == "(":
            w, i = balanced(s, i, "(", ")")
            seq.append(("word", w, None, False))
            continue
        j = i
        while j < len(s) and not s[j].isspace() and s[j] not in "[(":
            if s[j] == "{":
                _, j = balanced(s, j)
                continue
            j += 1
        tok = s[i:j].strip()
        if tok.startswith("{") and tok.endswith("}"):
            tok = tok[1:-1]
        seq.append(("head", tok, None, False))
        i = j
    STEP = 1.15
    lines = [r"\begin{tikzpicture}[baseline=(h0.base)]"]
    heads = [x for x in seq if x[0] == "head"]
    xs = {}
    for k, (_, label, chain, star) in enumerate(heads):
        xs[k] = k * STEP
        lines.append(rf"\node[inner sep=1pt,anchor=base] (h{k}) at ({k*STEP:.2f},0) {{{label}}};")
    members = {}
    for k, (_, label, chain, star) in enumerate(heads):
        if chain is not None:
            members.setdefault(chain, []).append((k, star))
    meet = {}
    for ch, ms in members.items():
        ref = [k for k, st in ms if st] or [ms[0][0]]
        mx = sum(xs[k] for k in ref) / len(ref)
        meet[ch] = mx
        for k, _ in ms:
            lines.append(rf"\draw[line width=0.8pt] ({xs[k]:.2f},-0.34) -- ({mx:.2f},-0.62);")
    prev, last_head, n, hk = None, 0.0, 0, 0
    for kind, text, chain, _ in seq:
        if kind == "head":
            last_head = xs[hk]
            hk += 1
            continue
        if not text:
            continue
        style = r"font=\itshape\bfseries" if kind == "chainword" else r"font=\itshape"
        if kind == "chainword":
            lines.append(rf"\node[inner sep=1pt,{style}] (w{n}) at ({meet[chain]:.2f},-1.0) {{{text}}};")
        elif prev is None:
            lines.append(rf"\node[inner sep=1pt,{style}] (w{n}) at ({last_head:.2f},-1.0) {{{text}}};")
        else:
            lines.append(rf"\node[inner sep=1pt,anchor=west,{style}] (w{n}) at ([xshift=4pt]{prev}.east) {{{text}}};")
        prev = f"w{n}"
        n += 1
    lines.append(r"\end{tikzpicture}")
    return "\n".join(lines)


def pstricks_to_tikz(src):
    """\\rnode + \\ncbar / \\ncline / \\nccurve (+ \\ncput*) -> TikZ remember-picture nodes and arrows,
    so no Ghostscript is needed. Arrows below the line get room by deepening the example."""
    def rnode(m):
        name, body = m.group(1), m.group(2)
        return rf"\tikz[remember picture,baseline=(rn-{name}.base)]\node[inner sep=0pt,outer sep=1pt](rn-{name}){{{body}}};"
    src = re.sub(r"\\rnode(?:\[[^\]]*\])?\{([^}]*)\}\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}", rnode, src)
    pat = re.compile(r"\\nc(bar|line|curve|angle|angles|arc|diag)\*?(?:\[([^\]]*)\])?\{([^}]*)\}\{([^}]*)\}(?:\{([^}]*)\})?"
                     r"(\s*\\ncput\*?(?:\[[^\]]*\])?\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\})?")
    def conn(m):
        kind, opts = m.group(1), m.group(2) or ""
        arrow, a, b = (m.group(3), m.group(4), m.group(5)) if m.group(5) else ("-", m.group(3), m.group(4))
        label = m.group(7)
        if label:  # a label that is itself an \rnode only needs its content
            label = re.sub(r"\\tikz\[remember picture[^\]]*\]\\node\[[^\]]*\]\([^)]*\)\{(.*)\};$", r"\1", label.strip())
        o = dict(kv.split("=", 1) for kv in opts.replace(" ", "").split(",") if "=" in kv)
        arm = o.get("arm", "9pt")
        up = o.get("angle", o.get("angleA", "-90")).lstrip("+").startswith(("9", "1")) and not o.get("angle", "-90").startswith("-")
        tip = "->" if ">" in arrow and not arrow.startswith("<") else "<-" if arrow.startswith("<") and ">" not in arrow else "<->" if "<" in arrow and ">" in arrow else "-"
        side = "north" if up else "south"
        sign = "" if up else "-"
        lab = rf" node[pos=0.25,fill=white,inner sep=1pt]{{{label}}}" if label else ""
        if kind == "line" or kind == "diag":
            path = rf"(rn-{a}.{side}) --{lab.replace('pos=0.25','midway')} (rn-{b}.{side})"
        elif kind in ("curve", "arc"):
            path = rf"(rn-{a}.{side}) to[out={'90' if up else '-90'},in={'90' if up else '-90'}]{lab.replace('pos=0.25','midway')} (rn-{b}.{side})"
        else:
            path = rf"(rn-{a}.{side}) -- ++(0,{sign}{arm}) -|{lab} (rn-{b}.{side})"
        return rf"\tikz[remember picture,overlay]\draw[{tip},>=Stealth] {path};\rule[-1.6em]{{0pt}}{{0pt}}"
    return pat.sub(conn, src)


EX_LABELS = set()  # filled in main(): every \dref / \deftagex label in the book


def transform(src):
    """Turn site-only notation into plain LaTeX."""
    out, i = "", 0
    while True:
        j = src.find(r"\headchain", i)
        if j < 0:
            out += src[i:]
            break
        out += src[i:j]
        k = j + len(r"\headchain")
        if k < len(src) and src[k] == "[":
            _, k = balanced(src, k, "[", "]")
        while k < len(src) and src[k].isspace():
            k += 1
        spec, k = balanced(src, k)
        out += headchain_tikz(spec)
        i = k
    out = pstricks_to_tikz(out)
    # \hyperref to an expex example label (\dref): LaTeX can't link those, so keep just the words
    out = re.sub(r"\\hyperref\[([^\]]*)\]\{([^{}]*)\}", lambda m: m.group(2) if m.group(1) in EX_LABELS else m.group(0), out)
    # "\pex \dref{x}": expex would take the label as a heading line, so use its own form, \pex<x>
    out = re.sub(r"\\(pex|ex)\s*\\(?:dref|deftagex)\{([^}]*)\}\s*", lambda m: f"\\{m.group(1)}<{m.group(2)}> ", out)
    # a nodestream form's driver code only makes sense on the website
    out = re.sub(r"(\\end\{nodestream\}\s*)\\begin\{minted\}\{python\}[\s\S]*?\\end\{minted\}", r"\1", out)
    return out


def main():
    # optional, for testing:  build.py [manifest.json [out.pdf]]
    global OUT
    mpath = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SITE, "manifest.json")
    if len(sys.argv) > 2:
        OUT = os.path.abspath(sys.argv[2])
    manifest = json.load(open(mpath))
    os.makedirs(BUILD, exist_ok=True)
    for f in ["am-thesis.cls", "preamble.tex"]:
        shutil.copy(os.path.join(HERE, f), BUILD)
    shutil.copy(os.path.join(SITE, manifest["bibliography"]), os.path.join(BUILD, "refs.bib"))
    shutil.copy(os.path.join(SITE, manifest["macros"]), os.path.join(BUILD, "macros.tex"))

    for part in manifest["parts"]:
        for f in part["chapters"]:
            path = os.path.join(SITE, f)
            if os.path.exists(path):
                EX_LABELS.update(re.findall(r"\\(?:dref|deftagex)\{([^}]*)\}", open(path, encoding="utf-8").read()))
    body = []
    for part in manifest["parts"]:
        chapters = []
        for f in part["chapters"]:
            path = os.path.join(SITE, f)
            if not os.path.exists(path):
                continue
            src = open(path, encoding="utf-8").read()
            if is_stub(src):
                continue
            meta = front_matter(src)
            name = os.path.splitext(os.path.basename(f))[0]
            open(os.path.join(BUILD, name + ".tex"), "w", encoding="utf-8").write(transform(src))
            chapters.append(rf"\chapter{{{meta.get('title', name)}}}" + "\n" + rf"\input{{{name}}}")
        if chapters:
            if part.get("title"):
                body.append(rf"\part{{{part['title']}}}")
            body.extend(chapters)

    # phonetic characters Latin Modern doesn't have: set them in Charis SIL (see preamble.tex)
    text = "".join(open(os.path.join(BUILD, f), encoding="utf-8").read() for f in os.listdir(BUILD) if f.endswith(".tex"))
    ipa = sorted({c for c in text if 0x0250 <= ord(c) <= 0x02FF or 0x1D00 <= ord(c) <= 0x1DBF})
    open(os.path.join(BUILD, "ipachars.tex"), "w", encoding="utf-8").write(
        "".join(f"\\newunicodechar{{{c}}}{{{{\\ipafont {c}}}}}\n" for c in ipa))

    tp = TITLE_PAGE
    main_tex = rf"""\documentclass{{am-thesis}}
\input{{preamble}}
\input{{macros}}
\addbibresource{{refs.bib}}
\title{{{tp['title']}}}
\subtitle{{{tp['subtitle']}}}
\author{{{tp['author']}}}
\advisor{{{tp['advisor']}}}
\department{{{tp['department']}}}
\institution{{{tp['institution']}}}
\date{{{tp['date']}}}
\begin{{document}}
\maketitle
\begin{{singlespace}}\tableofcontents\end{{singlespace}}
{chr(10).join(body)}
\begin{{singlespace}}\printbibliography[heading=bibintoc]\end{{singlespace}}
\end{{document}}
"""
    open(os.path.join(BUILD, "thesis.tex"), "w", encoding="utf-8").write(main_tex)

    def run(*cmd):
        r = subprocess.run(cmd, cwd=BUILD, capture_output=True, text=True)
        if r.returncode != 0:
            log = os.path.join(BUILD, "thesis.log")
            tail = (open(log, encoding="utf-8", errors="replace").read()[-6000:] if os.path.exists(log) else "") + "\n--- output ---\n" + (r.stdout + r.stderr)[-3000:]
            sys.exit(f"{' '.join(cmd)} failed:\n{tail}")
    xe = ["xelatex", "-interaction=nonstopmode", "-halt-on-error", "thesis.tex"]
    run(*xe)
    run("biber", "thesis")
    run(*xe)
    run(*xe)
    shutil.copy(os.path.join(BUILD, "thesis.pdf"), OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
