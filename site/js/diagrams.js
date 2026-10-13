/* diagrams.js — draws the diagrams parsed by latex.js.
 *
 * Every diagram is HTML labels laid over an SVG of lines, so node labels can hold any inline LaTeX
 * (small caps, subscripts, roots, line breaks). Label sizes are measured in an off-screen box, so
 * diagrams on hidden pages are drawn correctly too.
 *
 *   forest      trees in the sketch's style; "\\" in a label stacks a realization under its node
 *   tikz        nodes, -- / to[out,in,bend,looseness] / edge / rectangle / circle, ++ and + offsets,
 *               node anchors and [xshift,yshift] coordinates, scopes with shift, arrows, dashed,
 *               colours, line widths, hatching (pattern=north east lines), labels on paths
 *   headchain   \headchain{…} head-chain diagrams (see latex.js for the notation)
 *   pstricks    \rnode + \ncbar / \ncline / \nccurve arrows drawn over an example
 */
(function(){
"use strict";
const {toPx}=window.LaTeX;
const INK="#2B2620", NAVY="#1E5458", MUTED="#8A7F6E";
const COLORS={black:INK, gray:MUTED, grey:MUTED, darkgray:"#5f574b", lightgray:"#B4A88F", blue:NAVY, navy:NAVY, teal:NAVY, red:"#8b3a2b",
  green:"#3c5a3e", brown:"#6E5134", white:"#FAF6EC", orange:"#a5642b", purple:"#5a3d5c", none:"none"};
const color = v => { if(!v || v===true) return INK; const base=String(v).split("!")[0].trim(); return COLORS[base] || base; };
let UID=0;

/* ---------- measuring ---------- */
let meas;
function measure(html, cls){
  if(!meas){ meas=document.createElement("div"); meas.className="dg-measure"; document.body.appendChild(meas); }
  const d=document.createElement("div"); d.className=cls||"dg-l"; d.innerHTML=html||"&#8203;";
  meas.appendChild(d); const r={w:d.offsetWidth, h:d.offsetHeight}; meas.removeChild(d);
  if(!html) r.w=0;
  return r;
}

/* ---------- a scene: labels + svg paths, cropped to content ---------- */
class Scene {
  constructor(){ this.labels=[]; this.paths=[]; this.minx=Infinity; this.miny=Infinity; this.maxx=-Infinity; this.maxy=-Infinity; this.uid=++UID; this.hatch=false; }
  pt(x,y){ if(!isFinite(x)||!isFinite(y)) return; this.minx=Math.min(this.minx,x); this.maxx=Math.max(this.maxx,x); this.miny=Math.min(this.miny,y); this.maxy=Math.max(this.maxy,y); }
  label(html, cx, cy, w, h, cls, extra=""){ this.labels.push({html,x:cx-w/2,y:cy-h/2,w,h,cls,extra}); this.pt(cx-w/2,cy-h/2); this.pt(cx+w/2,cy+h/2); }
  path(d, style, pts){ this.paths.push({d,style}); (pts||[]).forEach(p=>this.pt(p[0],p[1])); }
  render(el, pad=14){
    if(!isFinite(this.minx)){ this.minx=this.miny=0; this.maxx=this.maxy=10; }
    const ox=-this.minx+pad, oy=-this.miny+pad;
    const W=Math.ceil(this.maxx-this.minx+pad*2), H=Math.ceil(this.maxy-this.miny+pad*2);
    const svgPaths=this.paths.map(p=>pathSVG(p, this.uid)).join("");
    const defs=`<defs><marker id="ah-${this.uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.8 L10,5 L0,9.2 L2.6,5 z" fill="context-stroke"/></marker>`+
      (this.hatch?`<pattern id="hatch-${this.uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${INK}" stroke-width="1"/></pattern><pattern id="hatchw-${this.uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${INK}" stroke-width="1"/></pattern>`:"")+`</defs>`;
    const labels=this.labels.map(l=>{ const more=(l.extra.match(/style="([^"]*)"/)||[])[1]||""; return `<div class="${l.cls||"dg-l"}" style="left:${(l.x+ox).toFixed(1)}px;top:${(l.y+oy).toFixed(1)}px;${more}">${l.html}</div>`; }).join("");
    el.innerHTML=`<div class="dg-fit"><div class="dg" style="width:${W}px;height:${H}px" data-w="${W}" data-h="${H}"><svg width="${W}" height="${H}" viewBox="${-ox} ${-oy} ${W} ${H}">${defs}${svgPaths}</svg>${labels}</div></div>`;
    return {W,H};
  }
}
function pathSVG(p, uid){
  const s=p.style||{};
  const a=[`d="${p.d}"`];
  a.push(`fill="${s.pattern?`url(#${s.pattern==="nw"?"hatchw":"hatch"}-${uid})`:(s.fill||"none")}"`);
  a.push(`stroke="${s.stroke||INK}"`, `stroke-width="${s.w||1}"`);
  if(s.dash) a.push(`stroke-dasharray="${s.dash}"`);
  if(s.cap) a.push(`stroke-linecap="${s.cap}"`);
  if(s.opacity!=null) a.push(`opacity="${s.opacity}"`);
  if(s.end) a.push(`marker-end="url(#ah-${uid})"`);
  if(s.start) a.push(`marker-start="url(#ah-${uid})"`);
  a.push(`stroke-linejoin="round"`);
  return `<path ${a.join(" ")}/>`;
}

/* ---------- tikz styles ---------- */
const WIDTHS={"ultra thin":.5,"very thin":.7,thin:1,semithick:1.25,thick:1.5,"very thick":2,"ultra thick":2.6};
const ARROW=/^((?:[<>|]|\{?(?:Stealth|stealth|Latex|latex|Triangle|To|Straight Barb|Classical TikZ Rightarrow)(?:\[[^\]]*\])?\}?)*)-((?:[<>|]|\{?(?:Stealth|stealth|Latex|latex|Triangle|To|Straight Barb|Classical TikZ Rightarrow)(?:\[[^\]]*\])?\}?)*)$/;
function styleFrom(opts, env, cmd){
  const st={stroke:INK, w:1, fill:"none"};
  if(cmd==="fill"){ st.fill=INK; st.stroke="none"; }
  if(cmd==="filldraw"){ st.fill=INK; }
  if(cmd==="path"){ st.stroke="none"; }
  const apply=(o)=>{
    for(const [k,v] of Object.entries(o)){
      if(env.styles && env.styles[k] && v===true){ apply(env.styles[k]); continue; }
      const am=k.match(ARROW);
      if(v===true && am && k.includes("-")){ st.start=!!am[1] && !/^\|+$/.test(am[1]); st.end=!!am[2] && !/^\|+$/.test(am[2]); continue; }
      if(v===true){
        if(WIDTHS[k]!==undefined){ st.w=WIDTHS[k]; continue; }
        if(k==="dashed"){ st.dash="5 3"; continue; } if(k==="densely dashed"){ st.dash="3 2"; continue; } if(k==="loosely dashed"){ st.dash="7 5"; continue; }
        if(k==="dotted"||k==="densely dotted"||k==="loosely dotted"){ st.dash=k==="densely dotted"?"0.1 2.5":k==="loosely dotted"?"0.1 6":"0.1 4"; st.cap="round"; continue; }
        if(k==="solid"){ st.dash=null; continue; }
        if(k==="draw"){ if(st.stroke==="none") st.stroke=INK; continue; }
        if(COLORS[k.split("!")[0]]){ st.stroke=color(k); continue; }
        continue;
      }
      if(k==="line width"){ st.w=Math.max(.5,toPx(v,"pt")*1.3); continue; }
      if(k==="draw"){ st.stroke=v==="none"?"none":color(v); continue; }
      if(k==="color"){ st.stroke=color(v); continue; }
      if(k==="fill"){ st.fill=v==="none"?"none":color(v); continue; }
      if(k==="pattern"){ st.pattern=/north west/.test(v)?"nw":"ne"; env.scene.hatch=true; continue; }
      if(k==="opacity"||k==="draw opacity"){ st.opacity=+v; continue; }
      if(k==="dash pattern"){ const nums=String(v).match(/[\d.]+\s*[a-z]*/g)||[]; st.dash=nums.map(x=>toPx(x,"pt").toFixed(1)).join(" "); continue; }
    }
  };
  if(env.base) apply(env.base);
  apply(opts||{});
  return st;
}

/* ---------- geometry helpers ---------- */
const ANG={east:0,"north east":45,north:90,"north west":135,west:180,"south west":225,south:270,"south east":315,right:0,left:180,above:90,below:270};
const angOf = v => v==null ? null : (ANG[String(v).trim()]!==undefined ? ANG[String(v).trim()] : parseFloat(v));
const dirOf = a => [Math.cos(a*Math.PI/180), -Math.sin(a*Math.PI/180)];
const angleTo = (p,q) => Math.atan2(-(q[1]-p[1]), q[0]-p[0])*180/Math.PI;
function border(N, a){
  const [dx,dy]=dirOf(a);
  if(N.shape==="circle") return [N.cx+dx*N.r, N.cy+dy*N.r];
  if(N.shape==="point") return [N.cx,N.cy];
  const t=Math.min(Math.abs(dx)>1e-9?N.hw/Math.abs(dx):Infinity, Math.abs(dy)>1e-9?N.hh/Math.abs(dy):Infinity);
  return [N.cx+dx*t, N.cy+dy*t];
}
function anchorPt(N, anchor){
  const a=String(anchor).trim();
  if(a==="center"||a==="text") return [N.cx,N.cy];
  if(a==="base"||a==="mid") return [N.cx, N.cy+(N.shape==="rect"?N.hh*0.35:0)];
  if(N.shape==="circle"){ if(ANG[a]!==undefined) return border(N,ANG[a]); }
  const sx={east:1,west:-1}[a.split(" ").pop()]??0, sy={north:-1,south:1}[a.split(" ")[0]]??0;
  if(ANG[a]!==undefined) return [N.cx+sx*N.hw, N.cy+sy*N.hh];
  if(/^-?\d/.test(a)) return border(N, parseFloat(a));
  return [N.cx,N.cy];
}

/* ---------- running tikz commands into a scene ---------- */
function runTikz(ops, env){
  for(const op of ops){
    if(op.op==="scope"){
      const sh=shiftOf(op.opts);
      const base={...(env.base||{})}; for(const [k,v] of Object.entries(op.opts)) if(!/shift/.test(k)) base[k]=v;
      runTikz(op.ops, {...env, ox:env.ox+sh[0], oy:env.oy+sh[1], base});
      continue;
    }
    if(op.op==="node") placeNode(op, env);
    else if(op.op==="path") drawPath(op, env);
  }
}
function shiftOf(o){
  let x=0,y=0;
  if(o.shift){ const m=String(o.shift).replace(/^\{|\}$/g,"").match(/^\((.*)\)$/); if(m){ const [a,b]=m[1].split(","); x+=toPx(a); y-=toPx(b); } }
  if(o.xshift) x+=toPx(o.xshift,"pt"); if(o.yshift) y-=toPx(o.yshift,"pt");
  return [x,y];
}
function xyPt(c, env){ return [env.ox+c.x+(c.shift?c.shift.x:0), env.oy-c.y-(c.shift?c.shift.y:0)]; }
function placeNode(op, env){
  const S=env.scene;
  const p = op.at ? specCenter(op.at, env) : [env.ox, env.oy];
  const o=op.opts||{};
  const shape=o.circle?"circle":(op.coordinate?"point":"rect");
  const inner = o["inner sep"]!==undefined ? toPx(o["inner sep"],"pt") : 5.5;
  const m=measure(op.html, "dg-l");
  let N;
  if(shape==="circle"){ const r=Math.max(Math.hypot(m.w,m.h*0.8)/2+inner*0.55, o["minimum size"]?toPx(o["minimum size"],"pt")/2:0); N={cx:p[0],cy:p[1],r,hw:r,hh:r,shape}; }
  else if(shape==="point") N={cx:p[0],cy:p[1],hw:0,hh:0,shape};
  else N={cx:p[0],cy:p[1],hw:m.w/2+inner,hh:m.h/2+inner*0.6,shape};
  // anchor=… moves the node so that anchor sits at the point; above/below/left/right shift it
  if(o.anchor){ const a=anchorPt(N,o.anchor); N.cx+=N.cx-a[0]; N.cy+=N.cy-a[1]; }
  for(const k of ["above","below","left","right","above left","above right","below left","below right"]) if(o[k]!==undefined){
    const dist=o[k]===true?3:toPx(o[k],"pt"); const sy=k.includes("above")?-1:k.includes("below")?1:0, sx=k.includes("left")?-1:k.includes("right")?1:0;
    N.cx+=sx*(N.hw+dist); N.cy+=sy*(N.hh+dist); }
  if(op.name) env.nodes[op.name]=N;
  if(shape==="point") return;
  const st=styleFrom(o, env, "node");
  if(o.draw || o.fill){
    const sst={...st, stroke:o.draw?(o.draw===true?INK:color(o.draw)):"none", fill:o.fill?color(o.fill):"none"};
    if(shape==="circle") S.path(circleD(N.cx,N.cy,N.r), sst, [[N.cx-N.r,N.cy-N.r],[N.cx+N.r,N.cy+N.r]]);
    else S.path(`M${N.cx-N.hw},${N.cy-N.hh} H${N.cx+N.hw} V${N.cy+N.hh} H${N.cx-N.hw} Z`, sst, [[N.cx-N.hw,N.cy-N.hh],[N.cx+N.hw,N.cy+N.hh]]);
  }
  const tc=o.text||o.color; const extra=tc?` style="color:${color(tc)}"`:"";
  if(op.html) S.label(op.html, N.cx, N.cy, m.w, m.h, "dg-l"+(o.font&&/small/.test(o.font)?" small":""), extra);
  else S.pt(N.cx,N.cy);
}
const circleD=(cx,cy,r)=>`M${cx-r},${cy} a${r},${r} 0 1,0 ${2*r},0 a${r},${r} 0 1,0 ${-2*r},0`;

function specCenter(c, env){
  if(c.kind==="xy") return xyPt(c, env);
  const N=env.nodes[c.name];
  if(!N){ return [env.ox, env.oy]; }
  const p = c.anchor ? anchorPt(N,c.anchor) : [N.cx,N.cy];
  return [p[0]+(c.shift?c.shift.x:0), p[1]-(c.shift?c.shift.y:0)];
}
// resolve a coordinate spec to a point; nodes without an explicit anchor meet the path at their border
function specPt(c, env, toward, angle){
  if(c.kind==="xy") return xyPt(c, env);
  const N=env.nodes[c.name];
  if(!N){ env.warn && env.warn(`tikz: unknown node "${c.name}"`); return [env.ox, env.oy]; }
  let p;
  if(c.anchor) p=anchorPt(N,c.anchor);
  else if(angle!=null) p=border(N,angle);
  else if(toward) p=border(N, angleTo([N.cx,N.cy],toward));
  else p=[N.cx,N.cy];
  return [p[0]+(c.shift?c.shift.x:0), p[1]-(c.shift?c.shift.y:0)];
}

function drawPath(op, env){
  const S=env.scene; const style=styleFrom(op.opts, env, op.cmd);
  let d="", cur=null, curSpec=null, first=null, pending=null, lastDrawn=null;
  const extra=[]; // separate sub-paths (edges, circles)
  const pts=[];
  const labelsOnSeg=[];
  const absSpec=(it)=>{ // turn a relative coordinate into an absolute xy spec
    if(!it.rel) return it.c;
    const base=cur||[env.ox,env.oy];
    return {kind:"xy", x:base[0]-env.ox+it.c.x, y:-(base[1]-env.oy)+it.c.y, shift:it.c.shift};
  };
  const moveTo=p=>{ if(!lastDrawn || Math.abs(lastDrawn[0]-p[0])>.01 || Math.abs(lastDrawn[1]-p[1])>.01) d+=`M${p[0].toFixed(1)},${p[1].toFixed(1)} `; };
  for(const it of op.items){
    if(it.t==="coord"){
      const spec=absSpec(it);
      if(pending){
        const fromSpec=curSpec, from=cur;
        const toC=specCenter(spec,env), fromC=fromSpec?specCenter(fromSpec,env):from;
        const P=pending; pending=null;
        if(P.t==="rect"){
          const e=specPt(spec,env); d+=`M${from[0]},${from[1]} H${e[0]} V${e[1]} H${from[0]} Z `; pts.push(from,e); lastDrawn=null;
          cur=e; curSpec=spec; continue;
        }
        let s, e, geom, seg;
        const o=P.opts||{};
        let out=angOf(o.out), inn=angOf(o.in);
        const bend = o["bend left"]!==undefined ? +(o["bend left"]===true?30:o["bend left"]) : o["bend right"]!==undefined ? -(o["bend right"]===true?30:o["bend right"]) : null;
        if((P.t==="to"||P.t==="edge") && (out!=null || inn!=null || bend!=null)){
          if(bend!=null){ const th=angleTo(fromC,toC); out=th+bend; inn=th+180-bend; }
          if(out==null) out=angleTo(fromC,toC); if(inn==null) inn=angleTo(toC,fromC);
          s=fromSpec?specPt(fromSpec,env,null,out):from; e=specPt(spec,env,null,inn);
          const dist=Math.hypot(e[0]-s[0],e[1]-s[1]); const L=0.3915*dist*(o.looseness!==undefined?+o.looseness:1);
          const od=dirOf(out), id=dirOf(inn);
          const c1=[s[0]+od[0]*(o["out looseness"]?L*+o["out looseness"]:L), s[1]+od[1]*L], c2=[e[0]+id[0]*L, e[1]+id[1]*L];
          if(o["out min distance"]){ const md=toPx(o["out min distance"],"pt"); if(L<md){ c1[0]=s[0]+od[0]*md; c1[1]=s[1]+od[1]*md; } }
          seg=`C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${e[0].toFixed(1)},${e[1].toFixed(1)}`;
          geom=t=>{ const u=1-t; return [u*u*u*s[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*e[0], u*u*u*s[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*e[1]]; };
          for(let k=0;k<=16;k++) pts.push(geom(k/16)); // sample the curve so the diagram is never cropped
        } else if(P.t==="hv"||P.t==="vh"){
          s=fromSpec?specPt(fromSpec,env,toC):from; e=specPt(spec,env,fromC);
          const k=P.t==="hv"?[e[0],s[1]]:[s[0],e[1]];
          s=fromSpec?specPt(fromSpec,env,k):from; e=specPt(spec,env,k);
          const k2=P.t==="hv"?[e[0],s[1]]:[s[0],e[1]];
          seg=`L${k2[0].toFixed(1)},${k2[1].toFixed(1)} L${e[0].toFixed(1)},${e[1].toFixed(1)}`;
          geom=t=>t<.5?[s[0]+(k2[0]-s[0])*t*2, s[1]+(k2[1]-s[1])*t*2]:[k2[0]+(e[0]-k2[0])*(t-.5)*2, k2[1]+(e[1]-k2[1])*(t-.5)*2];
          pts.push(s,k2,e);
        } else {
          s=fromSpec?specPt(fromSpec,env,toC):from; e=specPt(spec,env,fromC);
          seg=`L${e[0].toFixed(1)},${e[1].toFixed(1)}`;
          geom=t=>[s[0]+(e[0]-s[0])*t, s[1]+(e[1]-s[1])*t];
          pts.push(s,e);
        }
        if(P.t==="edge"){
          extra.push({d:`M${s[0].toFixed(1)},${s[1].toFixed(1)} ${seg}`, style:styleFrom({...op.opts,...(P.opts||{})},env,op.cmd)});
        } else {
          moveTo(s); d+=seg+" "; lastDrawn=e;
          cur = it.rel==="+" ? from : e; curSpec = it.rel==="+" ? fromSpec : (spec.kind==="xy"?{kind:"xy",x:e[0]-env.ox,y:-(e[1]-env.oy)}:spec);
          if(!first) first=s;
        }
        P.nodes.forEach(nd=>labelsOnSeg.push([nd,geom]));
      } else {
        const p=specPt(spec,env);
        cur=p; curSpec=spec.kind==="xy"?{kind:"xy",x:p[0]-env.ox,y:-(p[1]-env.oy)}:spec;
        if(!first) first=p;
        pts.push(p);
      }
      continue;
    }
    if(it.t==="line"||it.t==="to"||it.t==="edge"||it.t==="hv"||it.t==="vh"||it.t==="rect"){ pending={t:it.t, opts:it.opts, nodes:[]}; continue; }
    if(it.t==="node"){ if(pending) pending.nodes.push(it); else if(cur) labelsOnSeg.push([it, ()=>cur]); continue; }
    if(it.t==="circle"){ if(cur){ const r=toPx(it.r); extra.push({d:circleD(cur[0],cur[1],r), style}); pts.push([cur[0]-r,cur[1]-r],[cur[0]+r,cur[1]+r]); } continue; }
    if(it.t==="cycle"){ d+="Z "; lastDrawn=first; continue; }
  }
  if(d.trim()) S.path(d.trim(), style, pts);
  extra.forEach(x=>S.path(x.d, x.style, pts));
  labelsOnSeg.forEach(([nd,geom])=>{
    const o=nd.opts||{};
    const t=o.pos!==undefined?+o.pos:(o["near start"]?.25:o["near end"]?.75:o["at start"]?0:o["at end"]?1:.5);
    const P=geom(t);
    placeNode({op:"node", name:nd.name, html:nd.html, at:null, opts:o}, {...env, ox:P[0], oy:P[1]});
  });
}

/* =====================================================================================
 *  forest
 * ===================================================================================== */
function renderForest(spec, el, warn){
  const S=new Scene();
  const ssep=Math.max(10, spec.opts.ssep ?? 22), lsep=Math.max(22, spec.opts.lsep ?? 34);
  const all=[];
  (function walk(n){ all.push(n); const m=measure(n.html,"dg-l"); n.w=Math.max(m.w, n.html?4:2); n.h=n.html?m.h:4; n.kids.forEach(walk); })(spec.root);
  (function size(n){ n.kids.forEach(size); const kw=n.kids.reduce((a,k)=>a+k.sw,0)+ssep*Math.max(0,n.kids.length-1); n.sw=Math.max(n.w,kw); n.kw=kw; })(spec.root);
  (function place(n,x,y){ n.y=y;
    if(n.kids.length){ let cx=x+(n.sw-n.kw)/2; n.kids.forEach(k=>{ place(k,cx,y+n.h+lsep); cx+=k.sw+ssep; }); n.x=(n.kids[0].x+n.kids[n.kids.length-1].x)/2; }
    else n.x=x+n.sw/2; })(spec.root,0,0);
  const nodes={};
  for(const n of all){
    for(const k of n.kids){
      if(k.edgeNone) continue;
      if(k.roof) S.path(`M${n.x},${n.y+n.h+1} L${k.x-k.w/2-2},${k.y-1} L${k.x+k.w/2+2},${k.y-1} Z`, {stroke:"#6E6353", w:1}, []);
      else S.path(`M${n.x},${n.y+n.h+1} L${k.x},${k.y-1}`, {stroke:"#6E6353", w:1}, []);
    }
    if(n.draw) S.path(`M${n.x-n.w/2-5},${n.y-3} H${n.x+n.w/2+5} V${n.y+n.h+3} H${n.x-n.w/2-5} Z`, {stroke:INK, w:1}, [[n.x-n.w/2-5,n.y-3],[n.x+n.w/2+5,n.y+n.h+3]]);
    if(n.html) S.label(n.html, n.x, n.y+n.h/2, n.w, n.h, "dg-l");
    else S.pt(n.x, n.y);
    if(n.name) nodes[n.name]={cx:n.x, cy:n.y+n.h/2, hw:n.w/2+(n.draw?5:2), hh:n.h/2+(n.draw?3:1), shape:"rect"};
  }
  const r=spec.root;
  runTikz(spec.ops, {scene:S, nodes, ox:r.x, oy:r.y+r.h*0.7, styles:{}, base:{}, warn});
  return S.render(el);
}

/* =====================================================================================
 *  tikzpicture
 * ===================================================================================== */
function renderTikz(spec, el, warn){
  const S=new Scene();
  const styles={}, base={};
  for(const [k,v] of Object.entries(spec.opts||{})){
    const m=k.match(/^(.+)\/\.style$/);
    if(m){ styles[m[1].trim()]=parseKVlite(v); continue; }
    if(k===">"||k==="scale"||k==="baseline"||k==="every node/.style") continue;
    base[k]=v;
  }
  const sc = spec.opts && spec.opts.scale ? +spec.opts.scale : 1;
  runTikz(spec.ops, {scene:S, nodes:{}, ox:0, oy:0, styles, base, warn, scale:sc});
  return S.render(el, 4);
}
function parseKVlite(s){ const o={}; String(s).split(",").forEach(p=>{ p=p.trim(); if(!p) return; const k=p.indexOf("="); if(k<0) o[p]=true; else o[p.slice(0,k).trim()]=p.slice(k+1).trim().replace(/^\{|\}$/g,""); }); return o; }

/* =====================================================================================
 *  \headchain
 * ===================================================================================== */
function renderHeadchain(spec, el){
  const S=new Scene();
  const heads=spec.seq.filter(x=>x.t==="head");
  heads.forEach(h=>{ const m=measure(h.html,"dg-l"); h.w=m.w; h.h=m.h; });
  const hh=Math.max(20,...heads.map(h=>h.h));
  let x=0;
  heads.forEach((h,k)=>{ if(k) x+=Math.max(46,(heads[k-1].w+h.w)/2+18); h.x=x; S.label(h.html, h.x, hh/2, h.w, h.h, "dg-l"); });
  const bottom=hh+2, meet=bottom+8, wordsY=meet+8;
  const chains={};
  spec.seq.forEach(s=>{ if(s.t==="head" && s.chain!=null) (chains[s.chain]=chains[s.chain]||[]).push(s); });
  const meetX={};
  for(const [c,members] of Object.entries(chains)){
    const stars=members.filter(m=>m.star); const ref=stars.length?stars:[members[0]];
    const mx=ref.reduce((a,m)=>a+m.x,0)/ref.length; meetX[c]=mx;
    members.forEach(m=>S.path(`M${m.x},${bottom} L${mx},${meet}`, {stroke:INK, w:1.5, cap:"round"}, [[m.x,bottom],[mx,meet]]));
    if(members.length===1) S.path(`M${mx},${bottom} L${mx},${meet}`, {stroke:INK, w:1.5, cap:"round"}, []);
  }
  // bottom line of words
  let prevRight=null, lastHeadX=heads.length?heads[0].x:0;
  spec.seq.forEach(s=>{
    if(s.t==="head"){ lastHeadX=s.x; return; }
    if(!s.html) return;
    const cls = s.t==="chainword" ? "dg-l hc-word strong" : "dg-l hc-word";
    const m=measure(s.html, cls);
    let cx = s.t==="chainword" ? meetX[s.chain] : (prevRight==null ? lastHeadX : prevRight+7+m.w/2);
    if(prevRight!=null) cx=Math.max(cx, prevRight+7+m.w/2);
    S.label(s.html, cx, wordsY+m.h/2, m.w, m.h, cls);
    prevRight=cx+m.w/2;
  });
  return S.render(el, 4);
}

/* =====================================================================================
 *  pstricks connections over an example
 * ===================================================================================== */
function drawConns(ex){
  const conns=JSON.parse(ex.dataset.conns||"[]"); if(!conns.length) return;
  const body=ex.querySelector(".exbody");
  body.querySelectorAll(".conn-layer").forEach(n=>n.remove());
  body.style.paddingBottom=""; body.style.paddingTop="";
  const B=body.getBoundingClientRect(); if(!B.width) return;
  const rect=name=>{ const n=body.querySelector(`.rnode[data-node="${CSS.escape(name)}"]`); if(!n) return null; const r=n.getBoundingClientRect();
    return {l:r.left-B.left, r:r.right-B.left, t:r.top-B.top, b:r.bottom-B.top, cx:(r.left+r.right)/2-B.left}; };
  let svg="", labels="", maxY=B.height, minY=0;
  const uid=++UID;
  conns.forEach(c=>{
    const A=rect(c.a), Z=rect(c.b); if(!A||!Z) return;
    const o=c.opts||{}; const arm=o.arm?toPx(o.arm,"pt"):10;
    const ang=o.angle!==undefined?+o.angle:(o.angleA!==undefined?+o.angleA:-90);
    const st=(c.arrow||"").includes(">"), sb=(c.arrow||"").startsWith("<");
    let d, mid;
    if(c.kind==="bar"){
      if(ang>0){ const y=Math.min(A.t,Z.t)-arm; d=`M${A.cx},${A.t-1} V${y} H${Z.cx} V${Z.t-1}`; mid=[(A.cx+Z.cx)/2,y]; minY=Math.min(minY,y); }
      else { const y=Math.max(A.b,Z.b)+arm; d=`M${A.cx},${A.b+1} V${y} H${Z.cx} V${Z.b+1}`; mid=[(A.cx+Z.cx)/2,y]; maxY=Math.max(maxY,y); }
    } else if(c.kind==="curve"){
      const y=Math.max(A.b,Z.b)+arm*2.2; d=`M${A.cx},${A.b+1} C${A.cx},${y} ${Z.cx},${y} ${Z.cx},${Z.b+1}`; mid=[(A.cx+Z.cx)/2,Math.max(A.b,Z.b)+arm*1.65]; maxY=Math.max(maxY,y);
    } else { d=`M${A.cx},${A.b+1} L${Z.cx},${Z.b+1}`; mid=[(A.cx+Z.cx)/2,(A.b+Z.b)/2]; }
    svg+=`<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.1"${st?` marker-end="url(#ah-${uid})"`:""}${sb?` marker-start="url(#ah-${uid})"`:""}/>`;
    if(c.label){ const m=measure(c.label,"dg-l"); labels+=`<div class="dg-l conn-label${c.opaque?" opaque":""}" style="left:${mid[0]-m.w/2}px;top:${mid[1]-m.h/2}px">${c.label}</div>`; maxY=Math.max(maxY, mid[1]+m.h/2); }
  });
  const layer=document.createElement("div"); layer.className="conn-layer";
  layer.innerHTML=`<svg style="position:absolute;left:0;top:0;overflow:visible" width="1" height="1"><defs><marker id="ah-${uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.8 L10,5 L0,9.2 L2.6,5 z" fill="context-stroke"/></marker></defs>${svg}</svg>${labels}`;
  body.appendChild(layer);
  if(maxY>B.height) body.style.paddingBottom=(maxY-B.height+6)+"px";
  if(minY<0) body.style.paddingTop=(-minY+4)+"px";
}

/* ---------- fit diagrams to their column (scale down only) ---------- */
function fitDiagrams(root){
  root.querySelectorAll(".dg-fit").forEach(f=>{
    const dg=f.firstElementChild; if(!dg) return;
    const W=+dg.dataset.w, H=+dg.dataset.h;
    dg.style.transform=""; f.style.height="";
    const avail=f.clientWidth; if(!avail) return;
    const s=Math.min(1, avail/W);
    if(s<1){ dg.style.transform=`scale(${s})`; f.style.height=(H*s)+"px"; }
  });
}

function renderAll(diagrams, root, warn){
  root.querySelectorAll(".diagram[data-dg]").forEach(el=>{
    const spec=diagrams[el.dataset.dg]; if(!spec) return;
    try{
      if(spec.kind==="forest") renderForest(spec, el, warn);
      else if(spec.kind==="tikz") renderTikz(spec, el, warn);
      else if(spec.kind==="headchain") renderHeadchain(spec, el);
    } catch(e){ console.error(e); el.innerHTML=`<div class="unk">diagram could not be drawn: ${String(e.message||e)}</div>`; }
  });
}

window.Diagrams={ renderAll, drawConns, fitDiagrams };
})();
