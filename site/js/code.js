/* code.js — code blocks (highlighting, VS Code-style folding, running Python) and nodestream forms.
 *
 * Python runs in the reader's browser with Pyodide (CPython compiled to WebAssembly). It is only
 * downloaded the first time someone presses Run (about 10 MB, then cached by the browser).
 * All code blocks on one page share a single Python session, in page order: running a block first
 * runs any earlier blocks on the page that haven't run yet, so later blocks can use earlier definitions.
 *
 * Readers never type code: blocks are read-only, and a nodestream form passes only the values offered
 * in its dropdowns (plus a short plain-text label) to a fixed "driver" block, as data.
 */
(function(){
"use strict";
const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const PYODIDE="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";

/* ---------- Python highlighting ---------- */
const KW=new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(" "));
const BUILTIN=new Set("abs all any bin bool bytes callable chr classmethod dict dir divmod enumerate eval exec filter float format frozenset getattr hasattr hash hex id input int isinstance issubclass iter len list map max min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip ValueError TypeError KeyError IndexError Exception RuntimeError StopIteration NotImplementedError AttributeError".split(" "));
const CONST=new Set(["None","True","False"]);
function tokenizePy(src){
  const re=/(#[^\n]*)|([rRbBuUfF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(\b(?:0[xob][\da-fA-F_]+|\d[\d_]*\.?\d*(?:e[+-]?\d+)?j?|\.\d+)\b)|(@[A-Za-z_][\w.]*)|([A-Za-z_]\w*)|(\n)|([^\S\n]+)|([^\w\s])/g;
  const out=[]; let m, prevWord="";
  while((m=re.exec(src))){
    const t=m[0];
    if(m[1]) out.push(["com",t]);
    else if(m[2]) out.push([/^[rRbBuU]*[fF]/.test(t)?"fstr":"str",t]);
    else if(m[3]) out.push(["num",t]);
    else if(m[4]) out.push(["dec",t]);
    else if(m[5]){
      let c="";
      if(CONST.has(t)) c="const"; else if(KW.has(t)) c="kw"; else if(prevWord==="def") c="fn"; else if(prevWord==="class") c="cls";
      else if(t==="self"||t==="cls") c="self"; else if(BUILTIN.has(t)) c="bi";
      else { const rest=src.slice(re.lastIndex); if(/^\s*\(/.test(rest)) c="call"; }
      out.push([c,t]); prevWord=t; continue;
    }
    else out.push(["",t]);
    if(!m[7]) prevWord=""; // whitespace keeps "def"/"class" pending
  }
  return out;
}
function tokenizePlain(src){ return [["",src]]; }
// highlight → one html string per line (multi-line tokens are split and re-opened on each line)
function highlightLines(src, lang){
  const toks=(lang==="python"?tokenizePy:tokenizePlain)(src);
  const lines=[""];
  for(const [c,t] of toks){
    t.split("\n").forEach((piece,i)=>{ if(i) lines.push(""); if(piece) lines[lines.length-1]+= c?`<span class="t-${c}">${esc(piece)}</span>`:esc(piece); });
  }
  return lines;
}

/* ---------- folding ranges (by indentation, like VS Code) ---------- */
function foldRanges(lines){
  const ind=l=>l.trim()?l.match(/^ */)[0].length:null;
  const ranges={};
  for(let i=0;i<lines.length;i++){
    const a=ind(lines[i]); if(a===null) continue;
    let j=i+1; while(j<lines.length && ind(lines[j])===null) j++;
    if(j>=lines.length || ind(lines[j])<=a) continue;
    let end=j;
    for(let k=j;k<lines.length;k++){ const b=ind(lines[k]); if(b===null) continue; if(b<=a) break; end=k; }
    ranges[i]=end;
  }
  return ranges;
}

/* ---------- a code block (read-only: fold, copy, run) ---------- */
const blocks=new WeakMap();
function render(el){
  const pre=el.querySelector("pre.code-src"); if(!pre) return;
  const lang=el.dataset.lang||"text";
  const st={code:pre.textContent, lang, folded:new Set(), ranAs:null};
  blocks.set(el, st);
  const driver=el.classList.contains("driver");
  el.innerHTML=`<div class="code-bar"><span class="code-lang">${esc(lang)}${driver?" · reads the form above":""}</span><span class="code-actions">
      <button class="cb" data-act="foldall" title="Fold or unfold every block">fold all</button>
      <button class="cb" data-act="copy" title="Copy to clipboard">copy</button>
      ${lang==="python"&&!driver?`<button class="cb run" data-act="run" title="Run this code">▶ run</button>`:""}
    </span></div><div class="code-body"></div><div class="code-out" hidden></div>`;
  draw(el);
}
function draw(el){
  const st=blocks.get(el), body=el.querySelector(".code-body");
  const src=st.code.split("\n"), hl=highlightLines(st.code, st.lang), ranges=foldRanges(src);
  st.ranges=ranges;
  const w=String(src.length).length;
  body.innerHTML=`<div class="code-scroll"><div class="code-lines">${src.map((_,i)=>
    `<div class="cl${ranges[i]!==undefined?" foldable":""}" data-i="${i}"><span class="gut"><span class="ln" style="min-width:${w}ch">${i+1}</span><span class="fold">${ranges[i]!==undefined?"⌄":""}</span></span><span class="cc">${hl[i]||" "}</span></div>`).join("")}</div></div>`;
  applyFolds(el);
}
function applyFolds(el){
  const st=blocks.get(el);
  const hidden=new Set();
  for(const k of st.folded) for(let i=k+1;i<=st.ranges[k];i++) hidden.add(i);
  el.querySelectorAll(".cl").forEach(row=>{
    const i=+row.dataset.i;
    row.hidden=hidden.has(i);
    const f=st.folded.has(i);
    row.classList.toggle("folded",f);
    const ell=row.querySelector(".ell"); if(ell) ell.remove();
    if(f){ const n=st.ranges[i]-i; row.querySelector(".cc").insertAdjacentHTML("beforeend",`<span class="ell" title="${n} line${n>1?"s":""} folded">⋯</span>`); }
  });
  const btn=el.querySelector('[data-act="foldall"]'); btn.disabled=!Object.keys(st.ranges).length;
  btn.textContent = st.folded.size ? "unfold all" : "fold all";
}

/* ---------- a node-stream form: readers choose values; Python receives plain data ---------- */
function renderForm(form){
  const spec=JSON.parse(form.dataset.spec||'{"tiers":[],"rows":[]}');
  form._spec=spec;
  // the Python block right after the form is its driver: read-only, tucked under "show the Python"
  let drv=form.nextElementSibling; while(drv && !drv.classList.contains("codeblock")) drv=drv.nextElementSibling;
  if(drv && drv.dataset.lang==="python"){ drv.classList.add("driver"); } else drv=null;
  form.innerHTML=`<div class="nf-cap">left daughters, from the top of the tree to the bottom</div>
    <div class="nf-grid" style="--n:${spec.tiers.length}">
      <div class="nf-head"><span></span><span>label</span>${spec.tiers.map(t=>`<span>${esc(t.name)}</span>`).join("")}<span></span></div>
      <div class="nf-rows"></div>
    </div>
    <div class="nf-bar"><button class="cb" data-nf="add">+ add node</button><span class="nf-sp"></span>
      ${drv?`<button class="cb" data-nf="code">show the Python</button>`:""}<button class="cb run" data-nf="run">▶ run</button></div>
    <div class="nf-code" hidden></div><div class="code-out" hidden></div>`;
  if(drv){ form.querySelector(".nf-code").appendChild(drv); render(drv); form._driver=drv; }
  spec.rows.forEach(r=>addRow(form, r));
}
function addRow(form, r={label:"", vals:{}}){
  const spec=form._spec;
  const row=document.createElement("div"); row.className="nf-row";
  row.innerHTML=`<span class="nf-pos"></span><input class="nf-label" maxlength="16" spellcheck="false" placeholder="label" value="${esc(r.label||"")}">`+
    spec.tiers.map(t=>`<select data-tier="${esc(t.name)}" aria-label="${esc(t.name)}"><option value="">–</option>${t.values.map(v=>`<option${r.vals&&r.vals[t.name]===v?" selected":""}>${esc(v)}</option>`).join("")}</select>`).join("")+
    `<span class="nf-act"><button class="nfb" data-nf="up" title="move up">↑</button><button class="nfb" data-nf="down" title="move down">↓</button><button class="nfb" data-nf="del" title="remove">×</button></span>`;
  form.querySelector(".nf-rows").appendChild(row);
  renumber(form);
}
function renumber(form){ form.querySelectorAll(".nf-row").forEach((r,i)=>r.querySelector(".nf-pos").textContent=i+1); }
function formData(form){
  // only the offered values get through: labels are plain text, everything else comes from the dropdowns
  return [...form.querySelectorAll(".nf-row")].map(r=>{
    const d={label:r.querySelector(".nf-label").value.replace(/[^\w\s'.\-]/g,"").slice(0,16).trim()};
    r.querySelectorAll("select").forEach(s=>{ const t=form._spec.tiers.find(t=>t.name===s.dataset.tier); d[s.dataset.tier]=t&&t.values.includes(s.value)?s.value:null; });
    return d;
  });
}

/* ---------- running Python ---------- */
let pyodideP=null;
function loadPy(status){
  if(pyodideP) return pyodideP;
  status("loading Python (≈10 MB, first time only)…");
  pyodideP=new Promise((res,rej)=>{
    const s=document.createElement("script"); s.src=PYODIDE+"pyodide.js";
    s.onload=()=>window.loadPyodide({indexURL:PYODIDE}).then(res,rej);
    s.onerror=()=>rej(new Error("could not download Pyodide (are you offline?)"));
    document.head.appendChild(s);
  });
  pyodideP.catch(()=>{ pyodideP=null; });
  return pyodideP;
}
const sessions=new WeakMap(); // page element → Python globals dict
// run `code` after making sure the page's earlier blocks have run; show the result in `out`
async function runOn(el, code, out, before){
  out.hidden=false; out.className="code-out";
  const status=t=>{ out.innerHTML=`<span class="co-status">${esc(t)}</span>`; };
  const page=el.closest(".page")||document.body;
  try{
    const py=await loadPy(status);
    let ns=sessions.get(page); if(!ns){ ns=py.globals.get("dict")(); sessions.set(page, ns); }
    const all=[...page.querySelectorAll('.codeblock[data-lang="python"]:not(.driver)')];
    const upto=all.filter(b=>b.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING);
    for(const other of upto){ const o=blocks.get(other); if(o.ranAs===o.code) continue; await exec(py, ns, o.code, other.querySelector(".code-out"), true); o.ranAs=o.code; }
    if(before) before(py, ns);
    status("running…");
    await exec(py, ns, code, out, false);
  } catch(e){ out.hidden=false; out.classList.add("err"); out.innerHTML=`<pre>${esc(String(e.message||e))}</pre>`; }
}
async function exec(py, ns, code, out, quiet){
  let buf="";
  py.setStdout({batched:s=>{ buf+=s+"\n"; }}); py.setStderr({batched:s=>{ buf+=s+"\n"; }});
  try{
    const r=await py.runPythonAsync(code, {globals:ns});
    if(r!==undefined && r!==null && !quiet) buf+=String(r)+"\n";
    if(!quiet){ out.classList.remove("err"); out.innerHTML=buf?`<pre>${esc(buf.replace(/\n$/,""))}</pre>`:`<span class="co-status">✓ ran, no output. Its definitions are now available to the rest of this page.</span>`; }
  } catch(e){
    const msg=String(e.message||e).split("\n").filter(l=>!/^\s*File "\/lib\/python|_pyodide|pyodide\//.test(l)).join("\n").trim();
    out.hidden=false; out.classList.add("err"); out.innerHTML=`<pre>${esc((buf||"")+msg)}</pre>`;
    throw new Error(quiet?"an earlier code block on this page failed; see its output":msg);
  }
}

/* ---------- events ---------- */
document.addEventListener("click",async e=>{
  const fold=e.target.closest(".codeblock .cl.foldable .gut, .codeblock .ell");
  if(fold){ const el=fold.closest(".codeblock"), st=blocks.get(el), i=+fold.closest(".cl").dataset.i;
    st.folded.has(i)?st.folded.delete(i):st.folded.add(i); applyFolds(el); return; }
  const nf=e.target.closest(".nodeform [data-nf]");
  if(nf){
    const form=nf.closest(".nodeform"), row=nf.closest(".nf-row");
    switch(nf.dataset.nf){
      case "add": addRow(form); form.querySelector(".nf-row:last-child .nf-label").focus(); break;
      case "del": row.remove(); renumber(form); break;
      case "up": if(row.previousElementSibling) row.parentNode.insertBefore(row,row.previousElementSibling); renumber(form); break;
      case "down": if(row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling,row); renumber(form); break;
      case "code": { const c=form.querySelector(".nf-code"); c.hidden=!c.hidden; nf.textContent=c.hidden?"show the Python":"hide the Python"; break; }
      case "run": {
        if(!form._driver) return;
        const data=formData(form);
        nf.disabled=true;
        await runOn(form, blocks.get(form._driver).code, form.querySelector(":scope > .code-out"), (py,ns)=>{ const v=py.toPy(data); ns.set("stream_data", v); v.destroy&&v.destroy(); });
        nf.disabled=false; break; }
    }
    return;
  }
  const b=e.target.closest(".codeblock .cb"); if(!b) return;
  const el=b.closest(".codeblock"), st=blocks.get(el);
  switch(b.dataset.act){
    case "foldall": if(st.folded.size) st.folded.clear(); else Object.keys(st.ranges).forEach(k=>{
        const k0=+k; if(!Object.entries(st.ranges).some(([a,end])=>+a<k0 && end>=k0)) st.folded.add(k0); });
      applyFolds(el); break;
    case "copy": try{ await navigator.clipboard.writeText(st.code); b.textContent="copied"; setTimeout(()=>b.textContent="copy",1200); }catch(_){ b.textContent="press ⌘C"; } break;
    case "run": b.disabled=true; await runOn(el, st.code, el.querySelector(".code-out")); st.ranAs=st.code; b.disabled=false; break;
  }
});

function renderAll(root){
  root.querySelectorAll(".nodeform").forEach(f=>{ if(!f._spec) renderForm(f); });
  root.querySelectorAll(".codeblock").forEach(el=>{ if(!blocks.has(el)) render(el); });
}
window.Code={ renderAll, highlightLines };
})();
