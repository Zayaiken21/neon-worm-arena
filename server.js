const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const WORLD = 5200;
const MAX_PLAYERS = 15;
const TICK = 1000 / 20;
const SNAP = 1000 / 12;
const FOOD_MAX = 360;
const BASE_SPEED = 250;
const BOOST_SPEED = 395;
const TURN_RATE = 5.8;
const SEG_SPACING = 15;

const index = fs.readFileSync(path.join(__dirname, 'index.html'));
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(index);
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const clients = new Map();
const players = new Map();
let food = [];
let lastSnap = 0;

function rnd(a, b){ return a + Math.random() * (b - a); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function dist2(a,b,c,d){ const x=a-c,y=b-d; return x*x+y*y; }
function normAngle(a){ while(a > Math.PI) a -= Math.PI*2; while(a < -Math.PI) a += Math.PI*2; return a; }
function safeName(n){ return String(n || 'Player').replace(/[<>]/g,'').slice(0,14) || 'Player'; }
function skinOk(s){ return ['aqua','sunset','violet','lime','rose','dog'].includes(s) ? s : 'aqua'; }
function newFood(x=rnd(90,WORLD-90), y=rnd(90,WORLD-90), value=1){ return { id: crypto.randomBytes(4).toString('hex'), x, y, value, c: Math.floor(rnd(0,6)) }; }
function refillFood(){ while(food.length < FOOD_MAX) food.push(newFood()); }
function tailPoint(p){ const t = p.segs[p.segs.length-1] || {x:p.x,y:p.y}; return t; }
function makeSegs(x,y,angle,count){ const segs=[]; for(let i=0;i<count;i++) segs.push({x:x-Math.cos(angle)*i*SEG_SPACING,y:y-Math.sin(angle)*i*SEG_SPACING}); return segs; }
function spawn(p){
  p.x = rnd(420, WORLD-420); p.y = rnd(420, WORLD-420); p.angle = rnd(-Math.PI, Math.PI); p.target = p.angle;
  p.score = 58; p.length = 34; p.radius = 15; p.alive = true; p.deadUntil = 0; p.boost = false;
  p.segs = makeSegs(p.x,p.y,p.angle,p.length); p.lastInput = Date.now();
}
function broadcast(obj){ const s = JSON.stringify(obj); for (const c of clients.values()) if(c.readyState === 1) sendRaw(c, s); }
function send(ws,obj){ if(ws.readyState === 1) sendRaw(ws, JSON.stringify(obj)); }
function sendRaw(socket, data){
  const payload = Buffer.from(data);
  let head;
  if(payload.length < 126){ head = Buffer.from([0x81, payload.length]); }
  else if(payload.length < 65536){ head = Buffer.alloc(4); head[0]=0x81; head[1]=126; head.writeUInt16BE(payload.length,2); }
  else { head = Buffer.alloc(10); head[0]=0x81; head[1]=127; head.writeBigUInt64BE(BigInt(payload.length),2); }
  socket.write(Buffer.concat([head,payload]));
}
function closeWs(socket){ try{ socket.end(Buffer.from([0x88,0x00])); }catch{} }
function readFrame(buf){
  if(buf.length < 2) return null;
  const op = buf[0] & 15; if(op === 8) return {close:true};
  let len = buf[1] & 127, off = 2;
  if(len === 126){ if(buf.length < 4) return null; len = buf.readUInt16BE(2); off=4; }
  else if(len === 127){ if(buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off=10; }
  const masked = (buf[1] & 128) !== 0; if(!masked || buf.length < off + 4 + len) return null;
  const mask = buf.subarray(off, off+4); off += 4;
  const out = Buffer.alloc(len);
  for(let i=0;i<len;i++) out[i] = buf[off+i] ^ mask[i&3];
  return { text: out.toString('utf8') };
}
server.on('upgrade', (req, socket) => {
  if(req.headers.upgrade !== 'websocket'){ socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.readyState = 1;
  const id = crypto.randomBytes(6).toString('hex');
  clients.set(id, socket);
  socket.on('data', (buf) => {
    const frame = readFrame(buf); if(!frame) return;
    if(frame.close){ remove(id); return; }
    try{ handle(id, JSON.parse(frame.text)); }catch{}
  });
  socket.on('close', () => remove(id)); socket.on('error', () => remove(id));
  send(socket, { t:'hello', id, world:WORLD, max:MAX_PLAYERS, count: aliveCount() });
});
function remove(id){ clients.delete(id); players.delete(id); }
function aliveCount(){ let n=0; for(const p of players.values()) if(p.alive) n++; return n; }
function handle(id, m){
  const ws = clients.get(id); if(!ws) return;
  if(m.t === 'join'){
    if(players.size >= MAX_PLAYERS && !players.has(id)){ send(ws,{t:'full'}); return; }
    let p = players.get(id);
    if(!p){ p = { id, name:safeName(m.name), skin:skinOk(m.skin), inputAngle:0, boost:false, alive:false, segs:[] }; players.set(id,p); }
    p.name = safeName(m.name); p.skin = skinOk(m.skin); spawn(p);
    send(ws, { t:'joined', id, world: WORLD });
  } else if(m.t === 'input'){
    const p = players.get(id); if(!p) return;
    if(Number.isFinite(m.a)) p.target = clamp(m.a, -Math.PI*4, Math.PI*4);
    p.boost = !!m.b;
    p.lastInput = Date.now();
  } else if(m.t === 'home'){
    players.delete(id);
    send(ws,{t:'home'});
  }
}
function kill(p){
  if(!p.alive) return;
  p.alive = false; p.deadUntil = Date.now() + 900;
  const step = Math.max(2, Math.floor(p.segs.length / 28));
  for(let i=0;i<p.segs.length;i+=step){ const s=p.segs[i]; food.push(newFood(s.x+rnd(-10,10), s.y+rnd(-10,10), 2)); }
  if(food.length > FOOD_MAX + 180) food.splice(0, food.length - (FOOD_MAX + 180));
  p.segs = [];
}
function update(dt){
  refillFood();
  const now = Date.now();
  for(const p of players.values()){
    if(!p.alive){ if(p.deadUntil && now > p.deadUntil) spawn(p); continue; }
    let da = normAngle(p.target - p.angle);
    p.angle += clamp(da, -TURN_RATE*dt, TURN_RATE*dt);
    const canBoost = p.boost && p.score > 16 && p.segs.length > 13;
    const sp = canBoost ? BOOST_SPEED : BASE_SPEED;
    p.x += Math.cos(p.angle) * sp * dt;
    p.y += Math.sin(p.angle) * sp * dt;
    if(p.x < 35 || p.y < 35 || p.x > WORLD-35 || p.y > WORLD-35){ kill(p); continue; }
    p.segs.unshift({x:p.x,y:p.y});
    const wanted = Math.max(10, Math.floor(p.score / 2.8));
    while(p.segs.length > wanted) p.segs.pop();
    if(canBoost){
      p.score = Math.max(8, p.score - 18*dt);
      if(Math.random() < 0.55){ const t = tailPoint(p); food.push(newFood(t.x+rnd(-6,6), t.y+rnd(-6,6), 1)); }
    }
    // eat nearby food without scanning all heavy on client
    for(let i=food.length-1;i>=0;i--){
      const f=food[i]; if(dist2(p.x,p.y,f.x,f.y) < (p.radius+14)*(p.radius+14)){
        p.score += 4 * f.value; food.splice(i,1);
        if(food.length < FOOD_MAX) food.push(newFood());
      }
    }
  }
  const alive = [...players.values()].filter(p=>p.alive);
  for(const p of alive){
    for(const q of alive){ if(p.id === q.id) continue;
      // head vs enemy body only, skip enemy head first few segments for fair near misses
      for(let i=5;i<q.segs.length;i+=2){ const s=q.segs[i]; if(dist2(p.x,p.y,s.x,s.y) < 24*24){ kill(p); break; } }
      if(!p.alive) break;
    }
  }
}
function snapshot(){
  const alive = [...players.values()].filter(p=>p.alive).sort((a,b)=>b.score-a.score);
  const plist = alive.map(p => ({ id:p.id, name:p.name, skin:p.skin, score:Math.floor(p.score), x:Math.round(p.x), y:Math.round(p.y), a:+p.angle.toFixed(3), segs:p.segs.filter((_,i)=>i%2===0).map(s=>[Math.round(s.x),Math.round(s.y)]) }));
  broadcast({ t:'state', world:WORLD, count:alive.length, max:MAX_PLAYERS, players:plist, food: food.map(f=>[f.id,f.x|0,f.y|0,f.value,f.c]), leaders: alive.slice(0,5).map(p=>[p.name, Math.floor(p.score), p.id]) });
}
let last = Date.now();
setInterval(()=>{ const n=Date.now(); const dt=Math.min(0.05,(n-last)/1000); last=n; update(dt); if(n-lastSnap > SNAP){ lastSnap=n; snapshot(); } }, TICK);
server.listen(PORT, () => console.log('Slither Speed MiniMap running on :' + PORT));
