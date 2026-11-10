/* checker.js — the Checker page: check a batch of trees against one labelling algorithm.
 *
 * It uses the Python block that follows the \begin{tryit}{report}… box on its chapter page, so the
 * code shown and run here is always the code in that chapter. Readers type trees; each one is sent to
 * check_batch() in that code as a plain string. The batch is kept in this browser (localStorage).
 */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const KEY="am-checker-batch";
const load=()=>{ try{ const v=JSON.parse(localStorage.getItem(KEY)||"[]"); return Array.isArray(v)?v.filter(t=>typeof t==="string"):[]; }catch(_){ return []; } };
const save=()=>{ try{ localStorage.setItem(KEY, JSON.stringify(trees.map(t=>t.text))); }catch(_){} };

let page, box, code="", example="", trees=[], restored=false, busy=false;

function init(){
  page=$('.page[data-page="checker"]');
  box=document.querySelector('.tryit[data-fn="report"]');
  if(!page) return;
  if(!box){ page.querySelector(".single").insertAdjacentHTML("beforeend",`<p class="placeholder">The checker's code could not be found.</p>`); return; }
  let drv=box.nextElementSibling; while(drv && !drv.classList.contains("codeblock")) drv=drv.nextElementSibling;
  code=drv?Code.source(drv):"";
  example=box.dataset.example||"";
  const src=box.closest(".page"), title=src&&src.querySelector("h1.title");
  const back=page.querySelector(".back");
  if(src){ back.dataset.go=src.dataset.page; back.textContent="← "+(title?title.textContent:"back"); }
  // a link to here from the chapter's try-it box
  const bar=box.querySelector(".nf-bar");
  if(bar && !bar.querySelector(".ck-link")) bar.insertAdjacentHTML("afterbegin",`<a class="cb ck-link" data-go="checker">check several trees together →</a>`);

  const usage=box.querySelector(".try-usage")?.textContent||"";
  $("#ck-entry").innerHTML=`
    <div class="ck-box">
      <div class="nf-cap">one tree at a time: press Enter (or “add”) to save it to the batch</div>
      ${usage?`<pre class="try-usage">${esc(usage)}</pre>`:""}
      <textarea class="try-in" id="ck-in" rows="2" spellcheck="false"></textarea>
      <div class="nf-bar"><button class="cb" data-ck="example">reset to example</button><span class="nf-sp"></span>
        <button class="cb" data-ck="add">+ add to batch</button><button class="cb run" data-ck="run">▶ check the batch</button></div>
      <div class="code-out" id="ck-status" hidden></div>
    </div>
    <h3 class="ck-h">The batch <span class="ck-n" id="ck-n"></span><button class="cb" data-ck="clear">clear all</button></h3>
    <ol class="ck-list" id="ck-list"></ol>
    <div class="ck-result" id="ck-result" hidden></div>
    <details class="ck-trees" id="ck-trees"><summary>The trees as diagrams, with the rules each one mandates on its own</summary><div id="ck-cards"></div></details>`;
  $("#ck-code").innerHTML=`<p class="ck-note">This is the Python from the chapter. The checker calls <code>check_batch()</code> with the trees in the batch.</p>
    <div class="codeblock" data-lang="python"><pre class="code-src">${esc(code)}</pre></div>`;
  Code.renderAll($("#ck-code"));
  $("#ck-in").value=example;
  trees=load().map(text=>({text, data:null}));
  drawList();
}

// called by app.js each time the page is shown
async function show(){
  if(!restored && trees.length){ restored=true; await recheck(); }
  restored=true;
}

/* ---------- running the Python ---------- */
function status(html, err){ const s=$("#ck-status"); s.hidden=!html; s.className="code-out"+(err?" err":""); s.innerHTML=html; }
async function call(texts){
  const wrap=code+`\ntry:\n    _ck = {"ok": check_batch(list(_ck_texts))}\nexcept ValueError as _ck_error:\n    _ck = {"error": str(_ck_error)}\n_ck`;
  const r=await Code.evalPy(wrap, {_ck_texts:texts}, t=>status(`<span class="co-status">${esc(t)}</span>`));
  if(r.error) throw new Error(r.error);
  return r.ok;
}
async function guarded(f){
  if(busy) return; busy=true; page.classList.add("busy");
  try{ await f(); } catch(e){ status(`<pre>${esc(String(e.message||e))}</pre>`, true); }
  finally{ busy=false; page.classList.remove("busy"); }
}
// redo the per-tree checks for the saved batch (after a reload)
function recheck(){ return guarded(async()=>{
  status(`<span class="co-status">checking the saved trees…</span>`);
  const r=await call(trees.map(t=>t.text));
  r.trees.forEach((d,i)=>trees[i].data=d);
  status(""); drawList();
}); }
function add(){ return guarded(async()=>{
  const inp=$("#ck-in"), text=inp.value.trim().replace(/\s+/g," ");
  if(!text) return;
  status(`<span class="co-status">checking…</span>`);
  const r=await call([text]);
  trees.push({text, data:r.trees[0]}); save();
  inp.value=""; inp.focus();
  status(`<span class="co-status">added as tree ${trees.length}. Type the next one, or check the batch.</span>`);
  clearResult(); drawList();
}); }
function run(){ return guarded(async()=>{
  const inp=$("#ck-in");
  if(inp.value.trim() && !trees.some(t=>t.text===inp.value.trim().replace(/\s+/g," "))) status(`<span class="co-status">the tree in the box is not in the batch yet; press Enter to add it.</span>`);
  else status("");
  if(!trees.length){ status(`<span class="co-status">the batch is empty: type a tree and press Enter to add it.</span>`); return; }
  const r=await call(trees.map(t=>t.text));
  r.trees.forEach((d,i)=>trees[i].data=d);
  drawList(); drawResult(r.batch);
}); }

/* ---------- drawing ---------- */
const rule=([p,w,m])=>`τ(partial=${esc(p)}, whole=${esc(w)}) = ${esc(m)}`;
function tierLine(t, alone){
  if(!t.passes){
    let s=`<b>${esc(t.tier)}</b>: <span class="ck-bad">fails</span> (none of ${t.total} lawful transition functions derive ${alone?"it":"every tree"})`;
    t.blocked.forEach(([h,v,vs])=>{ s+=`<div class="ck-sub">${esc(h)} never surfaces as ${esc(v)}; it can only surface as ${vs.map(esc).join(", ")}</div>`; });
    return s;
  }
  let s=`<b>${esc(t.tier)}</b>: <span class="ck-ok">passes</span> (${t.passing} of ${t.total} lawful transition functions derive ${alone?"it":"every tree"})`;
  if(t.mandated.length) s+=t.mandated.map(m=>`<div class="ck-sub">mandates ${rule(m)}</div>`).join("");
  else s+=`<div class="ck-sub ck-muted">no transition rules are mandated</div>`;
  return s;
}
function drawList(){
  $("#ck-n").textContent=trees.length?`(${trees.length})`:"";
  $("#ck-list").innerHTML=trees.length?trees.map((t,i)=>{
    const tiers=t.data?t.data.tiers:[];
    const tag=!t.data?"":tiers.every(x=>x.passes)?`<span class="ck-ok">passes alone</span>`:`<span class="ck-bad">fails alone</span>`;
    return `<li><code>${esc(t.text)}</code><span class="ck-tag">${tag}</span><button class="nfb" data-ck="del" data-i="${i}" title="remove this tree">×</button></li>`; }).join("")
    :`<li class="ck-empty">no trees yet</li>`;
  const cards=$("#ck-cards"), diagrams={};
  cards.innerHTML=trees.map((t,i)=>{
    if(!t.data) return "";
    diagrams["ck"+i]=forest(t.data.tree);
    const tiers=t.data.tiers.length?t.data.tiers.map(x=>`<div class="ck-tier">${tierLine(x,true)}</div>`).join(""):`<div class="ck-muted">no features on any head</div>`;
    return `<div class="ck-card"><div class="ck-cap">tree ${i+1}</div><div class="diagram boxed" data-dg="ck${i}"></div>${tiers}</div>`;
  }).join("")||`<p class="ck-muted">no trees yet</p>`;
  Diagrams.renderAll(diagrams, cards);
  if($("#ck-trees").open) Diagrams.fitDiagrams(cards);
}
function clearResult(){ const r=$("#ck-result"); r.hidden=true; r.innerHTML=""; }
function drawResult(batch){
  const ok=batch.every(t=>t.passes), n=trees.length;
  let html=`<div class="ck-verdict ${ok?"ck-ok":"ck-bad"}">${ok?"PASSES":"FAILS"}</div>
    <p class="ck-says">${ok?`One consistent labelling algorithm derives all ${n} tree${n>1?"s":""}.`:`No single consistent labelling algorithm derives all ${n} trees.`}</p>`;
  html+=batch.length?batch.map(t=>`<div class="ck-tier">${tierLine(t,false)}${t.passes?"":conflicts(t.tier)}</div>`).join(""):`<p class="ck-muted">no features on any head, so there is nothing to check.</p>`;
  const r=$("#ck-result"); r.innerHTML=html; r.hidden=false;
}
// trees that each pass alone but mandate opposite values for the same pair
function conflicts(tier){
  const by={};
  trees.forEach((t,i)=>{ const x=t.data&&t.data.tiers.find(x=>x.tier===tier); if(!x) return;
    x.mandated.forEach(([p,w,m])=>{ const k=p+"\u0000"+w; (by[k]=by[k]||{})[m]=(by[k][m]||[]).concat(i+1); }); });
  const lines=[];
  for(const [k,ms] of Object.entries(by)){ const vals=Object.keys(ms); if(vals.length<2) continue;
    const [p,w]=k.split("\u0000");
    lines.push(vals.map(m=>`${ms[m].length>1?"trees":"tree"} ${ms[m].join(", ")} mandate${ms[m].length>1?"":"s"} ${rule([p,w,m])}`).join("; but "));
  }
  if(lines.length) return lines.map(l=>`<div class="ck-sub">${l}</div>`).join("");
  const alone=trees.every(t=>!t.data||(t.data.tiers.find(x=>x.tier===tier)||{passes:true}).passes);
  return alone?`<div class="ck-sub ck-muted">each tree passes on its own, and no two trees mandate opposite rules directly, but no single transition function derives them all</div>`:"";
}

// a tree from as_data() → a forest diagram: XP over its outermost specifier and X′; X′ over inner specifiers; X over its complement; adjuncts adjoin to XP; phases are boxed
const node=(html,kids=[],draw=false)=>({html, kids, name:null, roof:false, draw, circle:false, edgeNone:false, opts:{}});
function xbar(d){
  const feats=d.head.features.map(f=>`<span class="ck-f">${esc(f)}</span>`).join("<br>");
  const head=node(`${esc(d.head.name)}${feats?"<br>"+feats:""}`);
  const label=esc(d.name), bar=esc(d.head.name)+"′";
  let kids=d.complement?[head, xbar(d.complement)]:[head];
  for(const s of d.specifiers) kids=[xbar(s), node(bar, kids)]; // innermost first
  let n=node(label, kids);
  d.adjuncts.forEach(a=>{ n=node(label, [n, xbar(a)]); });
  n.draw=d.phase;
  return n;
}
const forest=d=>({kind:"forest", root:xbar(d), opts:{ssep:18, lsep:26}, ops:[]});

/* ---------- events ---------- */
document.addEventListener("click",e=>{
  const tab=e.target.closest("#ck-tabs [data-tab-ck]");
  if(tab){ const t=tab.dataset.tabCk;
    document.querySelectorAll("#ck-tabs button").forEach(b=>b.classList.toggle("on",b===tab));
    $("#ck-entry").hidden=t!=="entry"; $("#ck-code").hidden=t!=="code"; return; }
  const b=e.target.closest('.page[data-page="checker"] [data-ck]'); if(!b) return;
  switch(b.dataset.ck){
    case "example": $("#ck-in").value=example; $("#ck-in").focus(); break;
    case "add": add(); break;
    case "run": run(); break;
    case "del": trees.splice(+b.dataset.i,1); save(); clearResult(); drawList(); break;
    case "clear": if(trees.length && confirm(`Remove all ${trees.length} trees from the batch?`)){ trees=[]; save(); clearResult(); drawList(); status(""); } break;
  }
});
document.addEventListener("keydown",e=>{
  if(e.target.id!=="ck-in" || e.key!=="Enter" || e.shiftKey) return;
  e.preventDefault(); add();
});
document.addEventListener("toggle",e=>{ if(e.target.id==="ck-trees" && e.target.open) Diagrams.fitDiagrams($("#ck-cards")); }, true);

window.Checker={ init, show };
})();
