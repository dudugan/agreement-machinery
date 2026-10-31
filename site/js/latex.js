/* latex.js — a small LaTeX → HTML converter for Agreement Machinery.
 *
 * It understands the subset of LaTeX used in the manuscript: user macros (\newcommand, read from
 * content/macros.tex), text formatting and accents, inline math, sections and labels, footnotes and
 * marginal comments, natbib citations, expex examples and glosses, pstricks node connections,
 * multicols/paracol, and forest / tikz / \headchain diagrams (parsed here, drawn by diagrams.js).
 *
 * Output HTML may contain placeholders for cross-references and citations; they are filled in by
 * LaTeX.resolve() once every document has been parsed, so references can point across files.
 */
(function(){
"use strict";

/* ---------- markers used inside intermediate HTML ---------- */
const PAR="\u0001", BS="\u0002", BE="\u0003", CITE="\u0004", REF="\u0005", HF="\u0006", SEP="\u0007";
// substitute macro arguments the way TeX would see them: a control word never runs into following letters
function expandBody(body, args, rest){
  let out=body.replace(/#(\d)/g,(m,d,off)=>{ const a=args[d-1]??""; return (/\\[a-zA-Z@]+$/.test(body.slice(0,off)) && /^[a-zA-Z@]/.test(a)) ? SEP+a : a; });
  if(/\\[a-zA-Z@]+$/.test(out) && /^[a-zA-Z@]/.test(rest||"")) out+=SEP;
  return out;
}
const block = html => BS+html+BE;

const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

/* ---------- units: LaTeX lengths → CSS px (scaled so 11pt LaTeX text ≈ the site's 17px) ---------- */
const K=1.15;
const UNIT={pt:1.33*K, bp:1.33*K, mm:3.78*K, cm:37.8*K, in:96*K, em:17, ex:8, px:1};
function toPx(v, def="cm"){
  const m=String(v).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z]*)$/i);
  if(!m) return 0;
  return parseFloat(m[1])*(UNIT[m[2]||def]??UNIT.cm);
}

/* ---------- symbol tables ---------- */
const MSYM={
  alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ϵ",varepsilon:"ε",zeta:"ζ",eta:"η",theta:"θ",vartheta:"ϑ",iota:"ι",kappa:"κ",
  lambda:"λ",mu:"μ",nu:"ν",xi:"ξ",pi:"π",varpi:"ϖ",rho:"ρ",sigma:"σ",varsigma:"ς",tau:"τ",upsilon:"υ",phi:"ϕ",varphi:"φ",chi:"χ",
  psi:"ψ",omega:"ω",Gamma:"Γ",Delta:"Δ",Theta:"Θ",Lambda:"Λ",Xi:"Ξ",Pi:"Π",Sigma:"Σ",Upsilon:"Υ",Phi:"Φ",Psi:"Ψ",Omega:"Ω",
  emptyset:"∅",varnothing:"∅",langle:"⟨",rangle:"⟩",llbracket:"⟦",rrbracket:"⟧",lbrack:"[",rbrack:"]",
  Longleftrightarrow:"⟺",Leftrightarrow:"⇔",leftrightarrow:"↔",longleftrightarrow:"⟷",rightarrow:"→",to:"→",leftarrow:"←",gets:"←",
  Rightarrow:"⇒",Leftarrow:"⇐",Longrightarrow:"⟹",longrightarrow:"⟶",mapsto:"↦",uparrow:"↑",downarrow:"↓",rightsquigarrow:"⇝",
  times:"×",circ:"∘",cdot:"·",bullet:"•",pm:"±",mp:"∓",neq:"≠",ne:"≠",leq:"≤",le:"≤",geq:"≥",ge:"≥",approx:"≈",sim:"∼",equiv:"≡",
  in:"∈",notin:"∉",ni:"∋",subset:"⊂",supset:"⊃",subseteq:"⊆",supseteq:"⊇",cup:"∪",cap:"∩",setminus:"∖",forall:"∀",exists:"∃",
  neg:"¬",lnot:"¬",wedge:"∧",land:"∧",vee:"∨",lor:"∨",infty:"∞",prime:"′",ast:"∗",star:"⋆",dagger:"†",ddagger:"‡",
  ldots:"…",dots:"…",cdots:"⋯",vdots:"⋮",mid:"∣",vert:"|",Vert:"‖",backslash:"\\",partial:"∂",nabla:"∇",sqcup:"⊔",oplus:"⊕",
  otimes:"⊗",top:"⊤",bot:"⊥",vdash:"⊢",models:"⊨",checkmark:"✓",square:"□",Box:"□",Diamond:"◇",triangle:"△",
  "{":"{","}":"}","#":"#","%":"%","&":"&","_":"_","$":"$",",":" ",";":" ",":":" ","!":"",quad:"  ",qquad:"    "," ":" ",
};
const TSYM={ // text-mode symbols (control words / symbols)
  "#":"#","$":"$","%":"%","&":"&amp;","_":"_","{":"{","}":"}","textbackslash":"\\",S:"§",P:"¶",dag:"†",ddag:"‡",
  copyright:"©",textregistered:"®",texttrademark:"™",ss:"ß",ae:"æ",AE:"Æ",oe:"œ",OE:"Œ",o:"ø",O:"Ø",aa:"å",AA:"Å",l:"ł",L:"Ł",
  i:"ı",j:"ȷ",dh:"ð",DH:"Ð",th:"þ",TH:"Þ",ng:"ŋ",NG:"Ŋ",textschwa:"ə",textesh:"ʃ",textyogh:"ʒ",textglotstop:"ʔ",textrevglotstop:"ʕ",
  textbullet:"•",textperiodcentered:"·",textendash:"–",textemdash:"—",textellipsis:"…",textquoteleft:"‘",textquoteright:"’",
  textquotedblleft:"“",textquotedblright:"”",guillemotleft:"«",guillemotright:"»",textasciitilde:"~",textasciicircum:"^",
  checkmark:"✓",textdegree:"°",textmu:"µ",textlangle:"⟨",textrangle:"⟩"," ":" ",",":" ",";":" ",":":" ","!":"",
  "-":"­","/":"",quad:" ",qquad:"  ",enspace:" ",thinspace:" ",negthinspace:"",
  "@":"",slash:"/",LaTeX:"L<sup style='font-size:.7em;margin-left:-.3em'>A</sup>T<sub style='margin-left:-.1em'>E</sub>X",TeX:"T<sub>E</sub>X",
  today:new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"}),
};
const ACC={"'":"́","`":"̀","^":"̂",'"':"̈","~":"̃","=":"̄",".":"̇",
  u:"̆",v:"̌",H:"̋",c:"̧",d:"̣",b:"̱",r:"̊",k:"̨",t:"͡"};
const DING={51:"✓",52:"✔",55:"✗",56:"✘",72:"★",108:"●",109:"❍",110:"■",111:"❏",43:"☞"};

/* commands that are accepted and quietly dropped (with their arguments) */
const IGNORE0=new Set(["noindent","indent","centering","raggedright","raggedleft","singlespacing","onehalfspacing","doublespacing",
  "medskip","smallskip","bigskip","newpage","clearpage","pagebreak","nopagebreak","linebreak","nolinebreak","relax","protect",
  "exdisplay","maketitle","normalsize","small","footnotesize","scriptsize","large","Large","LARGE","huge","Huge","tiny","selectfont",
  "hline","toprule","midrule","bottomrule","newline_","break","allowbreak","sloppy","fussy","leavevmode","strut","ignorespaces",
  "unskip","nobreak","frenchspacing","par_","displaystyle","textstyle","normalfont","upshape","mdseries","tableofcontents",
  "xe","columnbreak","switchcolumn","appendix","printbibliography","bibliographystyle","vfill"]);
const IGNORE1=new Set(["vspace","vspace*","lingset","columnratio_","setlength_","pagestyle","thispagestyle","bibliography",
  "addbibresource","usepackage_","documentclass_","author","date","fontsize_","enlargethispage","index","glossary","hyphenation",
  "addvspace","nocite","renewcommand*"]);

/* ---------- documents, labels, citations: shared state ---------- */
function makeState(macros){
  return { macros: macros||{}, labels:{}, docs:{}, diagrams:{}, dgCount:0, expansions:0, warnings:[], colratio:null };
}

/* ---------- comment stripping (keeps \% ) ---------- */
function stripComments(src){
  let out="", i=0;
  while(i<src.length){
    const c=src[i];
    if(c==="\\"){ out+=src.slice(i,i+2); i+=2; continue; }
    if(c==="%"){ // drop to end of line, then the newline and leading spaces of the next line (TeX behaviour)
      while(i<src.length && src[i]!=="\n") i++;
      if(src[i]==="\n"){ i++; while(i<src.length && (src[i]===" "||src[i]==="\t")) i++; }
      continue;
    }
    out+=c; i++;
  }
  return out;
}

/* ---------- front matter: leading lines of the form  %% key: value ---------- */
function frontMatter(src){
  const meta={}; const lines=src.split("\n"); let k=0;
  for(; k<lines.length; k++){
    const l=lines[k].trim();
    if(l==="") continue;
    const m=l.match(/^%%\s*([\w-]+)\s*:\s*(.*)$/);
    if(m) meta[m[1].toLowerCase()]=m[2].trim();
    else if(l.startsWith("%")) continue;
    else break;
  }
  return meta;
}

/* ---------- \newcommand / \renewcommand / \def / \DeclareRobustCommand ---------- */
function parseMacros(src, macros={}){
  src=stripComments(src);
  const re=/\\(?:re)?newcommand\*?|\\providecommand\*?|\\DeclareRobustCommand\*?|\\def(?![a-zA-Z])/g;
  let m;
  while((m=re.exec(src))){
    let i=m.index+m[0].length;
    const ws=()=>{ while(/\s/.test(src[i]||"")) i++; };
    const group=()=>{ ws(); if(src[i]!=="{"){ // unbraced single token
        if(src[i]==="\\"){ let j=i+1; if(/[a-zA-Z@]/.test(src[j])) while(/[a-zA-Z@]/.test(src[j])) j++; else j++; const t=src.slice(i,j); i=j; return t; }
        return src[i++]; }
      let d=0, j=i; for(; j<src.length; j++){ if(src[j]==="\\"){ j++; continue; } if(src[j]==="{") d++; else if(src[j]==="}" && --d===0) break; }
      const t=src.slice(i+1,j); i=j+1; return t; };
    const opt=()=>{ ws(); if(src[i]!=="[") return null; let d=0,j=i; for(; j<src.length; j++){ if(src[j]==="{")d++; else if(src[j]==="}")d--; else if(src[j]==="]"&&d===0) break; } const t=src.slice(i+1,j); i=j+1; return t; };
    let name;
    if(m[0]==="\\def"){ ws(); let j=i+1; if(/[a-zA-Z@]/.test(src[j])) while(/[a-zA-Z@]/.test(src[j])) j++; else j++;
      name=src.slice(i+1,j); i=j; let params=""; while(i<src.length && src[i]!=="{"){ params+=src[i]; i++; }
      const n=(params.match(/#\d/g)||[]).length; macros[name]={n, body:group()}; continue; }
    name=group().replace(/^\\/,"");
    const n=+(opt()||0), dflt=opt();
    macros[name]={n, opt: dflt===null?undefined:dflt, body: group()};
    re.lastIndex=i;
  }
  return macros;
}

/* =====================================================================================
 *  Parser
 * ===================================================================================== */
class Parser {
  constructor(src, st, ctx){ this.s=src; this.i=0; this.st=st; this.ctx=ctx||{}; }
  get doc(){ return this.ctx.doc; }
  eof(){ return this.i>=this.s.length; }
  peek(k=0){ return this.s[this.i+k]; }
  rest(){ return this.s.slice(this.i); }
  warn(msg){ this.st.warnings.push((this.doc?this.doc.id+": ":"")+msg); }

  skipWS(){ // spaces and single newlines; stops before a blank line
    while(!this.eof()){
      const c=this.peek();
      if(c===" "||c==="\t"||c==="\r"||c===SEP){ this.i++; continue; }
      if(c==="\n"){ if(/^\n[ \t\r]*\n/.test(this.s.slice(this.i,this.i+40))) return; this.i++; continue; }
      return;
    }
  }
  readGroupAt(){ // assumes this.peek()==="{"
    let d=0, j=this.i;
    for(; j<this.s.length; j++){ const c=this.s[j]; if(c==="\\"){ j++; continue; } if(c==="{") d++; else if(c==="}" && --d===0) break; }
    const t=this.s.slice(this.i+1,j); this.i=j+1; return t;
  }
  readArg(){
    this.skipWS();
    const c=this.peek();
    if(c===undefined) return "";
    if(c==="{") return this.readGroupAt();
    if(c==="\\"){ let j=this.i+1; if(/[a-zA-Z@]/.test(this.s[j])) while(/[a-zA-Z@]/.test(this.s[j])) j++; else j++; const t=this.s.slice(this.i,j); this.i=j; return t; }
    this.i++; return c;
  }
  readOpt(attached=false){
    const save=this.i; if(!attached) this.skipWS();
    if(this.peek()!=="["){ this.i=save; return null; }
    let d=0, b=0, j=this.i;
    for(; j<this.s.length; j++){ const c=this.s[j]; if(c==="\\"){ j++; continue; }
      if(c==="{") d++; else if(c==="}") d--; else if(c==="[") b++; else if(c==="]" && d===0 && --b===0) break; }
    const t=this.s.slice(this.i+1,j); this.i=j+1; return t;
  }
  readStar(){ if(this.peek()==="*"){ this.i++; return true; } return false; }
  readCS(){ // at "\"
    this.i++;
    const c=this.peek();
    if(c!==undefined && /[a-zA-Z@]/.test(c)){
      let j=this.i; while(j<this.s.length && /[a-zA-Z@]/.test(this.s[j])) j++;
      const name=this.s.slice(this.i,j); this.i=j;
      // TeX skips spaces (and one newline) after a control word
      const save=this.i; while(this.peek()===" "||this.peek()==="\t") this.i++;
      if(this.peek()==="\n" && !/^\n[ \t\r]*\n/.test(this.s.slice(this.i,this.i+40))){ this.i++; while(this.peek()===" "||this.peek()==="\t") this.i++; }
      return {name, word:true, spaceAfter:this.i>save};
    }
    this.i++; return {name:c||"", word:false};
  }
  // read until \end{env} matching \begin{env}
  readEnv(env){
    const open="\\begin{"+env+"}", close="\\end{"+env+"}"; let d=1, j=this.i;
    while(j<this.s.length){
      const o=this.s.indexOf(open,j), c=this.s.indexOf(close,j);
      if(c<0){ j=this.s.length; break; }
      if(o>=0 && o<c){ d++; j=o+open.length; continue; }
      if(--d===0){ const t=this.s.slice(this.i,c); this.i=c+close.length; return t; }
      j=c+close.length;
    }
    const t=this.s.slice(this.i); this.i=this.s.length; this.warn("unterminated \\begin{"+env+"}"); return t;
  }
  // read until a closing control word (e.g. \xe for \ex/\pex), allowing nesting
  readUntilCS(closeName, openNames){
    let d=1, j=this.i;
    const re=/\\([a-zA-Z@]+)/g; re.lastIndex=j;
    let m;
    while((m=re.exec(this.s))){
      if(openNames.includes(m[1])) d++;
      else if(m[1]===closeName && --d===0){ const t=this.s.slice(this.i,m.index); this.i=m.index+m[0].length; return t; }
    }
    const t=this.s.slice(this.i); this.i=this.s.length; return t; // unterminated: runs to the end of this group/column
  }

  sub(src, ctx=this.ctx, mode="auto"){ return convert(src, this.st, ctx, mode); }

  /* ---------- main loop ---------- */
  parse(){
    let out="";
    while(!this.eof()){
      const c=this.peek();
      if(c===SEP){ this.i++; continue; }
      if(c==="\\"){ out+=this.command(); continue; }
      if(c==="{"){ const g=this.readGroupAt(); out+=this.sub(g, this.ctx, "raw"); continue; } // keep blocks/paragraphs: {\singlespacing …}
      if(c==="}"){ this.i++; continue; }
      if(c==="$"){ out+=this.math(); continue; }
      if(c==="~"){ this.i++; out+="&nbsp;"; continue; }
      if(c==="`"){ if(this.peek(1)==="`"){ this.i+=2; out+="“"; } else { this.i++; out+="‘"; } continue; }
      if(c==="'"){ if(this.peek(1)==="'"){ this.i+=2; out+="”"; } else { this.i++; out+="’"; } continue; }
      if(c==="-"){ if(this.s.startsWith("---",this.i)){ this.i+=3; out+="—"; } else if(this.s.startsWith("--",this.i)){ this.i+=2; out+="–"; } else { this.i++; out+="-"; } continue; }
      if(c==="\n"||c===" "||c==="\t"||c==="\r"){
        let j=this.i, nl=0; while(j<this.s.length && /\s/.test(this.s[j])){ if(this.s[j]==="\n") nl++; j++; }
        this.i=j; out+= nl>=2 ? PAR : " "; continue;
      }
      if(c==="<"){ this.i++; out+="&lt;"; continue; }
      if(c===">"){ this.i++; out+="&gt;"; continue; }
      if(c==="&"){ this.i++; out+="&amp;"; continue; }
      if(c==='"'){ this.i++; out+="&quot;"; continue; }
      out+=c; this.i++;
    }
    return out;
  }

  math(){
    let display=false;
    if(this.peek(1)==="$"){ display=true; this.i+=2; } else this.i++;
    let j=this.i;
    for(; j<this.s.length; j++){ if(this.s[j]==="\\"){ j++; continue; } if(this.s[j]==="$") break; }
    const inner=this.s.slice(this.i,j); this.i=j+(display?2:1);
    const html=mathToHtml(inner, this.st, this.ctx);
    return display ? block(`<div class="mathdisplay">${html}</div>`) : html;
  }

  command(){
    const start=this.i;
    const cs=this.readCS(); const name=cs.name;
    const st=this.st;

    // user macros first (so the manuscript's preamble wins over built-ins)
    const m=st.macros[name];
    if(m){
      const args=[]; let k=0;
      if(m.opt!==undefined){ const o=this.readOpt(); args.push(o===null?m.opt:o); k=1; }
      for(; k<m.n; k++) args.push(this.readArg());
      const body=expandBody(m.body, args, this.s.slice(this.i));
      if(++st.expansions>400000){ this.warn("macro expansion limit reached at \\"+name); return ""; }
      this.s=body+this.s.slice(this.i); this.i=0;
      return "";
    }
    const fn=BUILTIN[name];
    if(fn) return fn(this, cs) ?? "";
    if(!cs.word){
      if(ACC[name]!==undefined) return accent(this, name);
      if(TSYM[name]!==undefined) return TSYM[name];
      if(name==="\\"){ this.readStar(); this.readOpt(true); return "<br>"; }
      if(name===" "||name==="\n") return " ";
      if(name==="(") { const j=this.s.indexOf("\\)",this.i); const inner=this.s.slice(this.i,j<0?undefined:j); this.i=j<0?this.s.length:j+2; return mathToHtml(inner,st,this.ctx); }
      if(name==="[") { const j=this.s.indexOf("\\]",this.i); const inner=this.s.slice(this.i,j<0?undefined:j); this.i=j<0?this.s.length:j+2; return block(`<div class="mathdisplay">${mathToHtml(inner,st,this.ctx)}</div>`); }
    }
    if(ACC[name]!==undefined && cs.word) return accent(this, name);
    if(TSYM[name]!==undefined){ return TSYM[name]; }
    if(IGNORE0.has(name)) return "";
    if(IGNORE1.has(name)){ this.readStar(); this.readOpt(); this.readArg(); return ""; }
    this.warn("unknown command \\"+name);
    return `<span class="unk" title="unknown LaTeX command">\\${esc(name)}</span>`;
  }
}

/* ---------- conversion entry point ---------- */
function convert(src, st, ctx, mode="auto"){
  const p=new Parser(src, st, ctx);
  const out=p.parse();
  return assemble(out, mode);
}
function assemble(out, mode){
  if(mode==="raw") return out;
  if(mode==="inline") return out.replace(new RegExp(PAR,"g")," ").replace(new RegExp(BS+"|"+BE,"g"),"").trim();
  const hasBlock=out.includes(BS), hasPar=out.includes(PAR);
  if(mode==="auto" && !hasBlock && !hasPar) return out.trim();
  const BR_END=/(?:\s*<br>)+\s*$/, BR_START=/^\s*(?:<br>\s*)+/;
  const segs=out.split(new RegExp("("+BS+"[\\s\\S]*?"+BE+")"));
  const wrap=t=> mode==="auto"&&!hasPar ? `<div class="ln">${t}</div>` : `<p>${t}</p>`;
  let html="";
  for(let k=0;k<segs.length;k++){
    const seg=segs[k];
    if(seg.startsWith(BS)){ html+=seg.slice(1,-1); continue; }
    const before=k>0 && segs[k-1].startsWith(BS), after=k<segs.length-1 && segs[k+1].startsWith(BS);
    const paras=seg.split(PAR);
    paras.forEach((para,j)=>{
      let t=para;
      if(j===0 && before) t=t.replace(BR_START,"");           // a block already breaks the line: drop \\ after it
      const last=j===paras.length-1;
      if(last && after){
        if(BR_END.test(t) && t.trim()){ t=t.replace(BR_END,""); }   // "label\\" before a block: keep it on its own line
        else if(mode==="auto" && t.trim()){                     // "a. \begingl …": label and block share a line
          segs[k+1]=BS+`<div class="lnrow"><span class="lead">${t.trim()}</span>${segs[k+1].slice(1,-1)}</div>`+BE; return; }
      }
      t=t.trim();
      if(t) html+=wrap(t);
    });
  }
  return html;
}

/* ---------- accents ---------- */
function accent(p, name){
  let arg=p.readArg();
  let base=convert(arg, p.st, p.ctx, "inline");
  if(base==="ı") base="i"; if(base==="ȷ") base="j";
  if(!base) return ACC[name];
  // combine with the first character (after any tags)
  const m=base.match(/^((?:<[^>]+>)*)([\s\S])([\s\S]*)$/u);
  if(!m) return base+ACC[name];
  return (m[1]+(m[2]+ACC[name]).normalize("NFC")+m[3]);
}

/* ---------- math ---------- */
function mathToHtml(src, st, ctx){
  const p=new MathParser(src, st, ctx);
  return `<span class="math">${p.parse()}</span>`;
}
class MathParser extends Parser {
  parse(){
    let out="";
    while(!this.eof()){
      const c=this.peek();
      if(c==="\\"){ out+=this.mcommand(); continue; }
      if(c==="{"){ const g=this.readGroupAt(); out+=new MathParser(g,this.st,this.ctx).parse(); continue; }
      if(c==="}"||c==="$"||c===SEP){ this.i++; continue; }
      if(c==="^"||c==="_"){ this.i++; const a=this.atom(); out+= c==="^"?`<sup>${a}</sup>`:`<sub>${a}</sub>`; continue; }
      if(c==="'"){ this.i++; out+="′"; continue; }
      if(c==="~"){ this.i++; out+="&nbsp;"; continue; }
      if(/\s/.test(c)){ this.i++; continue; }
      if(/[a-zA-Z]/.test(c)){ this.i++; out+=`<i>${c}</i>`; continue; }
      // TeX spacing: relations and binary operators get space around them, punctuation a thin space after;
      // a sign (−q, +1, x = −2) stays tight
      const unary=()=>!out.replace(/<[^>]*>/g,"").trim() || /([(\[{=,;<>+−]|&lt;|&gt;|\u2009)\s*$/.test(out.replace(/<\/?(?:i|span)[^>]*>$/,""));
      if(c==="-"){ this.i++; out+=unary()?"−":" − "; continue; }
      if(c==="+"){ this.i++; out+=unary()?"+":" + "; continue; }
      if(c==="="){ this.i++; out+=" = "; continue; }
      if(c===","||c===";"){ this.i++; out+=c+"\u2009"; continue; }
      if(c==="<"){ this.i++; out+=" &lt; "; continue; }
      if(c===">"){ this.i++; out+=" &gt; "; continue; }
      if(c==="&"){ this.i++; out+=" "; continue; }
      if(c==="*"){ this.i++; out+="∗"; continue; }
      out+=esc(c); this.i++;
    }
    return out;
  }
  atom(){
    while(this.peek()===" ") this.i++;
    const c=this.peek();
    if(c==="{"){ return new MathParser(this.readGroupAt(),this.st,this.ctx).parse(); }
    if(c==="\\"){ const save=this.i; const cs=this.readCS(); this.i=save; // let mcommand consume it
      const out=this.mcommandOnce(); return out; }
    this.i++; return /[a-zA-Z]/.test(c)?`<i>${c}</i>`:esc(c);
  }
  mcommandOnce(){ return this.mcommand(); }
  mcommand(){
    const cs=this.readCS(); const name=cs.name; const st=this.st;
    const m=st.macros[name];
    if(m){
      const args=[]; let k=0;
      if(m.opt!==undefined){ const o=this.readOpt(); args.push(o===null?m.opt:o); k=1; }
      for(; k<m.n; k++) args.push(this.readArg());
      const body=expandBody(m.body, args, "");
      if(++st.expansions>400000) return "";
      return new MathParser(body,st,this.ctx).parse();
    }
    const T=(cls)=>{ const a=this.readArg(); const h=convert(a,st,this.ctx,"inline"); return cls?`<span class="${cls}">${h}</span>`:`<span class="mtext">${h}</span>`; };
    switch(name){
      case "text": case "mbox": case "textrm": case "mathrm": case "textnormal": case "operatorname": case "textup": return T();
      case "textit": case "mathit": case "emph": return T("it");
      case "textbf": case "mathbf": case "boldsymbol": case "bm": return T("bf");
      case "textsc": return T("sc");
      case "texttt": case "mathtt": return T("tt");
      case "mathcal": case "mathscr": return T("cal");
      case "textsubscript": return `<sub>${T()}</sub>`;
      case "textsuperscript": return `<sup>${T()}</sup>`;
      case "sqrt": { this.readOpt(); const a=new MathParser(this.readArg(),st,this.ctx).parse(); return `√<span class="ovl">${a}</span>`; }
      case "overline": case "bar": { const a=new MathParser(this.readArg(),st,this.ctx).parse(); return `<span class="ovl">${a}</span>`; }
      case "underline": { const a=new MathParser(this.readArg(),st,this.ctx).parse(); return `<span class="unl">${a}</span>`; }
      case "hat": case "widehat": { const a=new MathParser(this.readArg(),st,this.ctx).parse(); return a+"̂"; }
      case "tilde": case "widetilde": { const a=new MathParser(this.readArg(),st,this.ctx).parse(); return a+"̃"; }
      case "vec": { const a=new MathParser(this.readArg(),st,this.ctx).parse(); return a+"⃗"; }
      case "frac": { const a=new MathParser(this.readArg(),st,this.ctx).parse(), b=new MathParser(this.readArg(),st,this.ctx).parse(); return `${a}/${b}`; }
      case "phantom": { const a=new MathParser(this.readArg(),st,this.ctx).parse(); return `<span class="phantom">${a}</span>`; }
      case "left": case "right": case "big": case "Big": case "bigg": case "Bigg": case "bigl": case "bigr": case "Bigl": case "Bigr": case "displaystyle": case "scriptstyle": case "limits": case "nolimits": return "";
      case "xspace": return "";
    }
    if(MSYM[name]!==undefined) return esc(MSYM[name]);
    if(BUILTIN[name]) return BUILTIN[name](this, cs) ?? "";
    st.warnings.push("unknown math command \\"+name);
    return `<span class="unk">\\${esc(name)}</span>`;
  }
}

/* ---------- helpers for examples ---------- */
// split raw source at top-level occurrences of \name (e.g. \a), not inside braces
function splitTopCS(src, name){
  const parts=[]; let d=0, last=0;
  for(let j=0; j<src.length; j++){
    const c=src[j];
    if(c==="\\"){
      if(d===0 && src.startsWith("\\"+name,j) && !/[a-zA-Z@]/.test(src[j+1+name.length]||"")){
        parts.push(src.slice(last,j)); last=j+1+name.length; j=last-1; continue;
      }
      j++; continue;
    }
    if(c==="{") d++; else if(c==="}") d--;
  }
  parts.push(src.slice(last));
  return parts;
}
// leading grammaticality judgment:  *  ?  ??  *?  #  %  or \ljudge{…}
function splitJudg(raw){
  const m=raw.match(/^(\s*(?:\\(?:label|dref|deftagex)\s*\{[^}]*\}\s*)*)(\\ljudge\s*\{([^}]*)\}|\*\?|\?\?|\*|\?(?=\s*[A-Za-z\\{])|\\#|#|\\%)/);
  if(!m) return {judg:"", rest:raw};
  let j=m[3]!==undefined?m[3]:m[2];
  j=j.replace(/^\\/,"");
  return {judg: esc(j), rest: m[1]+raw.slice(m[0].length)};
}
function hfill(html, judg){
  const j=judg?`<span class="j">${judg}</span>`:"";
  const k=html.indexOf(HF);
  if(k<0) return `<div class="exi">${j}${html}</div>`;
  const left=html.slice(0,k), right=html.slice(k+1).split(HF).join(" ");
  return `<div class="exi hf"><span class="exl">${j}${left}</span><span class="exr">${right}</span></div>`;
}
const LETTERS="abcdefghijklmnopqrstuvwxyz";

function setLabel(p, key, target){
  const st=p.st;
  if(st.labels[key] && st.labels[key].doc!==target.doc) st.warnings.push(`duplicate label "${key}"`);
  st.labels[key]=target;
}
function labelHere(p, key){
  const d=p.doc; if(!d) return;
  const c=p.ctx;
  if(c.item) return setLabel(p,key,{doc:d.id, kind:"ex", num:c.item.num, id:c.item.id});
  if(c.ex)   return setLabel(p,key,{doc:d.id, kind:"ex", num:String(c.ex.n), id:c.ex.id});
  if(d.lastHeading) return setLabel(p,key,{doc:d.id, kind:"sec", num:d.lastHeading.num, id:d.lastHeading.id, title:d.lastHeading.title});
  return setLabel(p,key,{doc:d.id, kind:"chap", id:null});
}
const refPH = obj => REF+JSON.stringify(obj)+REF;

/* ---------- notes ---------- */
function addNote(p, kind, raw){
  const d=p.doc; if(!d) return "";
  const n = kind==="fn" ? ++d.fn : ++d.com;
  const id = `${d.id}-${kind}${n}`;
  const html=convert(raw, p.st, {...p.ctx, inNote:true}, "auto");
  d.notes.push({kind, n, id, html});
  return kind==="fn" ? `<span class="ref" data-r="${id}">${n}</span>` : `<span class="ref com" data-r="${id}"></span>`;
}

/* ---------- diagrams ---------- */
function newDiagram(p, spec){
  const id="dg"+(++p.st.dgCount);
  p.st.diagrams[id]=spec;
  return id;
}
const inlineConv = p => raw => convert(raw, p.st, {...p.ctx, inDiagram:true}, "inline");

/* =====================================================================================
 *  Built-in commands
 * ===================================================================================== */
const wrap = (tag, cls) => p => { const a=p.readArg(); const h=convert(a,p.st,p.ctx,"inline"); return cls?`<${tag} class="${cls}">${h}</${tag}>`:`<${tag}>${h}</${tag}>`; };
const decl = cls => p => `<span class="${cls}">${assemble(p.parseRestRaw(), "inline")}</span>`;
Parser.prototype.parseRestRaw=function(){ const r=new Parser(this.rest(), this.st, this.ctx).parse(); this.i=this.s.length; return r; };

const BUILTIN={
  textbf: wrap("b"), textit: wrap("i"), emph: wrap("em"), textsl: wrap("i"), textsc: wrap("span","sc"), texttt: wrap("code"),
  textup: wrap("span"), textrm: wrap("span"), textnormal: wrap("span"), textsf: wrap("span","sf"), textmd: wrap("span"),
  underline: wrap("span","unl"), uline: wrap("span","unl"), sout: wrap("s"), textsubscript: wrap("sub"), textsuperscript: wrap("sup"),
  text: wrap("span"), mbox: wrap("span"), hbox: wrap("span"), makebox: p=>{ p.readOpt(); p.readOpt(); return wrap("span")(p); },
  textfeat: wrap("span","feat"),
  // \sc{…} as a command, or {\sc …} as a declaration
  sc: p=>{ p.skipWS(); return p.peek()==="{" ? wrap("span","sc")(p) : decl("sc")(p); },
  bf: decl("bf"), it: decl("it"), em: decl("it"), itshape: decl("it"), bfseries: decl("bf"), scshape: decl("sc"), ttfamily: decl("tt"),
  rlap: p=>`<span class="rlap">${convert(p.readArg(),p.st,p.ctx,"inline")}</span>`,
  llap: p=>`<span class="llap">${convert(p.readArg(),p.st,p.ctx,"inline")}</span>`,
  phantom: p=>`<span class="phantom">${convert(p.readArg(),p.st,p.ctx,"inline")}</span>`,
  hphantom: p=>`<span class="phantom">${convert(p.readArg(),p.st,p.ctx,"inline")}</span>`,
  vphantom: p=>{ p.readArg(); return ""; },
  xspace: p=>{ while(p.peek()===SEP) p.i++; const c=p.peek();
    // no space before punctuation, closing brackets, \footnote, or a control symbol such as \1 (v\1 → v′)
    if(c===undefined || /[.,;:!?)\]}'’\-\/\s~]/.test(c)) return "";
    if(c==="\\" && (!/[a-zA-Z@]/.test(p.peek(1)||"") || /^\\(xspace|footnote|comment|todo|textsubscript|textsuperscript|subs|supers)(?![a-zA-Z@])/.test(p.s.slice(p.i,p.i+20)))) return "";
    return " "; },
  dots: (p,cs)=> "…"+(cs.spaceAfter?" ":""), ldots: (p,cs)=> "…"+(cs.spaceAfter?" ":""), textellipsis: (p,cs)=>"…"+(cs.spaceAfter?" ":""),
  hfill: ()=>HF, hfil: ()=>HF, hss: ()=>"", dotfill: ()=>HF,
  hspace: p=>{ p.readStar(); const a=p.readArg(); const px=toPx(a,"pt"); return px>0?`<span class="hsp" style="width:${px.toFixed(1)}px"></span>`:""; },
  quad: ()=>"<span class=\"hsp\" style=\"width:1em\"></span>", qquad: ()=>"<span class=\"hsp\" style=\"width:2em\"></span>",
  par: ()=>PAR, newline: ()=>"<br>", linebreak: p=>{ p.readOpt(); return "<br>"; },
  ding: p=>DING[p.readArg().trim()]||"✗",
  url: p=>{ const u=p.readArg(); return `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`; },
  href: p=>{ const u=p.readArg(); const t=convert(p.readArg(),p.st,p.ctx,"inline"); return `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>`; },
  footnote: p=>{ p.readOpt(); return addNote(p,"fn",p.readArg()); },
  footnotemark: ()=>"", footnotetext: p=>{ p.readOpt(); p.readArg(); return ""; },
  // author comments in the margin
  comment: p=>addNote(p,"com",p.readArg()), todo: p=>{ p.readOpt(); return addNote(p,"com",p.readArg()); },
  marginpar: p=>{ p.readOpt(); return addNote(p,"com",p.readArg()); }, marginnote: p=>{ p.readOpt(); return addNote(p,"com",p.readArg()); },
  ljudge: p=>`<span class="j">${convert(p.readArg(),p.st,p.ctx,"inline")}</span>`,
  noexno: p=>{ if(p.ctx.ex) p.ctx.ex.noNum=true; return ""; },
  title: p=>{ p.readOpt(); const t=p.readArg(); if(p.doc && !p.doc.meta.title) p.doc.meta.title=convert(t,p.st,p.ctx,"inline"); return ""; },
  newcommand: p=>defineInline(p), renewcommand: p=>defineInline(p), providecommand: p=>defineInline(p), def: p=>defineInline(p,true),
  newenvironment: p=>{ p.readStar(); p.readArg(); p.readOpt(); p.readOpt(); p.readArg(); p.readArg(); return ""; },
  columnratio: p=>{ const a=p.readArg(); p.st.colratio=a.split(",").map(Number); return ""; },
  setlength: p=>{ p.readArg(); p.readArg(); return ""; }, setcounter: p=>{ p.readArg(); p.readArg(); return ""; },
  usepackage: p=>{ p.readOpt(); p.readArg(); return ""; }, documentclass: p=>{ p.readOpt(); p.readArg(); return ""; },
  fontsize: p=>{ p.readArg(); p.readArg(); return ""; },
  caption: p=>{ p.readOpt(); return block(`<div class="caption">${convert(p.readArg(),p.st,p.ctx,"inline")}</div>`); },
  item: p=>{ p.readOpt(); return ""; }, // handled by list environments

  codeblock: p=>{ const c=(p.st.codes||{})[p.readArg().trim()]; if(!c) return "";
    return block(`<div class="codeblock" data-lang="${esc(c.lang)}"><pre class="code-src">${esc(c.code)}</pre></div>`); },
  inlinecode: p=>{ const c=(p.st.codes||{})[p.readArg().trim()]; return c?`<code>${esc(c.code)}</code>`:""; },

  /* ----- sections ----- */
  chapter: p=>{ p.readStar(); p.readOpt(); const t=p.readArg(); if(p.doc && !p.doc.meta.title) p.doc.meta.title=convert(t,p.st,p.ctx,"inline"); return ""; },
  section: p=>heading(p,1), subsection: p=>heading(p,2), subsubsection: p=>heading(p,3), paragraph: p=>heading(p,4),

  /* ----- labels & references ----- */
  label: p=>{ labelHere(p, p.readArg().trim()); return ""; },
  deftagex: p=>{ labelHere(p, p.readArg().trim()); return ""; },
  ref: p=>refPH({k:p.readArg().trim(), form:"num"}),
  eqref: p=>refPH({k:p.readArg().trim(), form:"num"}),
  pageref: p=>{ p.readArg(); return "?"; },
  autoref: p=>refPH({k:p.readArg().trim(), form:"auto"}), cref: p=>refPH({k:p.readArg().trim(), form:"auto"}),
  Cref: p=>refPH({k:p.readArg().trim(), form:"Auto"}), nameref: p=>refPH({k:p.readArg().trim(), form:"name"}),
  getref: p=>refPH({k:p.readArg().trim(), form:"num"}),
  // \hyperref[label]{text}: link any text to a label (a section, example or chapter)
  hyperref: p=>{ const k=(p.readOpt()||"").trim(); const t=convert(p.readArg(),p.st,p.ctx,"inline"); return k?refPH({k, form:"text", text:t}):t; },
  getfullref: p=>refPH({k:p.readArg().trim(), form:"num"}),
  // expex relative references: \nextx (next example), \lastx, \anextx (two ahead), \blastx, \bblastx
  nextx: p=>relEx(p,1), anextx: p=>relEx(p,2), lastx: p=>relEx(p,0), blastx: p=>relEx(p,-1), bblastx: p=>relEx(p,-2),

  /* ----- citations (natbib) ----- */
  citet: p=>cite(p,"t"), citep: p=>cite(p,"p"), cite: p=>cite(p,"t"), citealt: p=>cite(p,"alt"), citealp: p=>cite(p,"alp"),
  citeauthor: p=>cite(p,"author"), citeyear: p=>cite(p,"year"), citeyearpar: p=>cite(p,"yearpar"), parencite: p=>cite(p,"p"),
  textcite: p=>cite(p,"t"), Citet: p=>cite(p,"t"), Citep: p=>cite(p,"p"),

  /* ----- environments ----- */
  begin: p=>beginEnv(p),
  end: p=>{ p.readArg(); return ""; }, // stray

  /* ----- expex ----- */
  ex: (p,cs)=>example(p,false,cs), pex: (p,cs)=>example(p,true,cs),
  begingl: p=>gloss(p, p.readUntilCS("endgl",["begingl"])),
  // \a outside \pex: treat as a literal item marker
  a: p=>"",

  /* ----- pstricks node connections (drawn over the example by diagrams.js) ----- */
  rnode: p=>{ p.readOpt(); const name=p.readArg().trim(); const c=convert(p.readArg(),p.st,p.ctx,"inline"); return `<span class="rnode" data-node="${esc(name)}">${c}</span>`; },
  Rnode: p=>BUILTIN.rnode(p), pnode: p=>{ p.readArg(); const name=p.readArg().trim(); return `<span class="rnode pnode" data-node="${esc(name)}"></span>`; },
  ncbar: p=>conn(p,"bar"), ncline: p=>conn(p,"line"), nccurve: p=>conn(p,"curve"), ncangle: p=>conn(p,"bar"), ncangles: p=>conn(p,"bar"),
  ncarc: p=>conn(p,"curve"), ncdiag: p=>conn(p,"line"), ncloop: p=>conn(p,"bar"),
  ncput: p=>{ const star=p.readStar(); p.readOpt(); const lab=convert(p.readArg(),p.st,p.ctx,"inline"); const ex=p.ctx.ex;
    if(ex && ex.conns.length) Object.assign(ex.conns[ex.conns.length-1],{label:lab, opaque:star}); return ""; },
  naput: p=>BUILTIN.ncput(p), nbput: p=>BUILTIN.ncput(p), taput: p=>BUILTIN.ncput(p), tbput: p=>BUILTIN.ncput(p),

  /* ----- diagrams ----- */
  headchain: p=>{ p.readOpt(); const spec=p.readArg(); const id=newDiagram(p, parseHeadchain(spec, inlineConv(p))); return block(`<div class="diagram headchain" data-dg="${id}"></div>`); },
  Tree: p=>{ // qtree / tikz-qtree:  \Tree [.TP [.DP the keys ] … ]
    const src=p.rest(); const t=qtreeToForest(src); p.i+=t.used; const id=newDiagram(p, parseForest(t.forest, inlineConv(p))); return block(`<div class="diagram boxed" data-dg="${id}"></div>`); },
};

function defineInline(p, isDef){
  // a \newcommand inside a document: add it to the macro table for the rest of the run
  p.readStar();
  if(isDef){ let name=p.readArg().replace(/^\\/,""); let params=""; while(!p.eof() && p.peek()!=="{"){ params+=p.peek(); p.i++; } p.st.macros[name]={n:(params.match(/#\d/g)||[]).length, body:p.readArg()}; return ""; }
  const name=p.readArg().replace(/^\\/,""); const n=+(p.readOpt()||0); const o=p.readOpt(); const body=p.readArg();
  p.st.macros[name]={n, opt:o===null?undefined:o, body};
  return "";
}

function heading(p, level){
  const star=p.readStar(); p.readOpt();
  const t=convert(p.readArg(), p.st, p.ctx, "inline");
  const d=p.doc; if(!d) return block(`<h${level+1}>${t}</h${level+1}>`);
  let num="", id;
  if(!star){
    if(level===1){ d.sec++; d.subsec=0; d.subsub=0; num=`${d.n}.${d.sec}`; }
    else if(level===2){ d.subsec++; d.subsub=0; num=`${d.n}.${d.sec}.${d.subsec}`; }
    else if(level===3){ d.subsub++; num=`${d.n}.${d.sec}.${d.subsec}.${d.subsub}`; }
  }
  id=`${d.id}-s${num?num.replace(/\./g,"-"):(++d.anon)}`;
  d.lastHeading={num, id, title:t};
  if(level===1) d.sections.push({num, id, title:t});
  const tag="h"+Math.min(level+1,5);
  return block(`<${tag} id="${id}">${num?`<span class="num">${num}</span>`:""}${t}</${tag}>`);
}

function relEx(p, off){
  const d=p.doc; if(!d) return "?";
  const n=d.exCount+off;
  return refPH({ex:`${d.id}-ex${n}`, num:String(n), doc:d.id});
}

function cite(p, form){
  const o1=p.readOpt(), o2=p.readOpt();
  const keys=p.readArg().split(",").map(s=>s.trim()).filter(Boolean);
  let pre="", post="";
  if(o2!==null){ pre=o1||""; post=o2; } else if(o1!==null) post=o1;
  const d=p.doc;
  if(d) keys.forEach(k=>d.cites.push({key:k, sec:d.lastHeading?{num:d.lastHeading.num,id:d.lastHeading.id}:null}));
  return CITE+JSON.stringify({keys, form, pre:convert(pre,p.st,p.ctx,"inline"), post:convert(post,p.st,p.ctx,"inline")})+CITE;
}

function conn(p, kind){
  p.readStar(); const opts=parseKV(p.readOpt()||""); let arrow="-";
  p.skipWS(); if(p.peek()==="{"){ const save=p.i; const a=p.readGroupAt(); if(/^[<>|\-*o]*$/.test(a.trim())) arrow=a.trim(); else p.i=save; }
  const a=p.readArg().trim(), b=p.readArg().trim();
  const ex=p.ctx.ex; if(ex) ex.conns.push({kind, opts, arrow, a, b});
  return "";
}

/* ---------- key=value option lists (tikz/forest/pstricks) ---------- */
function splitTop(s, sep=","){
  const out=[]; let d=0, last=0;
  for(let j=0; j<s.length; j++){ const c=s[j];
    if(c==="\\"){ j++; continue; }
    if(c==="{"||c==="("||c==="[") d++; else if(c==="}"||c===")"||c==="]") d--;
    else if(c===sep && d===0){ out.push(s.slice(last,j)); last=j+1; } }
  out.push(s.slice(last)); return out.map(x=>x.trim()).filter(x=>x!=="");
}
function unbrace(s){ s=s.trim(); return (s.startsWith("{")&&s.endsWith("}"))?s.slice(1,-1):s; }
function parseKV(s){
  const o={}; for(const part of splitTop(s)){ const k=part.indexOf("=");
    if(k<0) o[part.trim()]=true; else o[part.slice(0,k).trim()]=unbrace(part.slice(k+1)); }
  return o;
}

/* ---------- environments ---------- */
function beginEnv(p){
  const env=p.readArg().trim();
  const st=p.st;
  switch(env){
    case "document": return "";
    case "abstract": { const raw=p.readEnv(env); if(p.doc) p.doc.abstract=convert(raw,st,p.ctx,"auto"); return ""; }
    case "multicols": case "multicols*": {
      const n=+p.readArg()||2; p.readOpt(); const raw=p.readEnv(env);
      const cols=splitTopCS(raw,"columnbreak");
      const htmls=cols.map(c=>convert(c,st,p.ctx,"auto"));
      const inner=htmls.map(h=>`<div class="col">${h}</div>`).join("");
      const tpl=htmls.map(h=>track(h,1)).join(" ");
      return block(`<div class="cols" style="grid-template-columns:${tpl}">${inner}</div>`);
    }
    case "paracol": {
      const n=+p.readArg()||2; const raw=p.readEnv(env);
      const cols=splitTopCS(raw.replace(/\\switchcolumn\*/g,"\\switchcolumn"),"switchcolumn");
      let ratios=st.colratio; st.colratio=null;
      let tpl;
      const htmls=cols.map(c=>convert(c,st,p.ctx,"auto"));
      if(ratios && ratios.length){ const used=ratios.reduce((a,b)=>a+b,0); const restN=Math.max(1,cols.length-ratios.length);
        tpl=htmls.map((h,k)=>track(h, k<ratios.length?ratios[k]:(1-used)/restN)).join(" "); }
      else tpl=htmls.map(h=>track(h,1)).join(" ");
      const inner=htmls.map(h=>`<div class="col">${h}</div>`).join("");
      return block(`<div class="cols" style="grid-template-columns:${tpl}">${inner}</div>`);
    }
    case "forest": {
      const raw=p.readEnv(env);
      const id=newDiagram(p, parseForest(raw, inlineConv(p)));
      return block(`<div class="diagram boxed" data-dg="${id}"></div>`);
    }
    case "tikzpicture": {
      const opts=p.readOpt(true)||p.readOpt()||""; const raw=p.readEnv(env);
      const id=newDiagram(p, {kind:"tikz", opts:parseKV(opts), ops:parseTikz(raw, inlineConv(p))});
      return block(`<div class="diagram tikz" data-dg="${id}"></div>`); // placed inline-left, as LaTeX would
    }
    case "itemize": case "enumerate": case "description": {
      p.readOpt(); const raw=p.readEnv(env);
      const items=splitTopCS(raw,"item").slice(1).map(it=>{ let lab=""; const m=it.match(/^\s*\[([^\]]*)\]/); if(m){ lab=convert(m[1],st,p.ctx,"inline"); it=it.slice(m[0].length); }
        return `<li>${lab?`<b>${lab}</b> `:""}${convert(it,st,p.ctx,"auto")}</li>`; }).join("");
      const tag=env==="enumerate"?"ol":"ul";
      return block(`<${tag} class="list">${items}</${tag}>`);
    }
    case "quote": case "quotation": return block(`<blockquote>${convert(p.readEnv(env),st,p.ctx,"auto")}</blockquote>`);
    case "center": case "flushleft": case "flushright": return block(`<div class="${env}">${convert(p.readEnv(env),st,p.ctx,"auto")}</div>`);
    case "figure": case "figure*": case "table": case "table*": case "minipage": { p.readOpt(); if(env==="minipage") p.readArg(); return block(`<div class="figure">${convert(p.readEnv(env),st,p.ctx,"auto")}</div>`); }
    case "tabular": case "tabular*": case "tabularx": {
      if(env!=="tabular") p.readArg(); p.readOpt(); const spec=p.readArg(); const raw=p.readEnv(env);
      const rows=raw.split(/\\\\(?:\[[^\]]*\])?/).map(r=>r.replace(/\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\})/g,"").trim()).filter(r=>r);
      const body=rows.map(r=>`<tr>${splitTop(r,"&").map(c=>`<td>${convert(c,st,p.ctx,"inline")}</td>`).join("")}</tr>`).join("");
      return block(`<table class="tabular">${body}</table>`);
    }
    case "equation": case "equation*": case "align": case "align*": case "gather": case "gather*": case "displaymath":
      return block(`<div class="mathdisplay">${mathToHtml(p.readEnv(env).replace(/\\\\/g," "),st,p.ctx)}</div>`);
    case "nodestream": {
      // a form for building an input stream: \begin{nodestream}[person=1/2/3, number=sg/pl] then one node per line,
      // "label: person=3, number=pl". The Python block that follows it on the page reads the form as stream_data.
      const o=p.readOpt()||""; const raw=p.readEnv(env);
      const tiers=splitTop(o).map(kv=>{ const [k,v]=kv.split("="); return {name:k.trim(), values:(v||"").split("/").map(x=>x.trim()).filter(Boolean)}; });
      const rows=raw.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{ const c=l.indexOf(":"); const label=(c<0?l:l.slice(0,c)).trim();
        const vals={}; if(c>=0) splitTop(l.slice(c+1)).forEach(kv=>{ const [k,v]=kv.split("="); if(k&&v) vals[k.trim()]=v.trim(); }); return {label, vals}; });
      return block(`<div class="nodeform" data-spec="${esc(JSON.stringify({tiers, rows}))}"></div>`);
    }
    case "comment": p.readEnv(env); return "";
    case "scope": return convert(p.readEnv(env),st,p.ctx,"auto");
    default: {
      st.warnings.push("unknown environment "+env);
      return block(`<div class="env-${esc(env)}">${convert(p.readEnv(env),st,p.ctx,"auto")}</div>`);
    }
  }
}

// a column holding a gloss never squeezes it (it widens, and may spill into the margin);
// other columns may shrink so their diagrams can scale down on small screens
const track=(html, fr)=>`minmax(${html.includes('class="glossblock"')?"max-content":"0"},${(+fr).toFixed(3)}fr)`;

/* ---------- expex examples ---------- */
function example(p, isPex, cs){
  const d=p.doc;
  if(cs && !cs.spaceAfter) p.readOpt(true); // expex options only when attached: \ex[…]; "\ex [CP …" is content
  const raw=p.readUntilCS("xe",["ex","pex"]);
  if(!d) return convert(raw,p.st,p.ctx,"auto");
  const n=++d.exCount;
  const ex={n, id:`${d.id}-ex${n}`, conns:[], noNum:false};
  const ctx={...p.ctx, ex, item:null};
  let body=""; const itemKinds=[]; // per item: is it nothing but one diagram?
  if(isPex){
    const parts=splitTopCS(raw,"a");
    const pre=parts.shift();
    const preHtml=convert(pre,p.st,ctx,"auto");
    if(preHtml.trim()) body+=`<div class="expre">${preHtml}</div>`;
    parts.forEach((part,k)=>{
      const letter=LETTERS[k]||"?";
      const item={num:n+letter, id:ex.id+letter};
      let src=part.replace(/^\[[^\]]*\]/,"");
      const {judg, rest}=splitJudg(src);
      const html=convert(rest,p.st,{...ctx,item},"auto");
      itemKinds.push(!judg && /^<div class="diagram[^"]*" data-dg="[^"]*"><\/div>$/.test(html.trim()));
      body+=`<div class="sub" id="${item.id}"><span class="l">${letter}.</span>${hfill(html,judg)}</div>`;
    });
  } else {
    const {judg, rest}=splitJudg(raw);
    body=hfill(convert(rest,p.st,ctx,"auto"), judg);
  }
  // a \pex whose items are all just diagrams is set as a row (it may run into the margin, and wraps only if it must)
  const row=isPex && itemKinds.length>0 && itemKinds.every(k=>k) && !/class="expre"/.test(body);
  if(ex.noNum){ d.exCount--; }
  const conns=ex.conns.length?` data-conns="${esc(JSON.stringify(ex.conns))}"`:"";
  d.examples++;
  return block(`<div class="ex${row?" row":""}"${ex.noNum?"":` id="${ex.id}"`}${conns}><span class="no">${ex.noNum?"":`(${n})`}</span><div class="exbody">${body}</div></div>`);
}

/* ---------- expex glosses:  \begingl \gla … // \glb … // \glft … // \endgl ---------- */
function gloss(p, raw){
  const lines={}; let pre="";
  const re=/\\(gla|glb|glc|glft)\b/g; let m, last=null, lastEnd=0;
  const segs=[];
  while((m=re.exec(raw))){ if(last===null) pre=raw.slice(0,m.index); else segs.push([last, raw.slice(lastEnd,m.index)]); last=m[1]; lastEnd=m.index+m[0].length; }
  if(last!==null) segs.push([last, raw.slice(lastEnd)]); else pre=raw;
  for(const [k,v] of segs) lines[k]=v.replace(/\/\/\s*$/,"").replace(/\/\/[\s\S]*$/,"").trim();
  const preHtml=convert(pre,p.st,p.ctx,"inline"); // usually just \dref{…}
  const words=s=>s?splitWords(s).map(w=>convert(w,p.st,p.ctx,"inline")):[];
  const a=words(lines.gla), b=words(lines.glb), c=words(lines.glc);
  const n=Math.max(a.length,b.length,c.length);
  let cols="";
  for(let k=0;k<n;k++) cols+=`<span class="w"><span class="o">${a[k]??""}</span>${b.length?`<span class="g">${b[k]??""}</span>`:""}${c.length?`<span class="g">${c[k]??""}</span>`:""}</span>`;
  const ft=lines.glft?`<div class="trans">${convert(lines.glft,p.st,p.ctx,"inline")}</div>`:"";
  return block(`<div class="glossblock">${preHtml}<div class="gloss">${cols}</div>${ft}</div>`);
}
function splitWords(s){
  const out=[]; let d=0, cur="";
  for(let j=0;j<s.length;j++){ const c=s[j];
    if(c==="\\"){ cur+=s.slice(j,j+2); j++; continue; }
    if(c==="{") d++; else if(c==="}") d--;
    if(/\s/.test(c) && d===0){ if(cur) out.push(cur); cur=""; continue; }
    cur+=c; }
  if(cur) out.push(cur);
  return out.map(w=> (w.startsWith("{")&&w.endsWith("}")&&!/^\{[^{}]*\}\{/.test(w)) ? w.slice(1,-1) : w);
}

/* =====================================================================================
 *  Diagram parsers (geometry happens later, in diagrams.js)
 * ===================================================================================== */

/* ---------- forest ---------- */
function parseForest(raw, conv){
  let s=raw.trim();
  let k=0, d=0;
  for(; k<s.length; k++){ const c=s[k]; if(c==="\\"){ k++; continue; } if(c==="{") d++; else if(c==="}") d--; else if(c==="[" && d===0) break; }
  const opts={};
  const pre=s.slice(0,k);
  const ft=pre.match(/for\s+tree\s*=\s*\{/);
  if(ft){ let j=ft.index+ft[0].length, dd=1, e=j; for(; e<pre.length; e++){ if(pre[e]==="{") dd++; else if(pre[e]==="}" && --dd===0) break; }
    const kv=parseKV(pre.slice(j,e));
    if(kv["s sep"]) opts.ssep=toPx(kv["s sep"],"pt"); if(kv["l sep"]) opts.lsep=toPx(kv["l sep"],"pt");
    if(kv["l"]) opts.lsep=Math.max(8,toPx(kv["l"],"pt")-20);
  }
  s=s.slice(k);
  let i=0;
  function node(){
    i++; let lab=""; const kids=[]; let dd=0;
    while(i<s.length){
      const c=s[i];
      if(c==="\\"){ lab+=s.slice(i,i+2); i+=2; continue; }
      if(c==="{"){ dd++; lab+=c; i++; continue; }
      if(c==="}"){ dd--; lab+=c; i++; continue; }
      if(dd===0 && c==="["){ kids.push(node()); continue; }
      if(dd===0 && c==="]"){ i++; break; }
      if(!kids.length) lab+=c;
      i++;
    }
    let content=lab, optsRaw="";
    const cut=topComma(lab);
    if(cut>=0){ content=lab.slice(0,cut); optsRaw=lab.slice(cut+1); }
    const o=parseKV(optsRaw);
    const html=conv(content.trim());
    return {html, kids, name:o.name||null, roof:!!(o.roof||o.triangle), draw:!!(o.draw||o.rectangle), circle:!!o.circle,
      edgeNone: o["no edge"]!==undefined||o["edge"]==="{draw=none}"||o["edge"]==="draw=none", opts:o};
  }
  const root=node();
  const tail=s.slice(i);
  return {kind:"forest", root, opts, ops:parseTikz(tail, conv)};
}
function topComma(s){ let d=0, math=false; for(let j=0;j<s.length;j++){ const c=s[j]; if(c==="\\"){ j++; continue; } if(c==="$") math=!math; else if(c==="{") d++; else if(c==="}") d--; else if(c===","&&d===0&&!math) return j; } return -1; }

/* qtree → forest bracket syntax */
function qtreeToForest(src){
  let i=0; while(/\s/.test(src[i]||"")) i++;
  if(src[i]!=="[") return {forest:"[ ]", used:i};
  let d=0, j=i; for(; j<src.length; j++){ if(src[j]==="\\"){ j++; continue; } if(src[j]==="[") d++; else if(src[j]==="]" && --d===0) break; }
  const body=src.slice(i,j+1);
  const f=body.replace(/\[\.(\S+)/g,"[$1").replace(/(\[[^\[\]]*?)\s+([^\s\[\]][^\[\]]*?)\s*(?=\])/g,(m,a,b)=>a+" ["+b+"]");
  return {forest:f, used:j+1};
}

/* ---------- \headchain{ C (you) [*T *Aux Vc]{should} [V]{eat} } ----------
 *  bare token       a head with no chain line
 *  [a *b c]{word}   a head chain: lines from each member meet under the starred member(s) (default: the
 *                   first); the bold word is pronounced there
 *  (word)           an ordinary word on the bottom line, set after the previous word                    */
function parseHeadchain(spec, conv){
  const seq=[]; let i=0; const s=spec;
  const readBal=(open,close)=>{ let d=0,j=i; for(; j<s.length; j++){ if(s[j]==="\\"){ j++; continue; } if(s[j]==="{"&&open!=="{") { let dd=1; j++; for(; j<s.length&&dd; j++){ if(s[j]==="{") dd++; else if(s[j]==="}") dd--; } j--; continue; } if(s[j]===open) d++; else if(s[j]===close && --d===0) break; } const t=s.slice(i+1,j); i=j+1; return t; };
  const readTok=()=>{ let d=0, j=i, math=false; for(; j<s.length; j++){ const c=s[j]; if(c==="\\"){ j++; continue; } if(c==="$") math=!math; else if(c==="{") d++; else if(c==="}") d--; else if(!math && d===0 && (/\s/.test(c)||c==="["||c==="("||c==="]")) break; } const t=s.slice(i,j); i=j; return t; };
  let chains=0;
  while(i<s.length){
    const c=s[i];
    if(/\s/.test(c)){ i++; continue; }
    if(c==="["){
      const inner=readBal("[","]"); const idx=chains++;
      while(/\s/.test(s[i]||"")) i++;
      let word=null; if(s[i]==="{"){ word=readBal("{","}"); }
      const members=splitWords(inner);
      members.forEach(mm=>{ const star=mm.startsWith("*"); seq.push({t:"head", html:conv(unbrace(star?mm.slice(1):mm)), chain:idx, star}); });
      seq.push({t:"chainword", chain:idx, html: word!==null?conv(word):null});
      continue;
    }
    if(c==="("){ const w=readBal("(",")"); seq.push({t:"word", html:conv(w)}); continue; }
    const tok=readTok(); if(tok) seq.push({t:"head", html:conv(unbrace(tok)), chain:null}); else i++;
  }
  return {kind:"headchain", seq};
}

/* ---------- TikZ subset ---------- */
function parseTikz(raw, conv){
  const ops=[]; let i=0; const s=raw;
  const ws=()=>{ while(i<s.length && /\s/.test(s[i])) i++; };
  while(i<s.length){
    ws(); if(i>=s.length) break;
    if(s.startsWith("\\begin{scope}",i)){
      i+=13; ws(); let o=""; if(s[i]==="["){ let d=0,j=i; for(; j<s.length; j++){ if(s[j]==="{")d++; else if(s[j]==="}")d--; else if(s[j]==="["&&d===0&&j===i){} else if(s[j]==="]"&&d===0) break; } o=s.slice(i+1,j); i=j+1; }
      // body up to matching \end{scope}
      let d=1, j=i; while(j<s.length){ const a=s.indexOf("\\begin{scope}",j), b=s.indexOf("\\end{scope}",j); if(b<0){ j=s.length; break; } if(a>=0&&a<b){ d++; j=a+13; continue; } if(--d===0){ j=b; break; } j=b+11; }
      const body=s.slice(i, j); i=j+11;
      ops.push({op:"scope", opts:parseKV(o), ops:parseTikz(body, conv)});
      continue;
    }
    const m=s.slice(i).match(/^\\(draw|path|fill|filldraw|node|coordinate|shade|clip)\b/);
    if(m){
      i+=m[0].length;
      // statement runs to ';' at depth 0
      let d=0, j=i; for(; j<s.length; j++){ const c=s[j]; if(c==="\\"){ j++; continue; } if(c==="{"||c==="["||c==="(") d++; else if(c==="}"||c==="]"||c===")") d--; else if(c===";"&&d===0) break; }
      const body=s.slice(i,j); i=j+1;
      const st=parsePathStmt(m[1], body, conv);
      if(st) ops.push(st);
      continue;
    }
    if(s[i]==="\\"){ // some other command (\tikzset{…}, \small …): skip it and any braced args
      i++; while(/[a-zA-Z@]/.test(s[i]||"")) i++; ws();
      while(s[i]==="{"||s[i]==="["){ const open=s[i], close=open==="{"?"}":"]"; let d=0,j=i; for(; j<s.length; j++){ if(s[j]===open) d++; else if(s[j]===close && --d===0) break; } i=j+1; ws(); }
      if(s[i]===";") i++;
      continue;
    }
    i++;
  }
  return ops;
}
function parsePathStmt(cmd, body, conv){
  let i=0; const s=body; const items=[]; let opts={};
  const ws=()=>{ while(i<s.length && /\s/.test(s[i])) i++; };
  const readBal=(open,close)=>{ let d=0,j=i; for(; j<s.length; j++){ const c=s[j]; if(c==="\\"){ j++; continue; } if(c==="{"&&open!=="{"){ let dd=1; j++; for(; j<s.length&&dd; j++){ if(s[j]==="{") dd++; else if(s[j]==="}") dd--; } j--; continue; } if(c===open) d++; else if(c===close && --d===0) break; } const t=s.slice(i+1,j); i=j+1; return t; };
  ws(); if(s[i]==="["){ opts=parseKV(readBal("[","]")); }
  if(cmd==="node"||cmd==="coordinate"){
    let name=null, at=null, text="", nopts={...opts};
    while(i<s.length){ ws(); const c=s[i];
      if(c==="("){ name=readBal("(",")").trim(); continue; }
      if(c==="["){ Object.assign(nopts, parseKV(readBal("[","]"))); continue; }
      if(s.startsWith("at",i)){ i+=2; ws(); if(s[i]==="(") at=parseCoord(readBal("(",")")); continue; }
      if(c==="{"){ text=readBal("{","}"); break; }
      i++;
    }
    return {op:"node", name, at, opts:nopts, html: cmd==="coordinate"?"":conv(text), coordinate:cmd==="coordinate"};
  }
  while(i<s.length){
    ws(); if(i>=s.length) break;
    const c=s[i];
    const rel=s.slice(i).match(/^(\+\+?)\s*(?=\()/); // ++(x,y) or + (x,y), spaces allowed
    if(rel){ i+=rel[0].length; items.push({t:"coord", rel:rel[1], c:parseCoord(readBal("(",")"))}); continue; }
    if(c==="("){ items.push({t:"coord", c:parseCoord(readBal("(",")"))}); continue; }
    if(s.startsWith("--",i)){ i+=2; ws(); if(s.startsWith("cycle",i)){ i+=5; items.push({t:"cycle"}); } else items.push({t:"line"}); continue; }
    if(s.startsWith("-|",i)){ i+=2; items.push({t:"hv"}); continue; }
    if(s.startsWith("|-",i)){ i+=2; items.push({t:"vh"}); continue; }
    if(/^to\b/.test(s.slice(i))){ i+=2; ws(); let o={}; if(s[i]==="[") o=parseKV(readBal("[","]")); items.push({t:"to", opts:o}); continue; }
    if(/^edge\b/.test(s.slice(i))){ i+=4; ws(); let o={}; if(s[i]==="[") o=parseKV(readBal("[","]")); items.push({t:"edge", opts:o}); continue; }
    if(/^rectangle\b/.test(s.slice(i))){ i+=9; items.push({t:"rect"}); continue; }
    if(/^(circle|ellipse)\b/.test(s.slice(i))){ const w=s.slice(i).match(/^(circle|ellipse)/)[0]; i+=w.length; ws(); let r="0.1";
      if(s[i]==="["){ const o=parseKV(readBal("[","]")); r=o.radius||o["x radius"]||r; } else if(s[i]==="("){ r=readBal("(",")").split(/\s+and\s+/)[0]; }
      items.push({t:"circle", r}); continue; }
    if(/^node\b/.test(s.slice(i))){ i+=4; let o={}, name=null; ws();
      while(s[i]==="["||s[i]==="("){ if(s[i]==="[") Object.assign(o,parseKV(readBal("[","]"))); else name=readBal("(",")"); ws(); }
      let text=""; if(s[i]==="{") text=readBal("{","}");
      items.push({t:"node", opts:o, name, html:conv(text)}); continue; }
    if(/^(controls|and|\.\.)/.test(s.slice(i))){ i+= s.startsWith("..",i)?2:(s.startsWith("controls",i)?8:3); items.push({t:"line"}); continue; }
    if(/^(grid|arc|sin|cos|parabola)\b/.test(s.slice(i))){ const w=s.slice(i).match(/^\w+/)[0]; i+=w.length; ws(); if(s[i]==="[") readBal("[","]"); if(s[i]==="(") readBal("(",")"); items.push({t:"line"}); continue; }
    i++;
  }
  return {op:"path", cmd, opts, items};
}
function parseCoord(t){
  t=t.trim();
  let shift={x:0,y:0};
  const sm=t.match(/^\[([^\]]*)\]\s*/);
  if(sm){ const o=parseKV(sm[1]); if(o.xshift) shift.x=toPx(o.xshift,"pt"); if(o.yshift) shift.y=toPx(o.yshift,"pt"); t=t.slice(sm[0].length); }
  const pol=t.match(/^(-?[\d.]+)\s*:\s*([-\d.]+\s*[a-z]*)$/);
  if(pol) return {kind:"xy", x:Math.cos(+pol[1]*Math.PI/180)*toPx(pol[2]), y:Math.sin(+pol[1]*Math.PI/180)*toPx(pol[2]), shift};
  const xy=splitTop(t,",");
  if(xy.length===2 && /^[-+\d.]/.test(xy[0]) && /^[-+\d.]/.test(xy[1])) return {kind:"xy", x:toPx(xy[0]), y:toPx(xy[1]), shift};
  const dot=t.lastIndexOf(".");
  // node.anchor (anchors are words or angles); node names may themselves contain dots rarely
  const anchors=/^(north|south|east|west|center|base|mid|text|north east|north west|south east|south west|mid east|mid west|base east|base west|-?\d+(\.\d+)?)$/;
  if(dot>0 && anchors.test(t.slice(dot+1).trim())) return {kind:"node", name:t.slice(0,dot).trim(), anchor:t.slice(dot+1).trim(), shift};
  return {kind:"node", name:t, anchor:null, shift};
}

/* =====================================================================================
 *  Documents
 * ===================================================================================== */
/* ---------- code: minted / lstlisting / verbatim blocks and \verb, \mintinline, \lstinline ----------
 * Pulled out before anything else, so their contents are never treated as LaTeX (Python's % and # survive). */
const LANGS={py:"python",python:"python",python3:"python",pycon:"python",js:"javascript",javascript:"javascript",text:"text",tex:"latex",latex:"latex",bash:"bash",sh:"bash"};
function extractCode(src, st){
  st.codes=st.codes||{}; let k=Object.keys(st.codes).length;
  const dedent=t=>{ let lines=t.replace(/\t/g,"    ").split("\n");
    while(lines.length && !lines[0].trim()) lines.shift(); while(lines.length && !lines[lines.length-1].trim()) lines.pop();
    const ind=Math.min(...lines.filter(l=>l.trim()).map(l=>l.match(/^ */)[0].length)); return lines.map(l=>l.slice(isFinite(ind)?ind:0)).join("\n"); };
  src=src.replace(/\\begin\{(minted|lstlisting|verbatim|Verbatim|code)\}(?:\[([^\]]*)\])?(?:\{([^}]*)\})?([\s\S]*?)\\end\{\1\}/g,(m,env,opt,lang,body)=>{
    if(env!=="minted"){ if(lang!==undefined) body="{"+lang+"}"+body; lang=undefined; }
    let L=lang||((opt||"").match(/language\s*=\s*([\w+]+)/i)||[])[1]||"text";
    const id="code"+(++k); st.codes[id]={lang:LANGS[L.toLowerCase()]||L.toLowerCase(), code:dedent(body)};
    return `\\codeblock{${id}}`; });
  src=src.replace(/\\(?:mintinline\{[^}]*\}|lstinline(?:\[[^\]]*\])?)\{([^}]*)\}|\\(?:verb|lstinline)\*?([^a-zA-Z\s{])([\s\S]*?)\2/g,(m,a,d,b)=>{
    const id="code"+(++k); st.codes[id]={inline:true, code:a!==undefined?a:b}; return `\\inlinecode{${id}}`; });
  return src;
}

function parseDocument(id, src, st, n){
  const meta=frontMatter(src);
  let body=src;
  const bd=body.indexOf("\\begin{document}"); if(bd>=0){ body=body.slice(bd+16); const ed=body.indexOf("\\end{document}"); if(ed>=0) body=body.slice(0,ed); }
  body=stripComments(extractCode(body, st));
  const doc={ id, n, meta, abstract:"", notes:[], fn:0, com:0, exCount:0, examples:0, sec:0, subsec:0, subsub:0, anon:0,
    sections:[], cites:[], lastHeading:null, html:"" };
  st.docs[id]=doc;
  doc.html=convert(body, st, {doc}, "block");
  doc.diagramCount=(doc.html.match(/class="diagram/g)||[]).length;
  return doc;
}

/* ---------- second pass: cross-references and citations ---------- */
function resolve(st, bib, docTitle){
  const fmtRef=(r, here)=>{
    const L = r.k!==undefined ? st.labels[r.k] : {doc:r.doc, kind:"ex", num:r.num, id:r.ex};
    if(!L){ st.warnings.push(`undefined reference "${r.k}"`); return {html:`<span class="unk" title="undefined label">??</span>`, num:"??", bad:true}; }
    const other = L.doc!==here;
    const chap = docTitle(L.doc);
    if(L.kind==="ex") return {num:L.num, attrs:`class="xref" data-ex="${L.id}"`, xdoc: other&&chap.n?` of Chapter ${chap.n}`:""};
    if(L.kind==="sec") return {num:(r.form==="Auto"?"Section ":r.form==="auto"?"section ":"")+(L.num||L.title), attrs:`class="xref" data-go="${L.doc}" data-to="${L.id}"`, xdoc:"", name:L.title};
    return {num:(r.form==="Auto"?"Chapter ":r.form==="auto"?"chapter ":"")+chap.n, attrs:`class="xref" data-go="${L.doc}"`, xdoc:"", name:chap.title};
  };
  const reRef=new RegExp(`(\\()?${REF}(.*?)${REF}([a-z]{0,3}(?:[–-][a-z]{1,3})?)(\\))?`,"g");
  for(const d of Object.values(st.docs)){
    const fix = html => html
      .replace(reRef,(m,lp,json,sfx,rp)=>{
        const r=JSON.parse(json); const f=fmtRef(r,d.id);
        if(f.bad) return (lp||"")+f.html+(sfx||"")+(rp||"");
        if(r.form==="name") return `<a ${f.attrs}>${f.name||f.num}</a>`;
        if(r.form==="text") return `${lp||""}<a ${f.attrs}>${r.text}</a>${sfx||""}${rp||""}`;
        if(lp && rp) return `<a ${f.attrs}>(${f.num}${sfx})${f.xdoc}</a>`;
        return `${lp||""}<a ${f.attrs}>${f.num}${sfx}${f.xdoc}</a>${rp||""}`;
      })
      .replace(new RegExp(`${CITE}(.*?)${CITE}`,"g"),(m,json)=>citeHtml(JSON.parse(json), bib, st));
    d.html=fix(d.html); d.abstract=fix(d.abstract);
    d.notes.forEach(n=>n.html=fix(n.html));
    for(const k of Object.keys(st.diagrams)){ /* diagram labels may hold refs too */ }
  }
  const fixDg = o => { if(!o||typeof o!=="object") return; for(const k in o){ if(typeof o[k]==="string" && (o[k].includes(REF)||o[k].includes(CITE))) o[k]=o[k].replace(reRef,(m,lp,json,sfx,rp)=>{ const f=fmtRef(JSON.parse(json),""); return (lp||"")+(f.num||"??")+(sfx||"")+(rp||""); }).replace(new RegExp(`${CITE}(.*?)${CITE}`,"g"),(m,json)=>citeHtml(JSON.parse(json),bib,st)); else fixDg(o[k]); } };
  fixDg(st.diagrams);
}

/* ---------- citations ---------- */
function citeHtml(c, bib, st){
  const parts=c.keys.map(k=>{
    const e=bib[k];
    if(!e){ st.warnings.push(`unknown citation "${k}"`); return {k, a:`<span class="unk">${esc(k)}</span>`, y:"?"}; }
    return {k, a:e.short, y:e.year};
  });
  const link=(k,t)=>`<a class="cite" data-bib="${esc(k)}">${t}</a>`;
  const post=c.post?(/^\d/.test(c.post)?`: ${c.post}`:`, ${c.post}`):"";
  const pre=c.pre?c.pre+" ":"";
  switch(c.form){
    case "p": return "("+pre+parts.map((x,j)=>link(x.k,`${x.a} ${x.y}`)+(j===parts.length-1?post:"")).join("; ")+")";
    case "alt": case "alp": return pre+parts.map((x,j)=>link(x.k,`${x.a} ${x.y}`)+(j===parts.length-1?post:"")).join("; ");
    case "author": return parts.map(x=>link(x.k,x.a)).join(", ");
    case "year": return parts.map(x=>link(x.k,x.y)).join(", ");
    case "yearpar": return "("+parts.map(x=>link(x.k,x.y)).join(", ")+post+")";
    default: { // natbib groups years by the same author: Chomsky (2000, 2001)
      const groups=[]; parts.forEach((x,j)=>{ const g=groups[groups.length-1]; if(g&&g.a===x.a) g.items.push(x); else groups.push({a:x.a, items:[x]}); });
      return groups.map((g,gi)=>`${link(g.items[0].k,g.a)} (${pre}${g.items.map((x,j)=>link(x.k,x.y)).join(", ")}${gi===groups.length-1?post:""})`).join(", "); }
  }
}

/* ---------- BibTeX ---------- */
function parseBib(src, st){
  const out={}; let i=0;
  while((i=src.indexOf("@",i))>=0){
    const m=src.slice(i).match(/^@(\w+)\s*\{\s*([^,\s]+)\s*,/);
    if(!m){ i++; continue; }
    const type=m[1].toLowerCase(); const key=m[2]; i+=m[0].length;
    if(type==="comment"||type==="string"||type==="preamble") continue;
    const fields={};
    while(i<src.length){
      while(/[\s,]/.test(src[i]||"")) i++;
      if(src[i]==="}"){ i++; break; }
      const f=src.slice(i).match(/^([\w-]+)\s*=\s*/); if(!f){ i++; continue; }
      i+=f[0].length; let v="";
      if(src[i]==="{"){ let d=0,j=i; for(; j<src.length; j++){ if(src[j]==="\\"){ j++; continue; } if(src[j]==="{") d++; else if(src[j]==="}" && --d===0) break; } v=src.slice(i+1,j); i=j+1; }
      else if(src[i]==='"'){ let j=i+1; for(; j<src.length && src[j]!=='"'; j++){ if(src[j]==="\\") j++; } v=src.slice(i+1,j); i=j+1; }
      else { const w=src.slice(i).match(/^[^,}\s]+/); v=w?w[0]:""; i+=v.length; }
      fields[f[1].toLowerCase()]=v.replace(/\s+/g," ").trim();
    }
    const T=v=>v?convert(v,st,{},"inline"):"";
    const people=v=>v?v.split(/\s+and\s+/).map(a=>{ a=a.trim(); if(a.includes(",")){ const [l,f]=a.split(",").map(x=>x.trim()); return {last:l,first:f}; } const ws=a.split(/\s+/); return {last:ws.pop(), first:ws.join(" ")}; }):[];
    const authors=people(fields.author), editors=people(fields.editor);
    const names=(authors.length?authors:editors);
    const ln=x=>T(x.last.replace(/^\{|\}$/g,""));
    const short = names.length===0?T(fields.key||key): names.length===1?ln(names[0]): names.length===2?`${ln(names[0])} &amp; ${ln(names[1])}`:`${ln(names[0])} et al.`;
    const full = list => list.map((x,j)=> j===0 ? `${ln(x)}${x.first?", "+T(x.first):""}` : `${x.first?T(x.first)+" ":""}${ln(x)}`).join(list.length===2?" &amp; ":", ").replace(/, ([^,]*)$/, list.length>2?", &amp; $1":", $1");
    const year=T(fields.year||"n.d.");
    let html=`${full(names)}${!authors.length&&editors.length?" (ed"+(editors.length>1?"s":"")+".)":""}. ${year}. `;
    const title=T(fields.title);
    const pages=fields.pages?T(fields.pages).replace(/-+/,"–"):"";
    switch(type){
      case "article": html+=`${title}. <i>${T(fields.journal)}</i>${fields.volume?" "+T(fields.volume):""}${fields.number?`(${T(fields.number)})`:""}${pages?": "+pages:""}.`; break;
      case "book": html+=`<i>${title}</i>. ${fields.address?T(fields.address)+": ":""}${T(fields.publisher)}.`; break;
      case "incollection": case "inproceedings": case "inbook": {
        const en=editors.map(x=>`${x.first?T(x.first)+" ":""}${ln(x)}`);
        const ed=en.length?`In ${en.length>1?en.slice(0,-1).join(", ")+" &amp; "+en[en.length-1]:en[0]} (ed${en.length>1?"s":""}.), `:"In ";
        html+=`${title}. ${ed}<i>${T(fields.booktitle)}</i>${pages?", "+pages:""}. ${fields.address?T(fields.address)+": ":""}${T(fields.publisher||"")}${fields.publisher?".":""}`; break; }
      case "phdthesis": html+=`<i>${title}</i>. Doctoral dissertation, ${T(fields.school)}.`; break;
      case "mastersthesis": html+=`<i>${title}</i>. Master’s thesis, ${T(fields.school)}.`; break;
      default: html+=`${title}.${fields.note?" "+T(fields.note)+".":""}${fields.howpublished?" "+T(fields.howpublished)+".":""}`;
    }
    out[key]={key, type, short, year, html, sortKey:(names[0]?names[0].last:key).replace(/[{}\\'"`^~]/g,"").toLowerCase()+" "+year};
  }
  return out;
}

window.LaTeX={ makeState, parseMacros, parseDocument, parseBib, resolve, convert, frontMatter, stripComments, toPx, esc,
  MARK:{PAR,BS,BE,CITE,REF,HF} };
})();
