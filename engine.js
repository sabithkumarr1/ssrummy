// Sathya's Rummy — server-side 13-card Indian Rummy engine (pure functions).
// All functions take an explicit wildRank `w` (0 = none). Cards: {id,r,s,p}.
'use strict';
let UID = 0;
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function buildDeck(){
  const d=[];
  for(let k=0;k<2;k++){
    for(let s=0;s<4;s++)for(let r=1;r<=13;r++)d.push({id:++UID,r,s,p:false});
    d.push({id:++UID,r:0,s:-1,p:true});
  }
  return shuffle(d);
}
function isJok(c,w){return c.p||c.r===w;}
function pts(c,w){return isJok(c,w)?0:(c.r===1||c.r>=10)?10:c.r;}
function subsets(arr){const out=[[]];for(const x of arr){const n=out.length;for(let i=0;i<n;i++)out.push(out[i].concat([x]));}return out;}

function deadwood(cards,w){
  const jokN=cards.filter(c=>isJok(c,w)).length;
  const nat=cards.filter(c=>!isJok(c,w)).slice().sort((a,b)=>a.s-b.s||a.r-b.r||a.id-b.id);
  const n=nat.length; if(!n)return 0;
  const FULL=(1<<n)-1; const memo=new Map();
  function rec(mask,j){
    if(mask===FULL)return 0;
    const key=mask*16+j; const got=memo.get(key); if(got!==undefined)return got;
    let i=0; while((mask>>i)&1)i++;
    const c=nat[i];
    let best=pts(c,w)+rec(mask|(1<<i),j);
    const seen={}; const cands=[];
    for(let k=0;k<n;k++){if(k===i||((mask>>k)&1))continue;const d=nat[k];if(d.r===c.r&&d.s!==c.s&&!seen[d.s]){seen[d.s]=1;cands.push(k);}}
    for(const sub of subsets(cands)){
      const cnt=1+sub.length;
      for(let g=0;g<=Math.min(j,4-cnt);g++){
        if(cnt+g<3||cnt+g>4)continue;
        let m=1<<i; for(const x of sub)m|=1<<x;
        const v=rec(mask|m,j-g); if(v<best)best=v;
      }
    }
    const rmap={};
    for(let k=0;k<n;k++){if(k===i||((mask>>k)&1))continue;const d=nat[k];if(d.s===c.s){if(rmap[d.r]===undefined)rmap[d.r]=k;if(d.r===1&&rmap[14]===undefined)rmap[14]=k;}}
    const aliases=(c.r===1)?[1,14]:[c.r];
    for(const cr of aliases){
      for(let lo=Math.max(1,cr-4);lo<=cr;lo++){
        for(let len=3;len<=5;len++){
          const hi=lo+len-1; if(hi>14||cr>hi)continue; if(lo===1&&hi>=14)continue;
          let m=1<<i,g=0;
          for(let rr=lo;rr<=hi;rr++){if(rr===cr)continue;const idx=rmap[rr];if(idx!==undefined&&!((m>>idx)&1))m|=1<<idx;else g++;}
          if(g<=j){const v=rec(mask|m,j-g); if(v<best)best=v;}
        }
      }
    }
    memo.set(key,best); return best;
  }
  return rec(0,jokN);
}
function pureSeqs(cards,w){
  const nat=cards.filter(c=>!c.p); const res=[];
  for(let s=0;s<4;s++){
    const byR={}; for(const c of nat){if(c.s===s&&!byR[c.r])byR[c.r]=c;}
    if(byR[1])byR[14]=byR[1];
    for(let lo=1;lo<=12;lo++){for(let len=3;len<=5;len++){
      const hi=lo+len-1; if(hi>14||(lo===1&&hi>=14))continue;
      const use=[]; let ok=true;
      for(let r=lo;r<=hi;r++){if(byR[r])use.push(byR[r]);else{ok=false;break;}}
      if(ok)res.push(use);
    }}
  }
  return res;
}
function allSeqs(cards,w){
  const jokN=cards.filter(c=>isJok(c,w)).length; const nat=cards.filter(c=>!isJok(c,w)); const res=[];
  for(let s=0;s<4;s++){
    const byR={}; for(const c of nat){if(c.s===s&&!byR[c.r])byR[c.r]=c;}
    if(byR[1])byR[14]=byR[1];
    for(let lo=1;lo<=12;lo++){for(let len=3;len<=5;len++){
      const hi=lo+len-1; if(hi>14||(lo===1&&hi>=14))continue;
      const use=[]; let g=0;
      for(let r=lo;r<=hi;r++){if(byR[r])use.push(byR[r]);else g++;}
      if(use.length>=1&&g<=jokN)res.push({use,g});
    }}
  }
  return res;
}
function removeCards(cards,used,jokCount,w){
  const ids=new Set(used.map(c=>c.id)); let g=jokCount||0;
  return cards.filter(c=>{if(ids.has(c.id))return false;if(g>0&&isJok(c,w)){g--;return false;}return true;});
}
function handScore(cards,w){
  let best=cards.reduce((a,c)=>a+pts(c,w),0);
  for(const P of pureSeqs(cards,w)){const rest=removeCards(cards,P,0,w);const v=deadwood(rest,w);if(v<best)best=v;}
  return Math.min(80,best);
}
function checkDeclare(cards,w){
  if(deadwood(cards,w)!==0)return false;
  for(const P1 of pureSeqs(cards,w)){
    const r1=removeCards(cards,P1,0,w);
    for(const P2 of allSeqs(r1,w)){const r2=removeCards(r1,P2.use,P2.g,w);if(deadwood(r2,w)===0)return true;}
  }
  return false;
}
// ---- group validation for a submitted declaration ----
function setCheck(nats,jk){
  if(!nats.length)return false;
  const r=nats[0].r; for(const c of nats)if(c.r!==r)return false;
  const suits=new Set(nats.map(c=>c.s)); if(suits.size!==nats.length)return false;
  const tot=nats.length+jk; return tot>=3&&tot<=4;
}
function seqCheck(nats,jk){
  if(!nats.length)return false;
  const s=nats[0].s; for(const c of nats)if(c.s!==s)return false;
  const aces=nats.filter(c=>c.r===1); if(aces.length>1)return false;
  const others=nats.filter(c=>c.r!==1).map(c=>c.r);
  const variants=aces.length?[others.concat([1]),others.concat([14])]:[others];
  for(const ranks of variants){
    const st=[...ranks].sort((a,b)=>a-b); let dup=false;
    for(let i=1;i<st.length;i++)if(st[i]===st[i-1])dup=true;
    if(dup)continue;
    const lo=st[0],hi=st[st.length-1]; const gaps=hi-lo+1-st.length;
    if(gaps>jk)continue; const extra=jk-gaps; const space=(lo-1)+(14-hi);
    if(extra<=space)return true;
  }
  return false;
}
function groupInfo(cards,w){
  const out={valid:false,seq:false,pure:false,set:false};
  if(!cards.length)return out;
  const printed=cards.filter(c=>c.p);
  const wilds=cards.filter(c=>!c.p&&c.r===w);
  const plain=cards.filter(c=>!c.p&&c.r!==w);
  if(plain.length===0&&wilds.length===0){out.valid=true;return out;}
  if(cards.length<3){if(plain.length===0)out.valid=true;return out;}
  for(let m=0;m<(1<<wilds.length);m++){
    const natW=wilds.filter((_,i)=>(m>>i)&1);
    const jk=printed.length+(wilds.length-natW.length);
    const nats=plain.concat(natW);
    if(nats.length===0){out.valid=true;continue;}
    if(setCheck(nats,jk))out.valid=out.set=true;
    if(seqCheck(nats,jk)){out.valid=out.seq=true;if(jk===0)out.pure=true;}
  }
  if(!out.valid&&plain.length===0)out.valid=true;
  return out;
}
// groups: array of arrays of card objects (all 13 cards). Returns true if a valid show.
function validateDeclare(groups,w){
  let seqs=0,pures=0,count=0;
  for(const g of groups){
    if(!g.length)continue; count+=g.length;
    const info=groupInfo(g,w); if(!info.valid)return false;
    if(info.seq)seqs++; if(info.pure)pures++;
  }
  return count===13 && seqs>=2 && pures>=1;
}
function botChooseDiscard(hand,w,forbidId){
  let best=null,bd=Infinity,bp=-1;
  const nonJok=hand.filter(c=>!isJok(c,w)&&c.id!==forbidId);
  const pool=nonJok.length?nonJok:hand.filter(c=>c.id!==forbidId);
  for(const c of pool){const rest=hand.filter(x=>x.id!==c.id);const d=deadwood(rest,w);const P=pts(c,w);if(d<bd||(d===bd&&P>bp)){bd=d;bp=P;best=c;}}
  return best||hand[hand.length-1];
}
function cardName(c){const S=['♠','♥','♦','♣'];const R=['','A','2','3','4','5','6','7','8','9','10','J','Q','K'];return c.p?'Joker':R[c.r]+S[c.s];}

// ---- decompose a valid 13-card hand into meld groups (for display / auto-declare) ----
function allMelds(cards,w){
  const jokN=cards.filter(c=>isJok(c,w)).length; const nat=cards.filter(c=>!isJok(c,w)); const melds=[];
  for(let s=0;s<4;s++){ const byR={}; for(const c of nat)if(c.s===s&&!byR[c.r])byR[c.r]=c;
    for(let lo=1;lo<=13;lo++)for(let len=3;len<=5;len++){ const hi=lo+len-1; if(hi>14||(lo===1&&hi>=14))continue;
      const use=[];let need=0; for(let r=lo;r<=hi;r++){const rr=(r===14)?1:r; if(byR[rr])use.push(byR[rr]); else need++;}
      if(use.length>=1&&need<=jokN)melds.push({nat:use.map(c=>c.id),j:need,pri:(need===0?0:1),len:use.length+need}); } }
  const byRank={}; for(const c of nat){(byRank[c.r]=byRank[c.r]||[]).push(c);}
  for(const r in byRank){ const bySuit={}; for(const c of byRank[r])if(!bySuit[c.s])bySuit[c.s]=c; const distinct=Object.keys(bySuit).map(k=>bySuit[k]);
    for(const sub of subsets(distinct)){ if(!sub.length)continue; for(let j=0;j<=jokN;j++){ const tot=sub.length+j; if(tot>=3&&tot<=4&&sub.length+j<=4)melds.push({nat:sub.map(c=>c.id),j,pri:2,len:tot}); } } }
  melds.sort((a,b)=>a.pri-b.pri||b.len-a.len); return melds;
}
function decompose(cards,w){
  const melds=allMelds(cards,w); const natIds=cards.filter(c=>!isJok(c,w)).map(c=>c.id); const jokTotal=cards.filter(c=>isJok(c,w)).length;
  const usedNat=new Set(); let usedJok=0; const chosen=[];
  function firstUncovered(){ for(const id of natIds)if(!usedNat.has(id))return id; return null; }
  function rec(){ const f=firstUncovered(); if(f===null)return usedJok===jokTotal;
    for(const m of melds){ if(m.nat.indexOf(f)<0)continue; let clash=false; for(const id of m.nat)if(usedNat.has(id)){clash=true;break;} if(clash||usedJok+m.j>jokTotal)continue;
      for(const id of m.nat)usedNat.add(id); usedJok+=m.j; chosen.push(m); if(rec())return true; chosen.pop(); usedJok-=m.j; for(const id of m.nat)usedNat.delete(id); }
    return false; }
  if(!rec())return null;
  const byId={}; for(const c of cards)byId[c.id]=c; const jokPool=cards.filter(c=>isJok(c,w)); let ji=0;
  return chosen.map(m=>{ const g=m.nat.map(id=>byId[id]); for(let k=0;k<m.j;k++)g.push(jokPool[ji++]); return g; });
}

const API = { buildDeck, shuffle, isJok, pts, deadwood, handScore, checkDeclare, validateDeclare, groupInfo, botChooseDiscard, cardName, decompose };
if(typeof module!=='undefined' && module.exports) module.exports = API;
if(typeof window!=='undefined') window.RummyEngine = API;
