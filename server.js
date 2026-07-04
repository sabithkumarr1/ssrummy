// Sathya's Rummy — backend with real multiplayer tables (virtual coins).
// Run:  node server.js   then open  http://localhost:3000
// No external dependencies. Database is db.json.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./engine.js');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const SIGNUP_SECRET = 'ssrummy';
const ADMIN = { username: 'sathya', password: 'Dev@ss' };

const TURN_MS = +(process.env.TURN_MS || 45000);        // per-turn time limit
const DEAL_RESULT_MS = +(process.env.DEAL_MS || 7000);  // pause to show each deal result before next deal
const BOT_NAMES = ['Kumar', 'Priya', 'Ravi', 'Anitha', 'Vijay'];

// ---------- db ----------
function loadDB(){ try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch(e){ return {users:{},games:{}}; } }
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
let db = loadDB(); if(!db.users) db.users={}; if(!db.games) db.games={}; saveDB();

const sessions = {};        // token -> phone
const adminSessions = {};   // token -> true
const tables = {};          // id -> table (in memory; live game state)
function newToken(){ return crypto.randomBytes(16).toString('hex'); }
function shortId(){ return crypto.randomBytes(4).toString('hex'); }

// ---------- http helpers ----------
function send(res, code, obj){ const b=JSON.stringify(obj); res.writeHead(code,{'Content-Type':'application/json'}); res.end(b); }
function readBody(req){ return new Promise(r=>{ let d=''; req.on('data',c=>{d+=c; if(d.length>2e6) req.destroy();}); req.on('end',()=>{ try{ r(d?JSON.parse(d):{}); }catch(e){ r({}); } }); }); }
function userPublic(u){ return { phone:u.phone, name:u.name||u.phone, wallet:u.wallet }; }
function authUser(b){ const p=sessions[b.token]; return p?db.users[p]:null; }
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};
function serveStatic(req,res){ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; if(p==='/engine.js'){ return fs.readFile(path.join(__dirname,'engine.js'),(e,d)=>{ if(e){res.writeHead(404);return res.end('no');} res.writeHead(200,{'Content-Type':'application/javascript'}); res.end(d); }); } const file=path.join(PUBLIC,path.normalize(p)); if(!file.startsWith(PUBLIC)){res.writeHead(403);return res.end('no');} fs.readFile(file,(e,d)=>{ if(e){res.writeHead(404);return res.end('not found');} res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'text/plain'}); res.end(d); }); }

// ===================== GAME (server-authoritative) =====================
function logT(t,m){ t.log=m; }
function humanSeats(t){ return t.seats.filter(s=>!s.isBot); }
function aliveSeats(t){ return t.seats.filter(s=>!s.elim); }
function curSeat(t){ return t.seats[t.turnIdx]; }

function startDeal(t){
  t.round = (t.round||0)+1;
  const deck = E.buildDeck();
  let wc = deck.pop(); while(wc.p){ deck.push(wc); E.shuffle(deck); wc=deck.pop(); }
  t.wildCard = wc; t.wildRank = wc.r;
  for(const s of t.seats){ if(s.elim) continue; s.dropped=false; s.miss=0; s.turns=0; s.roundPts=null; s.hand=[]; for(let i=0;i<13;i++) s.hand.push(deck.pop()); }
  t.open=[deck.pop()]; t.closed=deck;
  // dealer rotation among alive
  do{ t.dealer=((t.dealer==null?-1:t.dealer)+1)%t.seats.length; }while(t.seats[t.dealer].elim);
  t.turnIdx=t.dealer; do{ t.turnIdx=(t.turnIdx+1)%t.seats.length; }while(t.seats[t.turnIdx].elim);
  t.phase='draw'; t.drewOpenId=null; t.roundActive=true; t.turnTs=Date.now();
  t.lastResult=null;
  logT(t,'Round '+t.round+' — wild joker '+E.cardName(t.wildCard)+'. '+curSeat(t).name+"'s turn.");
  tickBots(t);
}
function drawClosed(t){ if(!t.closed.length){ const top=t.open.pop(); t.closed=E.shuffle(t.open); t.open=top?[top]:[]; } return t.closed.pop(); }
function nextTurn(t){
  curSeat(t).turns++;
  do{ t.turnIdx=(t.turnIdx+1)%t.seats.length; }while(t.seats[t.turnIdx].elim||t.seats[t.turnIdx].dropped);
  t.phase='draw'; t.drewOpenId=null; t.turnTs=Date.now();
}
function doDrop(t,s,pen){
  s.dropped=true; s.roundPts=pen; logT(t, s.name+' dropped ('+pen+').');
  const live=t.seats.filter(x=>!x.elim&&!x.dropped);
  if(live.length===1){ endDeal(t, t.seats.indexOf(live[0]), null); }
  else nextTurn(t);
}

function botMove(t){
  const s=curSeat(t); if(!s.isBot) return;
  const w=t.wildRank; const d0=E.deadwood(s.hand,w);
  if(s.turns===0 && d0>=58 && Math.random()<0.5){ doDrop(t,s,20); return; }
  const top=t.open[t.open.length-1]; let fromOpen=false;
  if(top){ const h2=s.hand.concat([top]); let d1=Infinity; for(const c of s.hand){ const rest=h2.filter(x=>x.id!==c.id); const d=E.deadwood(rest,w); if(d<d1)d1=d; } if(d1<d0) fromOpen=true; }
  let drawn = fromOpen ? t.open.pop() : drawClosed(t);
  if(!drawn){ endDeal(t,null,null); return; }
  s.hand.push(drawn);
  const forbid = fromOpen ? drawn.id : null;
  // declare?
  for(const c of s.hand){ if(c.id===forbid) continue; const rest=s.hand.filter(x=>x.id!==c.id); if(E.deadwood(rest,w)===0 && E.checkDeclare(rest,w)){ s.hand=rest; logT(t,s.name+' declares!'); endDeal(t, t.turnIdx, null); return; } }
  const disc=E.botChooseDiscard(s.hand,w,forbid);
  s.hand=s.hand.filter(x=>x.id!==disc.id); t.open.push(disc);
  logT(t, s.name+' drew '+(fromOpen?'from open':'from closed')+' and discarded '+E.cardName(disc)+'.');
  nextTurn(t);
}
function tickBots(t){
  let guard=0;
  while(t.roundActive && curSeat(t).isBot && guard<200){ guard++; botMove(t); }
}
function autoMiss(t){
  const s=curSeat(t); if(s.isBot) return;
  s.miss=(s.miss||0);
  if(s.turns===0 && t.phase==='draw'){ doDrop(t,s,20); tickBots(t); return; }
  if(s.miss>=3){ doDrop(t,s,40); tickBots(t); return; }
  s.miss++;
  // auto pick + discard same
  let drew=null;
  if(t.phase==='draw'){ const c=drawClosed(t); if(!c){ endDeal(t,null,null); return; } s.hand.push(c); drew=c.id; t.phase='discard'; t.drewOpenId=null; }
  const w=t.wildRank;
  let target=null;
  if(drew){ target=s.hand.find(c=>c.id===drew); }
  if(!target){ let pool=s.hand.filter(c=>!E.isJok(c,w)); if(!pool.length)pool=s.hand; pool.sort((a,b)=>E.pts(b,w)-E.pts(a,w)); target=pool[0]; }
  s.hand=s.hand.filter(c=>c.id!==target.id); t.open.push(target);
  logT(t, s.name+' missed the turn (auto '+E.cardName(target)+').');
  nextTurn(t); tickBots(t);
}
function endDeal(t, winnerIdx, invalidIdx){
  t.roundActive=false;
  const w=t.wildRank;
  const rows=[];
  t.seats.forEach((s,i)=>{
    if(s.elim && s.roundPts==null){ rows.push({name:s.name,pts:null,total:s.score,elim:true,isBot:s.isBot}); return; }
    let rp;
    if(s.dropped) rp=s.roundPts;
    else if(i===winnerIdx) rp=0;
    else if(i===invalidIdx) rp=80;
    else rp=E.handScore(s.hand,w);
    s.roundPts=rp; s.score+=rp;
    rows.push({name:s.name,pts:rp,total:s.score,elim:false,isBot:s.isBot,cards:s.hand.map(c=>({r:c.r,s:c.s,p:c.p})),win:i===winnerIdx});
  });
  for(const s of t.seats){ if(!s.elim && s.score>=101){ s.elim=true; rows.find(r=>r.name===s.name).elim=true; } }
  const winnerName = winnerIdx!=null ? t.seats[winnerIdx].name : (invalidIdx!=null? t.seats[invalidIdx].name+' (invalid)' : 'Draw');
  t.lastResult = { round:t.round, wild:E.cardName(t.wildCard), winnerName, rows, ts:Date.now() };
  t.dealOverTs = Date.now();
  const live = t.seats.filter(s=>!s.elim);
  if(live.length<=1){ finishPool(t, live[0]||null); }
}
function finishPool(t, champ){
  t.status='ended';
  t.champ = champ ? champ.name : null;
  let credit=0;
  if(champ && !champ.isBot){ const u=db.users[champ.phone]; if(u){ u.wallet += t.pot; credit=t.pot; } }
  t.creditPaid = credit;
  saveDB();
  logT(t, 'Pool over — '+(champ?champ.name:'nobody')+' wins.');
}

function humanAction(t, s, seatIdx, body){
  const w=t.wildRank;
  const act=body.action;
  if(t.turnIdx!==seatIdx || !t.roundActive) return { error:'Not your turn' };
  s.miss=0;
  if(act==='drawClosed'){ if(t.phase!=='draw') return {error:'Already drew'}; const c=drawClosed(t); if(!c){endDeal(t,null,null);return{ok:1};} s.hand.push(c); t.phase='discard'; t.drewOpenId=null; return {ok:1}; }
  if(act==='drawOpen'){ if(t.phase!=='draw'||!t.open.length) return {error:'Cannot draw open'}; const c=t.open.pop(); s.hand.push(c); t.phase='discard'; t.drewOpenId=c.id; return {ok:1}; }
  if(act==='discard'){ if(t.phase!=='discard') return {error:'Draw first'}; const c=s.hand.find(x=>x.id===body.cardId); if(!c) return {error:'No such card'}; s.hand=s.hand.filter(x=>x.id!==body.cardId); t.open.push(c); nextTurn(t); tickBots(t); return {ok:1}; }
  if(act==='drop'){ if(t.phase!=='draw') return {error:'Drop only before drawing'}; doDrop(t,s,s.turns===0?20:40); tickBots(t); return {ok:1}; }
  if(act==='declare'){
    if(t.phase!=='discard') return {error:'Draw your 14th card first'};
    const finishId=body.finishCardId; const fc=s.hand.find(x=>x.id===finishId); if(!fc) return {error:'Pick a finish card'};
    const byId={}; s.hand.forEach(c=>byId[c.id]=c);
    let groups=(body.groups||[]).map(g=>g.map(id=>byId[id]).filter(Boolean).filter(c=>c.id!==finishId));
    const used=new Set(); groups.forEach(g=>g.forEach(c=>used.add(c.id))); used.add(finishId);
    for(const c of s.hand){ if(!used.has(c.id)) groups.push([c]); }
    const thirteen=s.hand.filter(c=>c.id!==finishId);
    if(thirteen.length===13 && E.validateDeclare(groups, w)){
      s.hand=thirteen; t.open.push(fc);
      logT(t, s.name+' declared a valid show!'); endDeal(t, seatIdx, null); tickBots(t); return {ok:1};
    } else {
      s.dropped=true; s.roundPts=80; t.open.push(fc);
      logT(t, s.name+' declared wrong — 80 points, out of this deal.');
      const live=t.seats.filter(x=>!x.elim&&!x.dropped);
      if(live.length===1) endDeal(t, t.seats.indexOf(live[0]), null); else { nextTurn(t); tickBots(t); }
      return {ok:1, invalid:true};
    }
  }
  return { error:'Unknown action' };
}

function tick(t){
  if(t.status==='playing' && t.roundActive){
    if(!curSeat(t).isBot && Date.now()-t.turnTs>TURN_MS){ autoMiss(t); }
    else tickBots(t);
  } else if(t.status==='playing' && !t.roundActive){
    if(Date.now()-(t.dealOverTs||0) > DEAL_RESULT_MS){ startDeal(t); }
  }
}

function stateFor(t, phone){
  const meIdx=t.seats.findIndex(s=>s.phone===phone && !s.isBot);
  const me = meIdx>=0 ? t.seats[meIdx] : null;
  const players = t.seats.map((s,i)=>({ name:s.name, score:s.score, elim:!!s.elim, dropped:!!s.dropped, isBot:!!s.isBot, count:s.hand?s.hand.length:0, isTurn:(t.roundActive&&i===t.turnIdx), isYou:(s===me) }));
  const cur=curSeat(t);
  return {
    id:t.id, name:t.name, entry:t.entry, seatsMax:t.maxSeats, status:t.status,
    round:t.round||0, wild:t.wildCard||null, phase:t.phase, message:t.log||'',
    turnName: cur?cur.name:'', yourTurn: !!(me && t.roundActive && cur===me),
    roundActive: !!t.roundActive,
    closedCount: t.closed?t.closed.length:0,
    openTop: t.open&&t.open.length?t.open[t.open.length-1]:null,
    drewOpenId: t.drewOpenId||null,
    you: me?{ seat:meIdx, hand:me.hand||[], score:me.score, elim:!!me.elim, dropped:!!me.dropped, phase:t.phase }:null,
    players,
    result: t.lastResult||null,
    pool: t.pot||0,
    ended: t.status==='ended' ? { champ:t.champ, credit:t.creditPaid||0, mine:(me && t.champ===me.name) } : null,
    host: t.hostPhone===phone,
    waitingMembers: t.status==='waiting'? t.seats.map(s=>s.name):null,
    joinable: t.status==='waiting'
  };
}

async function api(req,res){
  const url=req.url.split('?')[0]; const body=await readBody(req);

  if(url==='/api/signup' && req.method==='POST'){
    const {phone,password,name,secret}=body;
    if(secret!==SIGNUP_SECRET) return send(res,403,{error:'Invalid secret key'});
    if(!phone||!password) return send(res,400,{error:'Phone and password required'});
    if(db.users[phone]) return send(res,409,{error:'Account already exists'});
    db.users[phone]={phone,password,name:name||phone,wallet:0,created:Date.now()}; saveDB();
    const token=newToken(); sessions[token]=phone;
    return send(res,200,{token,user:userPublic(db.users[phone])});
  }
  if(url==='/api/login' && req.method==='POST'){
    const u=db.users[body.phone];
    if(!u||u.password!==body.password) return send(res,401,{error:'Wrong phone or password'});
    const token=newToken(); sessions[token]=body.phone;
    return send(res,200,{token,user:userPublic(u)});
  }
  if(url==='/api/me' && req.method==='POST'){
    const u=authUser(body); if(!u) return send(res,401,{error:'Not logged in'});
    return send(res,200,{user:userPublic(u)});
  }

  if(url==='/api/admin/login' && req.method==='POST'){
    if(body.username===ADMIN.username && body.password===ADMIN.password){ const token=newToken(); adminSessions[token]=true; return send(res,200,{token}); }
    return send(res,401,{error:'Wrong admin credentials'});
  }
  if(url==='/api/admin/users' && req.method==='POST'){
    if(!adminSessions[body.token]) return send(res,401,{error:'Admin only'});
    return send(res,200,{users:Object.values(db.users).map(userPublic).sort((a,b)=>a.name.localeCompare(b.name))});
  }
  if(url==='/api/admin/addBalance' && req.method==='POST'){
    if(!adminSessions[body.token]) return send(res,401,{error:'Admin only'});
    const u=db.users[body.phone]; if(!u) return send(res,404,{error:'User not found'});
    u.wallet=Math.max(0,u.wallet+Math.floor(+body.amount||0)); saveDB();
    return send(res,200,{user:userPublic(u)});
  }

  if(url==='/api/table/create' && req.method==='POST'){
    const u=authUser(body); if(!u) return send(res,401,{error:'Not logged in'});
    const entry=Math.max(0,Math.floor(+body.entry||0));
    const seats=Math.min(6,Math.max(2,Math.floor(+body.seats||6)));
    if(entry>0 && u.wallet<entry) return send(res,400,{error:'Not enough balance to create'});
    if(entry>0) u.wallet-=entry;
    const id=shortId();
    const t={ id, name:body.name||(u.name+"'s table"), entry, maxSeats:seats, hostPhone:u.phone, status:'waiting', createdTs:Date.now(),
      seats:[{phone:u.phone,name:u.name,isBot:false,hand:[],score:0,elim:false}], pot:entry, round:0, dealer:null, log:'Waiting for players…' };
    tables[id]=t; saveDB();
    return send(res,200,{tableId:id, entry, seats, joinPath:'/join.html?t='+id});
  }
  if(url==='/api/table/list' && req.method==='POST'){
    const u=authUser(body); if(!u) return send(res,401,{error:'Not logged in'});
    const list=Object.values(tables).filter(t=>t.status==='waiting').map(t=>({id:t.id,name:t.name,entry:t.entry,seats:t.maxSeats,joined:t.seats.length,host:t.seats[0].name}));
    return send(res,200,{tables:list});
  }
  if(url==='/api/table/info' && req.method==='POST'){
    const t=tables[body.tableId]; if(!t) return send(res,404,{error:'Table not found'});
    return send(res,200,{id:t.id,name:t.name,entry:t.entry,seats:t.maxSeats,joined:t.seats.length,status:t.status,host:t.seats[0].name});
  }
  if(url==='/api/table/join' && req.method==='POST'){
    const u=authUser(body); if(!u) return send(res,401,{error:'Not logged in'});
    const t=tables[body.tableId]; if(!t) return send(res,404,{error:'Table not found'});
    if(t.seats.find(s=>s.phone===u.phone)) return send(res,200,{ok:1,already:1});
    if(t.status!=='waiting') return send(res,400,{error:'Table already started'});
    if(t.seats.length>=t.maxSeats) return send(res,400,{error:'Table is full'});
    if(t.entry>0 && u.wallet<t.entry) return send(res,400,{error:'Not enough balance'});
    if(t.entry>0){ u.wallet-=t.entry; t.pot+=t.entry; }
    t.seats.push({phone:u.phone,name:u.name,isBot:false,hand:[],score:0,elim:false});
    logT(t, u.name+' joined. '+t.seats.length+'/'+t.maxSeats);
    saveDB();
    return send(res,200,{ok:1});
  }
  if(url==='/api/table/leave' && req.method==='POST'){
    const u=authUser(body); if(!u) return send(res,401,{error:'Not logged in'});
    const t=tables[body.tableId]; if(!t) return send(res,404,{error:'Table not found'});
    if(t.status==='waiting'){ const idx=t.seats.findIndex(s=>s.phone===u.phone); if(idx>=0){ if(t.entry>0){ u.wallet+=t.entry; t.pot-=t.entry; } t.seats.splice(idx,1); saveDB(); if(!t.seats.length) delete tables[t.id]; } }
    return send(res,200,{ok:1});
  }
  if(url==='/api/table/start' && req.method==='POST'){
    const u=authUser(body); if(!u) return send(res,401,{error:'Not logged in'});
    const t=tables[body.tableId]; if(!t) return send(res,404,{error:'Table not found'});
    if(t.hostPhone!==u.phone) return send(res,403,{error:'Only the host can start'});
    if(t.status!=='waiting') return send(res,400,{error:'Already started'});
    let bi=0; while(t.seats.length<t.maxSeats){ t.seats.push({phone:null,name:BOT_NAMES[bi++%BOT_NAMES.length],isBot:true,hand:[],score:0,elim:false}); }
    t.status='playing'; startDeal(t);
    return send(res,200,{ok:1});
  }
  if(url==='/api/table/state' && req.method==='POST'){
    const u=authUser(body); if(!u) return send(res,401,{error:'Not logged in'});
    const t=tables[body.tableId]; if(!t) return send(res,404,{error:'Table not found'});
    if(t.status==='playing') tick(t);
    return send(res,200, stateFor(t,u.phone));
  }
  if(url==='/api/table/action' && req.method==='POST'){
    const u=authUser(body); if(!u) return send(res,401,{error:'Not logged in'});
    const t=tables[body.tableId]; if(!t) return send(res,404,{error:'Table not found'});
    const seatIdx=t.seats.findIndex(s=>s.phone===u.phone && !s.isBot);
    if(seatIdx<0) return send(res,403,{error:'Not at this table'});
    const r=humanAction(t, t.seats[seatIdx], seatIdx, body);
    if(r.error) return send(res,400,r);
    return send(res,200, Object.assign({},r,stateFor(t,u.phone)));
  }

  return send(res,404,{error:'Unknown API route'});
}

http.createServer(function(req,res){ if(req.url.indexOf("/api/")===0) return api(req,res).catch(function(e){return send(res,500,{error:String(e)});}); serveStatic(req,res); })
  .listen(PORT, function(){
    console.log("=================================================");
    console.log(" Sathyas Rummy v2 (multiplayer tables)");
    console.log(" http://localhost:"+PORT);
    console.log(" Signup key: "+SIGNUP_SECRET+"   Admin: "+ADMIN.username+" / "+ADMIN.password);
    console.log(" Table API: create / list / join / start / state / action");
    console.log("=================================================");
  });
