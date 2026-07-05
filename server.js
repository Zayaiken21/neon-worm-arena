const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 15;
const WORLD = 5200;
const TICK = 40; // 25hz smoother without overheating
const BASE_SPEED = 250;
const BOOST_SPEED = 360;
const TURN = 0.18;
const MIN_LEN = 18;
const START_LEN = 36;
const MAX_FOOD = 320;

const clients = new Map();
const players = new Map();
const foods = [];
const server = http.createServer((req,res)=>{
  const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const p = path.join(__dirname, file);
  fs.readFile(p,(err,data)=>{
    if(err){ res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {'Content-Type': file.endsWith('.html')?'text/html':'text/plain', 'Cache-Control':'no-store'});
    res.end(data);
  });
});

function acceptKey(key){
  return crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}
server.on('upgrade',(req,socket)=>{
  const key = req.headers['sec-websocket-key']; if(!key) return socket.destroy();
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+acceptKey(key)+'\r\n\r\n');
  const id = Math.random().toString(36).slice(2,10);
  clients.set(id,{socket, input:{x:1,y:0,boost:false}, alive:false, last:Date.now()});
  send(id,{t:'hello',id, count:aliveCount()});
  socket.on('data',buf=>onData(id,buf));
  socket.on('close',()=>remove(id));
  socket.on('error',()=>remove(id));
});
function frame(obj){
  const s=Buffer.from(JSON.stringify(obj));
  const h=[]; h.push(129);
  if(s.length<126) h.push(s.length); else if(s.length<65536) h.push(126, s.length>>8, s.length&255);
  return Buffer.concat([Buffer.from(h),s]);
}
function send(id,obj){ const c=clients.get(id); if(c&&c.socket.writable) c.socket.write(frame(obj)); }
function broadcast(obj){ const f=frame(obj); for(const c of clients.values()) if(c.socket.writable) c.socket.write(f); }
function onData(id,buf){
  try{
    const op = buf[0]&15; if(op===8) return remove(id);
    let len=buf[1]&127, off=2; if(len===126){len=buf.readUInt16BE(2);off=4;}
    const mask=buf.slice(off,off+4); off+=4; const data=Buffer.alloc(len);
    for(let i=0;i<len;i++) data[i]=buf[off+i]^mask[i%4];
    const m=JSON.parse(data.toString()); const c=clients.get(id); if(!c)return; c.last=Date.now();
    if(m.t==='join') join(id,m);
    if(m.t==='input') c.input={x:clamp(m.x,-1,1),y:clamp(m.y,-1,1),boost:!!m.boost};
    if(m.t==='home') { players.delete(id); c.alive=false; send(id,{t:'home'}); }
  }catch(e){}
}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function rand(a,b){return a+Math.random()*(b-a)}
function spawnFood(n){ for(let i=0;i<n;i++) foods.push({x:rand(120,WORLD-120),y:rand(120,WORLD-120),v:1+Math.random()*2,c:Math.floor(Math.random()*6)}); }
spawnFood(MAX_FOOD);
function join(id,m){
  const c=clients.get(id); if(!c) return;
  if(aliveCount()>=MAX_PLAYERS) return send(id,{t:'full'});
  const p={id,name:String(m.name||'Player').slice(0,14),skin:String(m.skin||'neon'),x:rand(700,WORLD-700),y:rand(700,WORLD-700),a:rand(0,Math.PI*2),score:90,len:START_LEN,alive:true,deadAt:0,trail:[]};
  for(let i=0;i<START_LEN;i++) p.trail.push({x:p.x-Math.cos(p.a)*i*12,y:p.y-Math.sin(p.a)*i*12});
  players.set(id,p); c.alive=true; send(id,{t:'joined',id,world:WORLD});
}
function aliveCount(){ let n=0; for(const p of players.values()) if(p.alive)n++; return n; }
function remove(id){ clients.delete(id); const p=players.get(id); if(p) dropDeath(p); players.delete(id); }
function dropDeath(p){
  const step=Math.max(2, Math.floor(p.trail.length/22));
  for(let i=0;i<p.trail.length;i+=step){ const q=p.trail[i]; foods.push({x:q.x+rand(-15,15),y:q.y+rand(-15,15),v:2.8,c:Math.floor(Math.random()*6)}); }
  while(foods.length>MAX_FOOD+180) foods.shift();
}
function kill(p){ if(!p.alive)return; dropDeath(p); p.alive=false; p.deadAt=Date.now(); const c=clients.get(p.id); if(c)c.alive=false; send(p.id,{t:'dead'}); players.delete(p.id); }
function angDiff(a,b){ return Math.atan2(Math.sin(b-a),Math.cos(b-a)); }
function tick(){
  const dt=TICK/1000;
  for(const [id,p] of players){
    if(!p.alive) continue;
    const c=clients.get(id); if(!c) {players.delete(id); continue;}
    const ix=c.input.x, iy=c.input.y;
    if(Math.hypot(ix,iy)>0.12){ const target=Math.atan2(iy,ix); p.a += angDiff(p.a,target)*TURN; }
    const boosting = c.input.boost && p.len>MIN_LEN+4 && p.score>6;
    const speed = boosting ? BOOST_SPEED : BASE_SPEED;
    p.x += Math.cos(p.a)*speed*dt; p.y += Math.sin(p.a)*speed*dt;
    // keep full-speed movement; wall collision happens only at real arena border
    p.trail.unshift({x:p.x,y:p.y});
    if(boosting){
      p.score=Math.max(0,p.score-0.75); p.len=Math.max(MIN_LEN,p.len-0.22);
      if(p.trail.length>MIN_LEN){ const tail=p.trail[p.trail.length-1]; if(Math.random()<0.55) foods.push({x:tail.x+rand(-8,8),y:tail.y+rand(-8,8),v:1.2,c:Math.floor(Math.random()*6)}); }
    }
    while(p.trail.length>Math.floor(p.len)) p.trail.pop();
    if(p.x<=28||p.x>=WORLD-28||p.y<=28||p.y>=WORLD-28) kill(p);
    for(let i=foods.length-1;i>=0;i--){ const f=foods[i]; const d2=(p.x-f.x)**2+(p.y-f.y)**2; if(d2<28*28){ p.score+=Math.round(f.v*4); p.len+=0.95+f.v*0.18; foods.splice(i,1); } }
  }
  // enemy body collision, own body safe
  const arr=[...players.values()].filter(p=>p.alive);
  for(const p of arr){
    for(const o of arr){ if(o.id===p.id) continue; for(let i=8;i<o.trail.length;i+=3){ const q=o.trail[i]; if((p.x-q.x)**2+(p.y-q.y)**2<24*24){ kill(p); break; } } if(!p.alive)break; }
  }
  while(foods.length<MAX_FOOD) spawnFood(8);
  const leaderboard=arr.filter(p=>players.has(p.id)).sort((a,b)=>b.score-a.score).slice(0,5).map(p=>({n:p.name,s:Math.floor(p.score)}));
  const state={t:'state',alive:aliveCount(),foods:foods.slice(-180).map(f=>[Math.round(f.x),Math.round(f.y),Math.round(f.v),f.c]),players:[...players.values()].filter(p=>p.alive).map(p=>({id:p.id,n:p.name,s:p.skin,x:Math.round(p.x),y:Math.round(p.y),a:+p.a.toFixed(2),score:Math.floor(p.score),trail:p.trail.filter((_,i)=>i%3===0).map(q=>[Math.round(q.x),Math.round(q.y)])})),leaderboard};
  broadcast(state);
}
setInterval(tick,TICK);
server.listen(PORT,()=>console.log('Slither Pro running '+PORT));
