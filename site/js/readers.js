/* readers.js — reader notes in the margin, stored in Supabase (the same approach as Invisible Cities).
 *
 * Select a passage in a chapter, press "Comment", write a note, post it. Notes live in one Supabase table,
 * `notes` (see SUPABASE.md), read and written straight from the page with the project's public key; the
 * table's row-level security only lets that key read approved notes and add new ones. Each note is drawn
 * in the margin beside its passage, under the Comments filter. To hide a note, set its status to 'hidden'
 * in the Supabase table editor.
 *
 * Replies: a reply is a row whose parent_id points at a top-level note; it is drawn inside that note.
 * Deleting: when a note is posted, the browser makes a random delete key, keeps it in localStorage and
 * sends only its SHA-256 hash. The delete_note() database function removes a note when given the key
 * whose hash matches, so readers can delete their own notes (from the browser they posted from) and
 * nobody else's. A note that already has replies is blanked to "deleted" instead, so the replies stay.
 *
 * Until manifest.json has a Supabase URL and key, notes are kept in this browser only (localStorage),
 * so everything can be tried out locally.
 */
(function(){
"use strict";
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
let CFG={}, RELAYOUT=()=>{};
const LOCAL_KEY="am-reader-notes", NAME_KEY="am-reader-name", KEYS_KEY="am-reader-delete-keys";
let NOTES=[], MINE={};   // all loaded notes; delete_hash -> delete key for notes posted from this browser
let THREADS=true;        // false until the database has the parent_id / delete_hash columns (SUPABASE.md)
const remote=()=>!!(CFG.supabaseUrl && CFG.supabaseKey);
const store={ get(k,d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch(_){ return d; } }, set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} } };

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

/* ---------- draw notes ---------- */
const fmtDate=d=>new Date(d).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const bodyHTML=t=>esc(t).split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,"<br>")}</p>`).join("");
const isMine=n=>n.local || !!(n.delete_hash && MINE[n.delete_hash]);
function actions(n, canReply){
  const a=[];
  if(canReply && (THREADS||!remote())) a.push(`<button type="button" class="rc-act rc-replyto" data-id="${esc(n.id)}">reply</button>`);
  if(isMine(n) && !n.deleted) a.push(`<button type="button" class="rc-act rc-del" data-id="${esc(n.id)}">delete</button>`);
  return a.length?`<span class="rc-acts">${a.join("")}</span>`:"";
}
function itemHTML(n){
  if(n.deleted) return `<div class="rc-head"><span class="when">${fmtDate(n.created_at)}</span></div><div class="rc-body rc-gone"><p>This note was deleted.</p></div>`;
  return `<div class="rc-head"><span class="who">${esc(n.name||"anonymous")}</span> <span class="when">${fmtDate(n.created_at)}</span></div>
    <div class="rc-body">${bodyHTML(n.body)}</div>`;
}
function noteHTML(n, id, moved, replies){
  return `<div class="note com reader" data-n="${id}"><span class="k">◆</span><div>
    ${moved?`<blockquote class="rc-moved" title="This passage has since changed">${esc(n.quote)}</blockquote>`:""}
    ${itemHTML(n)}
    ${replies.map(r=>`<div class="rc-reply" data-id="${esc(r.id)}">${itemHTML(r)}${actions(r,false)}</div>`).join("")}
    <span class="tag">reader note${n.local?" · only in this browser":""}</span>${actions(n,true)}</div></div>`;
}
/* take every reader note out of the page again (so the whole set can be redrawn after a change) */
function clear(){
  document.querySelectorAll(".note.reader, .ref.reader").forEach(el=>el.remove());
  const parents=new Set();
  document.querySelectorAll("mark.rq").forEach(m=>{ parents.add(m.parentNode); m.replaceWith(...m.childNodes); });
  parents.forEach(p=>p.normalize());
}
function render(){ clear(); place(NOTES); RELAYOUT(); }
function place(notes){
  const replies={}, top=[];
  notes.forEach(n=>{ if(n.parent_id!=null) (replies[n.parent_id]=replies[n.parent_id]||[]).push(n); else top.push(n); });
  const byPage={};
  top.forEach(n=>{
    // a deleted note stays only while it has replies; replies to a note that isn't shown aren't shown either
    if(n.deleted && !(replies[n.id]||[]).length) return;
    (byPage[n.page]=byPage[n.page]||[]).push(n);
  });
  for(const sec of document.querySelectorAll(".page")){
    const page=sec.dataset.page, list=byPage[page]||[];
    const art=sec.querySelector("article"), margin=sec.querySelector(".margin"); if(!art||!margin) continue;
    for(const n of list){
      const id="rn-"+n.id;
      if(margin.querySelector(`[data-n="${CSS.escape(id)}"]`)) continue;
      const tm=textMap(art), loc=locate(tm,{quote:n.quote, prefix:n.prefix||"", suffix:n.suffix||""});
      const marker=document.createElement("span"); marker.className="ref com reader"; marker.dataset.r=id;
      if(loc){ highlight(tm, loc.start, loc.end, id).after(marker); }
      else { const nav=art.querySelector(".chapnav"); (nav||art.lastChild).before(marker); } // passage changed: note goes at the end
      margin.insertAdjacentHTML("beforeend", noteHTML(n, id, !loc, replies[n.id]||[]));
    }
    // keep margin notes in the order their markers appear in the text (the layout relies on it)
    const pos=el=>art.querySelector(`.ref[data-r="${CSS.escape(el.dataset.n)}"]`);
    const all=[...margin.querySelectorAll(".note")];
    all.sort((a,b)=>{ const ra=pos(a), rb=pos(b); if(!ra||!rb) return 0; return ra.compareDocumentPosition(rb)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1; })
       .forEach(el=>margin.appendChild(el));
    const count=margin.querySelector(".mhead .c"); if(count) count.textContent=all.length;
    const chip=margin.querySelector('.chip[data-kind="com"]');
    if(chip && !chip.classList.contains("on")){ margin.querySelectorAll(".note.reader").forEach(el=>el.classList.add("hidden")); art.querySelectorAll(".ref.reader").forEach(r=>r.style.visibility="hidden"); }
  }
}

/* ---------- Supabase (plain REST: no library needed) ---------- */
function api(path, opts={}){
  return fetch(`${CFG.supabaseUrl.replace(/\/$/,"")}/rest/v1/${path}`, {...opts,
    headers:{apikey:CFG.supabaseKey, Authorization:`Bearer ${CFG.supabaseKey}`, "Content-Type":"application/json", ...(opts.headers||{})}});
}
const COLS="id,created_at,page,quote,prefix,suffix,name,body";
async function load(){
  if(!remote()) return store.get(LOCAL_KEY,[]); // not connected yet: this browser's own notes
  try{
    let r=await api(`notes?select=${COLS},parent_id,delete_hash,deleted&status=eq.approved&order=created_at.asc`);
    if(r.status===400){ // the database hasn't been upgraded for replies and deleting yet (see SUPABASE.md)
      THREADS=false; r=await api(`notes?select=${COLS}&status=eq.approved&order=created_at.asc`);
    }
    if(r.ok) return await r.json();
    console.warn("reader notes: Supabase said", r.status, await r.text());
  } catch(e){ console.warn("reader notes: could not reach Supabase", e); }
  return [];
}
/* a random delete key for a new note, and the SHA-256 hash of it that is stored with the note */
async function newKey(){
  if(!(window.crypto && crypto.subtle)) return null; // e.g. a page opened over plain http: no deleting
  const key=[...crypto.getRandomValues(new Uint8Array(24))].map(b=>b.toString(16).padStart(2,"0")).join("");
  const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))].map(b=>b.toString(16).padStart(2,"0")).join("");
  return {key, hash};
}
async function save(note){
  if(!remote()){ note.id="local-"+Date.now(); note.local=true; const all=store.get(LOCAL_KEY,[]); all.push(note); store.set(LOCAL_KEY,all); return note; }
  const row={page:note.page, quote:note.quote, prefix:note.prefix, suffix:note.suffix, name:note.name, body:note.body};
  const k=THREADS?await newKey():null;
  if(THREADS){ if(note.parent_id!=null) row.parent_id=note.parent_id; if(k) row.delete_hash=k.hash; }
  // return the new row so its id is known; if moderation keeps it hidden, Supabase can't, so fall back
  let r=await api("notes",{method:"POST", headers:{Prefer:"return=representation"}, body:JSON.stringify(row)});
  if(!r.ok && r.status!==400) r=await api("notes",{method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify(row)});
  if(!r.ok) throw new Error((await r.text())||("error "+r.status));
  if(k){ MINE[k.hash]=k.key; store.set(KEYS_KEY, MINE); }
  let saved=null; try{ saved=(await r.json())[0]; }catch(_){}
  if(!saved) return null; // posted, but waiting for approval
  return {...note, ...saved, delete_hash:k?k.hash:""};
}
async function remove(n){
  if(n.local){
    const gone=new Set([n.id, ...(n.parent_id==null?NOTES.filter(x=>x.parent_id===n.id).map(x=>x.id):[])]);
    store.set(LOCAL_KEY, store.get(LOCAL_KEY,[]).filter(x=>!gone.has(x.id)));
    NOTES=NOTES.filter(x=>!gone.has(x.id)); return;
  }
  const r=await api("rpc/delete_note",{method:"POST", body:JSON.stringify({note_id:n.id, delete_key:MINE[n.delete_hash]})});
  if(!r.ok) throw new Error((await r.text())||("error "+r.status));
  const result=await r.json();
  if(result==="blanked"){ Object.assign(n,{deleted:true, body:"", name:""}); }
  else {
    NOTES=NOTES.filter(x=>x!==n);
    // removing the last reply of a deleted note removes that note too (the database does the same)
    const p=NOTES.find(x=>x.id===n.parent_id);
    if(p && p.deleted && !NOTES.some(x=>x.parent_id===p.id)) NOTES=NOTES.filter(x=>x!==p);
  }
  delete MINE[n.delete_hash]; store.set(KEYS_KEY, MINE);
}

/* ---------- a light filter, as on Invisible Cities ---------- */
const BLOCK=["fuck","shit","bitch","cunt","asshole","nigger","nigga","faggot","retard","whore","slut","kike","spic","chink"];
const blocked=t=>{ const s=t.toLowerCase(); return BLOCK.some(w=>new RegExp(`\\b${w}`).test(s)) || (s.match(/https?:\/\//g)||[]).length>2; };

/* ---------- selecting a passage, and the note form ---------- */
let btn, form;
function selectionInfo(){
  const sel=window.getSelection(); if(!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r=sel.getRangeAt(0);
  const el=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement;
  const art=el.closest(".page.on article"); if(!art || !art.closest(".pagegrid")) return null; // chapters only
  const quote=norm(sel.toString()).slice(0,400); if(quote.length<2) return null;
  const tm=textMap(art);
  let start=-1;
  for(let i=0;i<tm.map.length;i++){ const m=tm.map[i]; if(m.node===r.startContainer && m.offset>=r.startOffset){ start=i; break; } }
  if(start<0 || tm.text.slice(start,start+quote.length)!==quote) start=tm.text.indexOf(quote);
  return { page:art.closest(".page").dataset.page, quote,
    prefix:start>0?tm.text.slice(Math.max(0,start-40),start):"", suffix:start>=0?tm.text.slice(start+quote.length,start+quote.length+40):"",
    rect:r.getBoundingClientRect() };
}
function showButton(){
  if(form && !form.hidden) return;
  const info=selectionInfo();
  if(!info){ btn.hidden=true; return; }
  btn.hidden=false; btn._info=info;
  const x=Math.min(info.rect.right+window.scrollX+6, window.scrollX+document.documentElement.clientWidth-btn.offsetWidth-10);
  btn.style.left=Math.max(8,x)+"px"; btn.style.top=(info.rect.top+window.scrollY-btn.offsetHeight-6)+"px";
}
function openForm(info){
  btn.hidden=true; form._info=info; form.hidden=false;
  const q=info.quote.length>140?info.quote.slice(0,137)+"…":info.quote;
  form.querySelector(".rf-quote").textContent=info.parent ? `Replying to ${info.parent.deleted?"a deleted note":(info.parent.name||"anonymous")} on “${q}”` : q;
  form.querySelector(".rf-post").textContent=info.parent?"post reply":"post note";
  form.querySelector(".rf-name").value=store.get(NAME_KEY,"");
  form.querySelector(".rf-body").value="";
  form.querySelector(".rf-msg").textContent=remote()?"":"Comments aren't connected yet, so this note will be saved in your browser only.";
  const w=Math.min(380, document.documentElement.clientWidth-24);
  const left=Math.min(Math.max(12, info.rect.left+window.scrollX), window.scrollX+document.documentElement.clientWidth-w-12);
  form.style.width=w+"px"; form.style.left=left+"px"; form.style.top=(info.rect.bottom+window.scrollY+10)+"px";
  form.querySelector(".rf-body").focus({preventScroll:true});
}
function openReply(parent, at){
  const rect=at.getBoundingClientRect();
  openForm({page:parent.page, quote:parent.quote, prefix:parent.prefix||"", suffix:parent.suffix||"", parent, rect});
}
async function submit(){
  const info=form._info, msg=form.querySelector(".rf-msg"), post=form.querySelector(".rf-post");
  const name=form.querySelector(".rf-name").value.trim().slice(0,60), body=form.querySelector(".rf-body").value.trim().slice(0,2000);
  if(!body){ msg.textContent="Write a note first."; return; }
  if(blocked(body+" "+name)){ msg.textContent="That note can't be posted here."; return; }
  store.set(NAME_KEY, name);
  post.disabled=true; msg.textContent="Posting…";
  try{
    const note=await save({page:info.page, quote:info.quote, prefix:info.prefix, suffix:info.suffix, name, body,
      parent_id:info.parent?info.parent.id:null, created_at:new Date().toISOString()});
    form.hidden=true; window.getSelection().removeAllRanges();
    if(note){ NOTES.push(note); render(); }
    const what=info.parent?"reply":"note";
    toast(!remote()?"Saved in this browser only, since comments aren't connected yet."
      : note?`Your ${what} is posted.` : `Thanks! Your ${what} will appear once it's approved.`);
  } catch(e){ msg.textContent="Couldn't post your note. Please try again in a moment."; console.warn(e); }
  finally{ post.disabled=false; }
}
async function del(n, el){
  const replies=n.parent_id==null && NOTES.some(x=>x.parent_id===n.id);
  if(!confirm(n.parent_id!=null?"Delete your reply?":replies?"Delete your note? The replies to it will stay.":"Delete your note?")) return;
  el.disabled=true;
  try{ await remove(n); render(); toast("Deleted."); }
  catch(e){ el.disabled=false; toast("Couldn't delete that. Please try again in a moment."); console.warn(e); }
}
function toast(text){
  let t=document.querySelector(".rc-toast"); if(!t){ t=document.createElement("div"); t.className="rc-toast"; document.body.appendChild(t); }
  t.textContent=text; t.classList.add("on"); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("on"),5000);
}

async function init(cfg, relayout){
  CFG=cfg||{}; RELAYOUT=relayout||RELAYOUT;
  btn=document.createElement("button"); btn.className="rc-btn"; btn.hidden=true; btn.type="button";
  btn.innerHTML=`<span>◆</span> Comment`;
  btn.addEventListener("mousedown",e=>e.preventDefault()); // keep the selection
  btn.addEventListener("click",()=>{ if(btn._info) openForm(btn._info); });
  form=document.createElement("div"); form.className="rc-form"; form.hidden=true;
  form.innerHTML=`<div class="rf-quote"></div>
    <input class="rf-name" maxlength="60" placeholder="your name (optional)" autocomplete="name">
    <textarea class="rf-body" maxlength="2000" rows="4" placeholder="your note"></textarea>
    <div class="rf-bar"><span class="rf-msg"></span><button type="button" class="rf-cancel">cancel</button><button type="button" class="rf-post">post note</button></div>`;
  form.querySelector(".rf-cancel").onclick=()=>{ form.hidden=true; };
  form.querySelector(".rf-post").onclick=submit;
  form.querySelector(".rf-body").addEventListener("keydown",e=>{ if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)) submit(); if(e.key==="Escape") form.hidden=true; });
  document.body.append(btn, form);
  let t; document.addEventListener("selectionchange",()=>{ clearTimeout(t); t=setTimeout(showButton,180); });
  window.addEventListener("scroll",()=>{ if(!btn.hidden) showButton(); },{passive:true});
  MINE=store.get(KEYS_KEY,{});
  document.addEventListener("click",e=>{
    const b=e.target.closest(".note.reader .rc-act"); if(!b) return;
    e.stopPropagation();
    const n=NOTES.find(x=>String(x.id)===b.dataset.id); if(!n) return;
    if(b.classList.contains("rc-del")) del(n, b); else openReply(n, b);
  });
  NOTES=await load();
  if(NOTES.length){ place(NOTES); RELAYOUT(); }
}
window.Readers={ init };
})();
