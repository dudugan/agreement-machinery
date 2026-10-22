/* readers.js — reader comments, stored as GitHub Discussions.
 *
 * Posting: select a passage in a chapter and press "Comment". That opens a new GitHub Discussion with the
 * passage quoted and a hidden marker recording where it came from; the reader writes their note on GitHub.
 * Showing: when the site is published, a GitHub Action collects those discussions into comments.json.
 * Each one is drawn in the margin beside its passage, as a comment (it shares the Comments filter), with
 * the discussion's replies underneath. Moderate by deleting or hiding comments on GitHub.
 */
(function(){
"use strict";
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
let CFG=null;

/* ---------- article text with whitespace collapsed, mapped back to text nodes ---------- */
const SKIP=".ref, .dg, .conn-layer, .gut, .code-bar, .code-out, .nodeform, .no, .chapnav, .crumb, .meta, .rc-btn";
function textMap(root){
  const walker=document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode:n=>n.parentElement.closest(SKIP)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  let text="", map=[], n, space=true;
  while((n=walker.nextNode())){
    const v=n.nodeValue;
    for(let i=0;i<v.length;i++){
      const ch=v[i];
      if(/\s/.test(ch)){ if(space) continue; text+=" "; map.push({node:n, offset:i}); space=true; }
      else { text+=ch; map.push({node:n, offset:i}); space=false; }
    }
  }
  return {text, map};
}
const norm=s=>s.replace(/\s+/g," ").trim();

/* ---------- find a quoted passage, preferring the occurrence whose surroundings match ---------- */
function locate(tm, c){
  const q=norm(c.quote); if(!q) return null;
  let best=null, bestScore=-1, from=0, i;
  while((i=tm.text.indexOf(q, from))>=0){
    const pre=tm.text.slice(Math.max(0,i-c.prefix.length), i), suf=tm.text.slice(i+q.length, i+q.length+c.suffix.length);
    const score=common(pre, norm(c.prefix), true)+common(suf, norm(c.suffix), false);
    if(score>bestScore){ best=i; bestScore=score; }
    from=i+1;
  }
  return best===null ? null : {start:best, end:best+q.length};
}
function common(a,b,fromEnd){ let k=0; while(k<a.length && k<b.length && (fromEnd?a[a.length-1-k]===b[b.length-1-k]:a[k]===b[k])) k++; return k; }

/* ---------- highlight [start,end) of the mapped text; returns the last <mark> ---------- */
function highlight(tm, start, end, id){
  const byNode=new Map();
  for(let i=start;i<end;i++){ const {node,offset}=tm.map[i]; const r=byNode.get(node)||{a:offset,b:offset}; r.a=Math.min(r.a,offset); r.b=Math.max(r.b,offset); byNode.set(node,r); }
  let last=null;
  for(const [node,{a,b}] of byNode){
    const mid=node.splitText(a); mid.splitText(b-a+1);
    const mark=document.createElement("mark"); mark.className="rq"; mark.dataset.r=id;
    mid.parentNode.insertBefore(mark, mid); mark.appendChild(mid); last=mark;
  }
  return last;
}

/* ---------- draw the comments ---------- */
const fmtDate=d=>new Date(d).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
function person(p){ return `<a class="who" href="${esc(p.url)}" target="_blank" rel="noopener">${p.avatar?`<img class="av" src="${esc(p.avatar)}&s=40" alt="" loading="lazy">`:""}${esc(p.login)}</a>`; }
function noteHTML(c, id, moved){
  const replies=c.replies.map(r=>`<div class="rc-reply">${person(r.author)} <span class="when">${fmtDate(r.date)}</span><div class="rc-body">${r.html}</div></div>`).join("");
  return `<div class="note com reader" data-n="${id}"><span class="k">◆</span><div>
    <div class="rc-head">${person(c.author)} <span class="when">${fmtDate(c.date)}</span></div>
    ${moved?`<blockquote class="rc-moved" title="This passage has since changed">${esc(c.quote)}</blockquote>`:""}
    <div class="rc-body">${c.html}</div>${replies}
    <a class="rc-gh" href="${esc(c.url)}" target="_blank" rel="noopener">reply on GitHub ↗</a>
    <br><span class="tag">reader comment</span></div></div>`;
}
function place(comments){
  const byPage={};
  comments.forEach(c=>(byPage[c.page]=byPage[c.page]||[]).push(c));
  for(const [page, list] of Object.entries(byPage)){
    const sec=document.querySelector(`.page[data-page="${CSS.escape(page)}"]`); if(!sec) continue;
    const art=sec.querySelector("article"), margin=sec.querySelector(".margin"); if(!art||!margin) continue;
    for(const c of list){
      const id="rc-"+c.number;
      if(margin.querySelector(`[data-n="${id}"]`)) continue;
      const tm=textMap(art), loc=locate(tm,c);
      const marker=document.createElement("span"); marker.className="ref com reader"; marker.dataset.r=id;
      if(loc){ const last=highlight(tm, loc.start, loc.end, id); last.after(marker); }
      else { const nav=art.querySelector(".chapnav"); (nav?nav:art.lastChild).before(marker); } // passage changed: note goes at the end
      margin.insertAdjacentHTML("beforeend", noteHTML(c, id, !loc));
    }
    // keep margin notes in the order their markers appear in the text (the layout relies on it)
    const notes=[...margin.querySelectorAll(".note")];
    const pos=n=>art.querySelector(`.ref[data-r="${CSS.escape(n.dataset.n)}"]`);
    notes.sort((a,b)=>{ const ra=pos(a), rb=pos(b); if(!ra||!rb) return 0; return ra.compareDocumentPosition(rb)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1; })
      .forEach(n=>margin.appendChild(n));
    const count=margin.querySelector(".mhead .c"); if(count) count.textContent=notes.length;
    // a comment added while the Comments filter is off stays hidden
    const chip=margin.querySelector('.chip[data-kind="com"]');
    if(chip && !chip.classList.contains("on")){ margin.querySelectorAll(".note.reader").forEach(n=>n.classList.add("hidden")); art.querySelectorAll(".ref.reader").forEach(r=>r.style.visibility="hidden"); }
  }
}

/* ---------- the Comment button for a selected passage ---------- */
let btn;
function selectionInfo(){
  const sel=window.getSelection(); if(!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r=sel.getRangeAt(0);
  const art=(r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement).closest(".page.on article");
  if(!art || !art.closest(".pagegrid")) return null; // chapters only
  const quote=norm(sel.toString()); if(quote.length<2) return null;
  const tm=textMap(art);
  // where does the selection start in the mapped text?
  let start=-1;
  for(let i=0;i<tm.map.length;i++){ const m=tm.map[i]; if(m.node===r.startContainer && m.offset>=r.startOffset){ start=i; break; }
    if(r.startContainer.nodeType===1 && r.intersectsNode(m.node)){ start=i; break; } }
  if(start<0 || tm.text.slice(start, start+quote.length)!==quote) start=tm.text.indexOf(quote);
  const q=quote.slice(0,400);
  return { page:art.closest(".page").dataset.page, quote:q,
    prefix: start>0?tm.text.slice(Math.max(0,start-40), start):"", suffix: start>=0?tm.text.slice(start+q.length, start+q.length+40):"",
    rect:r.getBoundingClientRect() };
}
function showButton(){
  const info=selectionInfo();
  if(!info){ btn.hidden=true; return; }
  btn.hidden=false; btn._info=info;
  const x=Math.min(info.rect.right+window.scrollX+6, window.scrollX+document.documentElement.clientWidth-btn.offsetWidth-10);
  btn.style.left=Math.max(8,x)+"px"; btn.style.top=(info.rect.top+window.scrollY-btn.offsetHeight-6)+"px";
}
function openGitHub(info){
  const title=document.querySelector(`.page[data-page="${CSS.escape(info.page)}"] h1.title`)?.textContent?.trim()||info.page;
  const marker=JSON.stringify({page:info.page, quote:info.quote, prefix:info.prefix, suffix:info.suffix}).replace(/--/g,"-\\u002d"); // "--" would end the HTML comment; \u002d decodes back to "-"
  const body=`> ${info.quote.replace(/\n/g,"\n> ")}\n\n\n\n<!-- agreement-machinery: ${marker} -->`;
  const short=info.quote.length>60?info.quote.slice(0,57)+"…":info.quote;
  const params=new URLSearchParams({category:CFG.category||"general", title:`${title}: “${short}”`, body});
  window.open(`https://github.com/${CFG.repo}/discussions/new?${params}`, "_blank", "noopener");
  toast("GitHub opened in a new tab: sign in, write your comment under the quoted passage, and press Start discussion. It appears here in a minute or two.");
}
function toast(msg){
  let t=document.querySelector(".rc-toast"); if(!t){ t=document.createElement("div"); t.className="rc-toast"; document.body.appendChild(t); }
  t.textContent=msg; t.classList.add("on"); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("on"),7000);
}

async function init(cfg, relayout){
  CFG=cfg; if(!CFG || !CFG.repo) return;
  btn=document.createElement("button"); btn.className="rc-btn"; btn.hidden=true; btn.type="button";
  btn.innerHTML=`<span>◆</span> Comment`;
  btn.addEventListener("mousedown",e=>e.preventDefault()); // keep the selection
  btn.addEventListener("click",()=>{ if(btn._info) openGitHub(btn._info); btn.hidden=true; });
  document.body.appendChild(btn);
  let t; document.addEventListener("selectionchange",()=>{ clearTimeout(t); t=setTimeout(showButton,180); });
  window.addEventListener("scroll",()=>{ if(!btn.hidden) showButton(); },{passive:true});
  try{
    const r=await fetch("comments.json",{cache:"no-cache"});
    if(!r.ok) return; // previewing locally, or no comments yet
    const list=await r.json();
    if(Array.isArray(list) && list.length){ place(list); relayout(); }
  } catch(_){ /* no comments file: nothing to show */ }
}
window.Readers={ init, _place:place };
})();
