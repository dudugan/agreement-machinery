/* app.js — loads the LaTeX sources listed in content/manifest.json and builds the site. */
(async function(){
"use strict";
const BASE="content/";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const pop=$("#pop"); let popT;
const ROMAN=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
const cap=w=>w?w[0].toUpperCase()+w.slice(1):"";
const pad=n=>String(n).padStart(2,"0");
const strip=h=>{ const d=document.createElement("div"); d.innerHTML=h; return d.textContent.replace(/\s+/g," ").trim(); };
const text=async url=>{ const r=await fetch(url,{cache:"no-cache"}); if(!r.ok) throw new Error(url+" "+r.status); return r.text(); };

/* ---------- load ---------- */
let manifest;
try { manifest=await (await fetch(BASE+"manifest.json",{cache:"no-cache"})).json(); }
catch(e){ $("#loading").innerHTML=`Could not load <code>content/manifest.json</code>. The site has to be served over http (see README), not opened as a file.`; return; }

const [macroSrc, bibSrc]=await Promise.all([text(BASE+manifest.macros).catch(()=>""), text(BASE+manifest.bibliography).catch(()=>"")]);
const st=LaTeX.makeState(LaTeX.parseMacros(macroSrc));
const bib=LaTeX.parseBib(bibSrc, st);

const chapters=[]; // {id,file,part,n}
manifest.parts.forEach((p,pi)=>p.chapters.forEach(f=>chapters.push({file:f, part:pi})));
const slug=f=>f.replace(/^.*\//,"").replace(/\.tex$/,"");
const [chapSrc, phenSrc]=await Promise.all([
  Promise.all(chapters.map(c=>text(BASE+c.file).catch(()=>null))),
  Promise.all((manifest.phenomena||[]).map(f=>text(BASE+f).catch(()=>null))),
]);

const META={}, DOCS=[];
chapters.forEach((c,i)=>{
  c.id=slug(c.file); c.n=i+1;
  const src=chapSrc[i]??"";
  const doc=LaTeX.parseDocument(c.id, src, st, c.n);
  const m=doc.meta;
  META[c.id]={title:m.title||cap(c.id.replace(/-/g," ")), cat:cap(m.category||""), catKey:(m.category||"").toLowerCase(), n:c.n, part:c.part, doc,
    missing:chapSrc[i]==null, stub:!strip(doc.html)};
  DOCS.push([c.id, META[c.id].title, META[c.id].catKey]);
});
const PHEN=[];
(manifest.phenomena||[]).forEach((f,i)=>{
  const src=phenSrc[i]; if(src==null){ st.warnings.push("missing phenomenon file "+f); return; }
  const id=slug(f);
  const doc=LaTeX.parseDocument("ph-"+id, src, st, 0);
  PHEN.push({id, doc});
});
LaTeX.resolve(st, bib, id=>META[id]?{n:META[id].n, title:META[id].title}:{n:null,title:""});
const conv=s=>LaTeX.convert(s||"", st, {}, "inline");
PHEN.forEach(p=>{ const m=p.doc.meta;
  p.name=conv(m.name||p.id); p.lang=conv(m.language||""); p.probe=conv(m.probe||""); p.goal=conv(m.goal||"");
  p.featsRaw=(m.features||"").split(",").map(s=>s.trim()).filter(Boolean); p.feats=p.featsRaw.map(conv); p.featText=p.feats.map(strip);
  const none=!m.blockers || /^(--+|—|–|none|-)$/.test(m.blockers.trim());
  p.block=none?"—":conv(m.blockers); p.noBlock=none;
  p.discussed=(m.discussed||"").split(",").map(s=>s.trim()).filter(Boolean);
});
const docOf=id=>META[id]?.doc;

/* ---------- build chapter pages ---------- */
const pages=$("#pages");
const SYN={};
const total=chapters.length;
chapters.forEach((c,i)=>{
  const M=META[c.id], d=M.doc;
  SYN[c.id]=d.abstract?strip(d.abstract):"";
  if(M.stub) return;
  const prev=chapters[i-1], next=chapters[i+1];
  const notes=d.notes.map(n=>`<div class="note ${n.kind==="fn"?"fn":"com"}" data-n="${n.id}"><span class="k">${n.kind==="fn"?n.n:"◆"}</span><div>${n.html}<br><span class="tag">${n.kind==="fn"?"footnote":"comment"}</span></div></div>`).join("");
  const sec=document.createElement("section");
  sec.className="page"; sec.dataset.page=c.id;
  const stats=[`chapter ${pad(c.n)} of ${pad(total)}`, d.examples?`${d.examples} example${d.examples>1?"s":""}`:null, d.diagramCount?`${d.diagramCount} diagram${d.diagramCount>1?"s":""}`:null, d.notes.length?`${d.notes.length} note${d.notes.length>1?"s":""}`:null].filter(Boolean).join(" · ");
  sec.innerHTML=`<div class="pagegrid"><article>
      <p class="crumb">${M.cat?M.cat+" · ":""}Chapter ${c.n}</p>
      <h1 class="title">${M.title}</h1>
      <div class="meta">${stats}</div>
      ${d.abstract?`<div class="abstract"><span class="lbl">Tl;dr</span>${d.abstract}</div>`:""}
      ${d.html}
      <div class="chapnav">${prev?`<a data-go="${prev.id}">← ${prev.n} · <i>${META[prev.id].title}</i></a>`:"<span></span>"}${next?`<a data-go="${next.id}">${next.n} · <i>${META[next.id].title}</i> →</a>`:"<span></span>"}</div>
    </article>
    <div class="margin">
      <div class="mhead"><span class="t">Notes</span><span class="c">${d.notes.length}</span></div>
      <div class="chips"><button class="chip on" data-kind="fn">Footnotes</button><button class="chip on" data-kind="com">Comments</button></div>
      ${notes}
    </div></div>`;
  pages.appendChild(sec);
});

/* ---------- bibliography page ---------- */
(function buildBib(){
  const citedIn={};
  const allDocs=[...chapters.map(c=>META[c.id].doc), ...PHEN.map(p=>p.doc)];
  allDocs.forEach(d=>d.cites.forEach(c=>{ (citedIn[c.key]=citedIn[c.key]||new Map()).set(d.id+"|"+(c.sec?c.sec.id:""), {d, sec:c.sec}); }));
  const entries=Object.values(bib).sort((a,b)=>a.sortKey.localeCompare(b.sortKey));
  let html="", letter="";
  entries.forEach(e=>{
    const L=strip(e.short)[0]?.toUpperCase()||"?";
    if(L!==letter){ letter=L; html+=`<li class="letter">${L}</li>`; }
    const where=[...(citedIn[e.key]||new Map()).values()].map(({d,sec})=>{
      if(d.id.startsWith("ph-")){ const p=PHEN.find(x=>"ph-"+x.id===d.id); return `<a data-go="ph:${p.id}">${strip(p.name)}</a>`; }
      const M=META[d.id]; return `<a data-go="${d.id}"${sec?` data-to="${sec.id}"`:""}>ch. ${M.n}${sec&&sec.num?" §"+sec.num:""}</a>`; }).join(" ");
    html+=`<li id="bib-${e.key}">${e.html}${where?`<span class="by">cited in ${where}</span>`:`<span class="by">not cited yet</span>`}</li>`;
  });
  $("#bib-list").innerHTML=html;
  $("#bib-meta").textContent=`${entries.length} works · each entry lists where it is cited`;
})();

/* ---------- sidebar ---------- */
const PARTS=manifest.parts.map(p=>p.title);
const CATS=manifest.categories||["languages","properties","phenomena","theories"];
let current=null, mode="order";
const side=$("#side");
function renderSide(){
  const q=$("#search").value.trim().toLowerCase();
  const match=([id,t])=>!q||t.toLowerCase().includes(q)||strip(SYN[id]||"").toLowerCase().includes(q);
  const li=([id,t])=>`<li><a data-go="${id}" class="${id===current?"on":""}${META[id].stub?" stub":""}"><span class="n">${pad(META[id].n)}</span>${t}</a></li>`;
  let h="";
  if(mode==="order") PARTS.forEach((name,i)=>{ const docs=DOCS.filter(d=>META[d[0]].part===i && match(d)); if(docs.length) h+=`<h4><span class="rn">${ROMAN[i+1]}</span>${name}</h4><ol>${docs.map(li).join("")}</ol>`; });
  else CATS.forEach(c=>{ const docs=DOCS.filter(d=>d[2]===c && match(d)); if(docs.length) h+=`<h4>${cap(c)}</h4><ol>${docs.map(li).join("")}</ol>`; });
  side.innerHTML=h||`<div class="empty">nothing matches “${LaTeX.esc(q)}”</div>`;
}
$("#search").addEventListener("input",renderSide);
function setMode(m){ mode=m; $$("#sidemode button").forEach(b=>b.classList.toggle("on",b.dataset.mode===m)); renderSide(); }
$$("#sidemode button").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
const menubtn=$("#menubtn");
function setMenu(open){ document.body.classList.toggle("sideopen",open); menubtn.textContent=open?"× Contents":"☰ Contents"; }
menubtn.onclick=()=>setMenu(!document.body.classList.contains("sideopen"));

/* ---------- encyclopedia ---------- */
const FEAT=manifest.features||{};
function rng(seed){ let x=seed*9301+49297; return ()=>((x=(x*9301+49297)%233280)/233280); }
PHEN.forEach((b,i)=>{ const r=rng(i+7);
  b.l=Math.round(4+r()*30); b.r=Math.round(4+r()*38); b.h=Math.round(54+r()*16); b.label=r()>.62;
  b.rot=((r()-.5)*1.6+(i%2?.25:-.25)).toFixed(2)+"deg"; b.seed=i+11; });
function bookSVG(seed){
  const r=rng(seed), j=n=>(r()-.5)*2*n, P=(x,y)=>`${x.toFixed(1)},${y.toFixed(1)}`;
  const tl=[j(5)+5,j(4)+4], tr=[995+j(5),j(4)+4], br=[995+j(5),96+j(4)], bl=[j(5)+5,96+j(4)];
  const edge=(a,b,bow)=>`Q${P((a[0]+b[0])/2+j(bow),(a[1]+b[1])/2+j(bow))} ${P(...b)}`;
  const body=`M${P(...tl)} ${edge(tl,tr,3)} ${edge(tr,br,5)} ${edge(br,bl,3)} ${edge(bl,tl,5)}Z`;
  const vline=x=>`M${P(x+j(1.5),8+j(3))} Q${P(x+j(2.5),50)} ${P(x+j(1.5),92+j(3))}`;
  const lx=16+r()*6, rx=984-r()*6;
  const bands=[vline(lx),vline(lx+7+r()*3),vline(rx),vline(rx-7-r()*3)].join(" ");
  const ghost=`M${P(tl[0]+j(3),tl[1]+j(2))} ${edge(tl,tr,4)} ${edge(tr,br,6)}`;
  return `<path class="body" vector-effect="non-scaling-stroke" d="${body}"/><path class="line" vector-effect="non-scaling-stroke" d="${bands}"/><path class="ghost" vector-effect="non-scaling-stroke" d="${ghost}"/>`;
}
(function drawPlank(){ const r=rng(3), j=n=>(r()-.5)*2*n;
  $("#plank").innerHTML=
    `<path vector-effect="non-scaling-stroke" stroke-width="1.4" d="M0,${4+j(1)} Q250,${4+j(2)} 500,${4+j(1.5)} T1000,${4+j(1)}"/>`+
    `<path vector-effect="non-scaling-stroke" stroke-width="1" d="M8,${12+j(1)} Q300,${12+j(2)} 600,${12+j(1.5)} T992,${12+j(1)}"/>`+
    `<path vector-effect="non-scaling-stroke" stroke-width="1" d="M30,12 L22,18 M970,12 L978,18"/>`; })();
// feature filter chips come from the features actually used
const allFeats=[...new Set(PHEN.flatMap(p=>p.featText))];
$("#enc-feats").innerHTML=`<span class="lbl">features</span>`+allFeats.map(f=>`<button class="chip" data-f="${LaTeX.esc(f)}" title="${LaTeX.esc(FEAT[f]||"")}">${LaTeX.esc(f)}</button>`).join("");
$("#enc-legend").textContent=[...allFeats.map(f=>`${f} ${FEAT[f]||""}`.trim()),"— none known"].join(" · ");
let encSort={k:null,desc:false}, encFeats=new Set();
const stack=$("#stack");
const cellText=(b,k)=>k==="feats"?b.featText.join(", "):strip(b[k]);
function renderStack(){
  stack.innerHTML=PHEN.map(b=>`<a class="book${b.label?" label":""}" tabindex="0" data-go="ph:${b.id}" data-id="${b.id}"
    style="--l:${b.l}px;--r:${b.r}px;--h:${b.h}px;--rot:${b.rot}">
    <svg class="outline" viewBox="0 0 1000 100" preserveAspectRatio="none">${bookSVG(b.seed)}</svg>
    <span class="cell name"><span>${b.name}</span></span>
    <span class="cell" data-label="language">${b.lang}</span>
    <span class="cell" data-label="probe">${b.probe}</span>
    <span class="cell" data-label="goal">${b.goal}</span>
    <span class="cell feats" data-label="features">${b.feats.join(", ")}</span>
    <span class="cell${b.noBlock?" dim":""}" data-label="blockers">${b.block}</span></a>`).join("")+`<div class="empty" style="display:none">no volume matches</div>`;
  restack(false);
}
function restack(animate=true){
  const books=[...stack.querySelectorAll(".book")];
  const first=new Map(books.map(el=>[el,el.getBoundingClientRect()]));
  const q=$("#enc-q").value.trim().toLowerCase();
  let shown=0;
  books.forEach(el=>{ const b=PHEN.find(x=>x.id===el.dataset.id);
    const hit=(!q||[b.name,b.lang,b.probe,b.goal,b.block].map(strip).join(" ").toLowerCase().includes(q)) && [...encFeats].every(f=>b.featText.includes(f));
    el.classList.toggle("gone",!hit); if(hit) shown++; });
  const order=[...PHEN];
  if(encSort.k) order.sort((a,b)=>cellText(a,encSort.k).localeCompare(cellText(b,encSort.k))*(encSort.desc?-1:1));
  order.forEach(b=>stack.insertBefore(stack.querySelector(`[data-id="${b.id}"]`),stack.querySelector(".empty")));
  let row=0; order.forEach(b=>{ const el=stack.querySelector(`[data-id="${b.id}"]`); if(!el.classList.contains("gone")) el.classList.toggle("alt", row++%2===1); }); // zebra rows
  stack.querySelector(".empty").style.display=shown?"none":"block";
  $("#enc-meta").textContent=`${shown} of ${PHEN.length} volumes · click a spine to open it · click a heading to restack`;
  if(!animate) return;
  books.forEach(el=>{ if(el.classList.contains("gone")) return; const a=first.get(el), b=el.getBoundingClientRect();
    if(!a.height) return; const dy=a.top-b.top; if(!dy) return;
    el.animate([{translate:`0 ${dy}px`},{translate:"0 0"}],{duration:420,easing:"cubic-bezier(.2,.7,.3,1)"}); });
}
$$("#stack-head button").forEach(btn=>btn.onclick=()=>{
  const k=btn.dataset.k;
  encSort = encSort.k!==k ? {k,desc:false} : encSort.desc ? {k:null,desc:false} : {k,desc:true};
  $$("#stack-head button").forEach(x=>{ x.classList.toggle("on",x.dataset.k===encSort.k); x.classList.toggle("desc",x.dataset.k===encSort.k&&encSort.desc); });
  restack();
});
$("#enc-q").addEventListener("input",()=>restack());
$$("#enc-feats .chip").forEach(c=>c.onclick=()=>{ const f=c.dataset.f; encFeats.has(f)?encFeats.delete(f):encFeats.add(f); c.classList.toggle("on",encFeats.has(f)); restack(); });
stack.addEventListener("keydown",e=>{ if(e.key==="Enter"&&e.target.closest(".book")) e.target.click(); });
renderStack();

function renderPhen(pid){
  const i=PHEN.findIndex(b=>b.id===pid), b=PHEN[i]; if(!b) return false;
  $("#ph-title").innerHTML=b.name;
  $("#ph-meta").textContent=`phenomenon · volume ${pad(i+1)} of ${pad(PHEN.length)}`;
  const disc=b.discussed.map(k=>{ const L=st.labels[k]; if(!L) return `<span class="unk">${LaTeX.esc(k)}</span>`; const M=META[L.doc];
    if(L.kind==="sec") return `<a class="xref" data-go="${L.doc}" data-to="${L.id}">Chapter ${M.n} §${L.num} · ${M.title}</a>`;
    if(L.kind==="ex") return `<a class="xref" data-ex="${L.id}">(${L.num}) in Chapter ${M.n}</a>`;
    return `<a class="xref" data-go="${L.doc}">Chapter ${M.n} · ${M.title}</a>`; }).join("<br>");
  $("#ph-card").innerHTML=`<div class="spine"></div><dl>
    <dt>language</dt><dd>${b.lang}</dd><dt>probe</dt><dd>${b.probe}</dd><dt>goal</dt><dd>${b.goal}</dd>
    <dt>features</dt><dd>${b.feats.map((f,k)=>`${f} <span style="color:var(--muted);font-size:15px">${FEAT[b.featText[k]]||""}</span>`).join(" &nbsp;·&nbsp; ")}</dd>
    <dt>blockers</dt><dd>${b.noBlock?'<span style="color:var(--muted)">none known</span>':b.block}</dd>
    ${disc?`<dt>discussed in</dt><dd>${disc}</dd>`:""}</dl>`;
  $("#ph-body").innerHTML=b.doc.html;
  const prev=PHEN[i-1], next=PHEN[i+1];
  $("#ph-nav").innerHTML=(prev?`<a data-go="ph:${prev.id}">← <i>${prev.name}</i></a>`:"<span></span>")+(next?`<a data-go="ph:${next.id}"><i>${next.name}</i> →</a>`:"<span></span>");
  Diagrams.renderAll(st.diagrams, $("#ph-body")); Code.renderAll($("#ph-body"));
  return true;
}

/* ---------- navigation (with #hash routing so links and reloads work) ---------- */
function go(id, to, {push=true}={}){
  let page=id;
  if(id.startsWith("ph:")){ page="phen"; if(!renderPhen(id.slice(3))) { id="encyclopedia"; page=id; } }
  else if(META[id] && META[id].stub){
    page="stub"; const m=META[id];
    $("#stub-crumb").textContent=`${m.cat?m.cat+" · ":""}Chapter ${m.n}`;
    $("#stub-title").textContent=m.title;
    $("#stub-msg").innerHTML=m.missing?`The file <code>${chapters[m.n-1].file}</code> could not be found.`:`This chapter has not been drafted yet.`;
  }
  else if(!document.querySelector(`.page[data-page="${id}"]`)){ id=chapters[0]?.id||"about"; page=id; }
  const same=id===current;
  current=id;
  $$(".page").forEach(p=>p.classList.toggle("on",p.dataset.page===page));
  const tab=META[id]?"machinery":id.startsWith("ph:")?"encyclopedia":id;
  $$("nav.tabs a").forEach(a=>a.classList.toggle("on",a.dataset.tab===tab));
  document.body.classList.toggle("noside",!META[id]); setMenu(false); setHdr();
  document.body.classList.toggle("nonotes",!document.querySelector(`.page[data-page="${page}"] .note`));
  if(push){ const h="#"+id+(to?"/"+to:""); if(location.hash!==h) history.pushState(null,"",h); }
  document.title=(META[id]?META[id].title+" · ":"")+"Agreement Machinery";
  renderSide(); relayout();
  if(to){ const el=document.getElementById(to); if(el){ el.scrollIntoView({behavior: same?"smooth":"instant", block:"start"});
      if(el.matches(".ex,.sub,li")){ el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } } }
  else if(!same) window.scrollTo({top:0,behavior:"instant"});
}
const pageOfEl=id=>{ const el=document.getElementById(id); const p=el&&el.closest(".page"); return p?p.dataset.page:null; };
document.addEventListener("click",e=>{
  const a=e.target.closest("[data-go],[data-ex],[data-bib],[data-top]");
  if(!a) return;
  e.preventDefault(); hidePop();
  if(a.dataset.top){ window.scrollTo({top:0,behavior:"smooth"}); return; }
  if(a.dataset.bib) return go("bibliography","bib-"+a.dataset.bib);
  if(a.dataset.ex){ const pg=pageOfEl(a.dataset.ex); if(pg) return go(pg==="phen"?current:pg, a.dataset.ex); return; }
  go(a.dataset.go,a.dataset.to);
});
window.addEventListener("popstate",()=>routeFromHash(false));
function routeFromHash(push){ const [id,to]=decodeURIComponent(location.hash.slice(1)).split("/"); go(id||chapters[0].id, to, {push}); }

/* ---------- corner toggles ---------- */
const togL=$("#togleft"), togR=$("#togright");
const narrow=()=>matchMedia("(max-width:980px)").matches;
function setLeft(open){ if(narrow()) return setMenu(open); document.body.classList.toggle("hideleft",!open); togL.classList.toggle("off",!open); relayout(); }
function setRight(open){ document.body.classList.toggle("hideright",!open); togR.classList.toggle("off",!open); if(open) hidePop(); relayout(); }
togL.onclick=()=>setLeft(narrow()? !document.body.classList.contains("sideopen") : document.body.classList.contains("hideleft"));
togR.onclick=()=>setRight(document.body.classList.contains("hideright"));
function openNote(key){
  setRight(true);
  const n=document.querySelector(`.page.on .note[data-n="${key}"]`); if(!n) return;
  n.scrollIntoView({behavior:"smooth",block:"center"});
  hot(key,true); setTimeout(()=>hot(key,false),1400);
}
document.addEventListener("click",e=>{
  const r=e.target.closest(".page.on .ref"); if(!r) return;
  const key=r.dataset.r;
  if(document.body.classList.contains("hideright") && pop.dataset.note!==key){ showNotePop(r); return; }
  openNote(key);
});
pop.addEventListener("click",()=>{ if(pop.dataset.note) openNote(pop.dataset.note); });
pop.addEventListener("mouseleave",()=>{ if(pop.dataset.note) hidePop(); });
function showNotePop(r){
  const n=document.querySelector(`.page.on .note[data-n="${r.dataset.r}"]`); if(!n) return;
  const isCom=n.classList.contains("com");
  showPop(r,`<div class="pk">${isCom?"Comment":"Footnote "+n.querySelector(".k").textContent}</div>${n.querySelector("div").innerHTML.replace(/<br><span class="tag">.*?<\/span>$/,"")}<span class="hint">click to open notes →</span>`);
  pop.classList.add("note-pop"); pop.dataset.note=r.dataset.r;
}
document.addEventListener("mouseover",e=>{
  const r=e.target.closest(".page.on .ref"); if(!r || !document.body.classList.contains("hideright")) return;
  clearTimeout(popT); popT=setTimeout(()=>showNotePop(r),120);
});
document.addEventListener("mouseout",e=>{
  const r=e.target.closest(".page.on .ref"); if(!r || !pop.dataset.note) return;
  clearTimeout(popT);
  if(e.relatedTarget && pop.contains(e.relatedTarget)) return;
  setTimeout(()=>{ if(!pop.matches(":hover")) hidePop(); },120);
});

/* ---------- layout: wide examples, diagram fitting, example arrows, sidenotes ---------- */
function relayout(){
  const page=document.querySelector(".page.on"); if(!page) return;
  layoutWide(page); Diagrams.fitDiagrams(page);
  page.querySelectorAll(".ex[data-conns]").forEach(Diagrams.drawConns);
  layoutNotes(page);
}
function layoutWide(page){
  const els=[...page.querySelectorAll("article > .ex, article > .cols, article > .diagram, article > .glossblock")];
  els.forEach(e=>{ e.style.width=""; e.classList.remove("wide"); });
  const margin=page.querySelector(".margin"), note=margin&&margin.querySelector(".note");
  if(!margin || getComputedStyle(margin).display==="none" && !document.body.classList.contains("hideright")) return;
  if(note && getComputedStyle(note).position==="static") return; // single column: wrap normally
  if(matchMedia("(max-width:760px)").matches) return;
  const limit=(document.body.classList.contains("hideright")?$("#pages"):margin).getBoundingClientRect().right;
  els.forEach(e=>{
    const r=e.getBoundingClientRect();
    e.style.width="max-content"; const need=e.getBoundingClientRect().width; e.style.width="";
    if(need>r.width+1){ e.style.width=Math.min(need,limit-r.left)+"px"; e.classList.add("wide"); }
  });
}
function layoutNotes(page){
  const margin=page.querySelector(".margin"); if(!margin) return;
  if(getComputedStyle(margin.querySelector(".note")||margin).position==="static") return;
  const mTop=margin.getBoundingClientRect().top;
  let last=margin.querySelector(".chips").offsetTop+margin.querySelector(".chips").offsetHeight+14;
  const blocks=[...page.querySelectorAll("article .wide")].map(e=>{ const r=e.getBoundingClientRect(); return [r.top-mTop-10, r.bottom-mTop+14]; });
  margin.querySelectorAll(".note:not(.hidden)").forEach(n=>{
    const r=page.querySelector(`.ref[data-r="${n.dataset.n}"]`); if(!r) return;
    const anchor=r.getBoundingClientRect().top-mTop-6;
    let t=Math.max(anchor,last); const h=n.offsetHeight;
    for(let moved=true,i=0;moved&&i<10;i++){ moved=false;
      for(const [a,b] of blocks) if(t<b && t+h>a){ t=(anchor<a && a-h>=last)?a-h:b; moved=true; } }
    n.style.top=t+"px"; last=t+h+16;
  });
  margin.style.minHeight=last+"px";
}
document.addEventListener("click",e=>{
  const c=e.target.closest(".margin .chip"); if(!c) return;
  c.classList.toggle("on");
  const m=c.closest(".margin"), on=c.classList.contains("on");
  m.querySelectorAll(".note."+c.dataset.kind).forEach(n=>n.classList.toggle("hidden",!on));
  document.querySelectorAll(`.page.on .ref${c.dataset.kind==="com"?".com":":not(.com)"}`).forEach(r=>r.style.visibility=on?"":"hidden");
  relayout();
});
function hot(key,on){ document.querySelectorAll(`.page.on [data-n="${key}"], .page.on [data-r="${key}"]`).forEach(x=>x.classList.toggle("hot",on)); }
document.addEventListener("mouseover",e=>{ const el=e.target.closest("[data-r],.note"); if(el) hot(el.dataset.r||el.dataset.n,true); });
document.addEventListener("mouseout",e=>{ const el=e.target.closest("[data-r],.note"); if(el) hot(el.dataset.r||el.dataset.n,false); });
function setHdr(){
  const m=$("header.top").offsetHeight, t=$(".toolbarbar").offsetHeight;
  document.documentElement.style.setProperty("--mast",m+"px");
  document.documentElement.style.setProperty("--hdr",(m+t)+"px");
}
let rz; window.addEventListener("resize",()=>{ setHdr(); clearTimeout(rz); rz=setTimeout(relayout,60); }); setHdr();

/* ---------- hover previews ---------- */
function showPop(a,html,cls){
  pop.className="pop"+(cls?" "+cls:""); pop.innerHTML=html; pop.style.display="block";
  const r=a.getBoundingClientRect();
  let left=Math.min(r.left+window.scrollX, window.scrollX+document.documentElement.clientWidth-pop.offsetWidth-16);
  pop.style.left=Math.max(8,left)+"px"; pop.style.top=(r.bottom+window.scrollY+8)+"px";
  Diagrams.fitDiagrams(pop);
}
function hidePop(){ pop.style.display="none"; pop.className="pop"; delete pop.dataset.note; }
document.addEventListener("mouseover",e=>{
  const a=e.target.closest(".xref,.cite"); if(!a) return;
  clearTimeout(popT); popT=setTimeout(()=>{
    if(a.dataset.ex){
      const ex=document.getElementById(a.dataset.ex); if(!ex) return;
      const host=ex.closest(".ex")||ex; const pg=pageOfEl(a.dataset.ex); const M=META[pg];
      const clone=host.cloneNode(true); clone.removeAttribute("id"); clone.removeAttribute("style"); clone.classList.remove("flash","wide");
      clone.querySelectorAll("[id]").forEach(n=>n.removeAttribute("id")); clone.querySelectorAll(".conn-layer").forEach(n=>n.remove());
      clone.querySelectorAll(".exbody").forEach(n=>n.removeAttribute("style"));
      showPop(a,`<div class="pk">${M?`Chapter ${M.n} · ${M.title}`:"Example"}</div>`+clone.outerHTML, "ex-pop");
    } else if(a.dataset.bib){
      const li=document.getElementById("bib-"+a.dataset.bib); if(!li) return;
      const c=li.cloneNode(true); c.querySelector(".by")?.remove();
      showPop(a,`<div class="pk">Bibliography</div><div>${c.innerHTML}</div>`);
    } else if(a.dataset.go && META[a.dataset.go]){
      const m=META[a.dataset.go]; let sec="";
      if(a.dataset.to){ const h=document.getElementById(a.dataset.to); if(h) sec=` · §${h.querySelector(".num")?.textContent||""}`; }
      showPop(a,`<div class="pk">${m.cat?m.cat+" · ":""}Chapter ${m.n}${sec}</div><div class="pt">${m.title}</div><div>${SYN[a.dataset.go]||"<i>Not yet drafted.</i>"}</div>`);
    }
  },180);
});
document.addEventListener("mouseout",e=>{ if(e.target.closest(".xref,.cite")){ clearTimeout(popT); hidePop(); } });

/* ---------- draw diagrams, then show the page ---------- */
await document.fonts.ready;
Diagrams.renderAll(st.diagrams, pages, m=>st.warnings.push(m));
Code.renderAll(pages);
$("#loading").remove();
routeFromHash(false);
setTimeout(relayout,80);
if(st.warnings.length){
  console.groupCollapsed(`LaTeX: ${st.warnings.length} warning${st.warnings.length>1?"s":""}`);
  [...new Set(st.warnings)].forEach(w=>console.warn(w));
  console.groupEnd();
}
window.AM={st, META, PHEN, bib, go}; // for debugging in the console
})();
