const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAP = 6200, MAX_PLAYERS = 15, TICK_MS = 50;
const players = new Map();
const sockets = new Map();
let food = [];
let nextId = 1;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rand=(a,b)=>a+Math.random()*(b-a);
const wrapAngle=(a)=>{ while(a<-Math.PI)a+=Math.PI*2; while(a>Math.PI)a-=Math.PI*2; return a; };
const skins = new Set(['aqua','sunset','violet','lime','rose','dog']);
function id(){ return crypto.randomUUID ? crypto.randomUUID().slice(0,8) : Math.random().toString(36).slice(2,10); }
function spawnPoint(){ return {x:rand(700,MAP-700), y:rand(700,MAP-700)}; }
function aliveCount(){ let n=0; for(const p of players.values()) if(p.alive) n++; return n; }
function servers(){ return [{id:'arena-1', count:aliveCount(), max:MAX_PLAYERS}]; }
function makeFood(n=1, near=null, value=0){
  for(let i=0;i<n;i++) food.push({id:id(), x:near?clamp(near.x+rand(-120,120),70,MAP-70):rand(70,MAP-70), y:near?clamp(near.y+rand(-120,120),70,MAP-70):rand(70,MAP-70), v:value||rand(2,8), c:Math.floor(rand(0,7))});
  if(food.length>420) food.splice(0, food.length-420);
}
for(let i=0;i<300;i++) makeFood(1);

function frame(data){
  const payload = Buffer.from(data);
  if(payload.length < 126) return Buffer.concat([Buffer.from([0x81,payload.length]),payload]);
  if(payload.length < 65536){ const h=Buffer.alloc(4); h[0]=0x81; h[1]=126; h.writeUInt16BE(payload.length,2); return Buffer.concat([h,payload]); }
  const h=Buffer.alloc(10); h[0]=0x81; h[1]=127; h.writeBigUInt64BE(BigInt(payload.length),2); return Buffer.concat([h,payload]);
}
function send(ws,obj){ if(!ws.destroyed) { try{ ws.write(frame(JSON.stringify(obj))); }catch{} } }
function broadcast(obj){ const msg=JSON.stringify(obj); for(const ws of sockets.values()) if(!ws.destroyed) { try{ ws.write(frame(msg)); }catch{} } }

function createPlayer(ws,msg){
  const sp=spawnPoint(), pid='p'+nextId++;
  const p={id:pid, ws, name:String(msg.name||'Player').replace(/[<>]/g,'').slice(0,14)||'Player', skin:skins.has(msg.skin)?msg.skin:'aqua', x:sp.x, y:sp.y, ang:rand(-Math.PI,Math.PI), target:0, boost:false, alive:true, score:0, len:38, r:22, body:[], cooldown:18};
  for(let i=0;i<p.len;i++) p.body.push({x:p.x-Math.cos(p.ang)*i*11, y:p.y-Math.sin(p.ang)*i*11});
  players.set(pid,p); sockets.set(pid,ws); ws.pid=pid; return p;
}
function respawn(p){
  const sp=spawnPoint(); p.x=sp.x; p.y=sp.y; p.ang=rand(-Math.PI,Math.PI); p.target=p.ang; p.boost=false; p.alive=true; p.score=0; p.len=38; p.r=22; p.body=[]; p.cooldown=22;
  for(let i=0;i<p.len;i++) p.body.push({x:p.x-Math.cos(p.ang)*i*11, y:p.y-Math.sin(p.ang)*i*11});
}
function kill(p){
  if(!p || !p.alive) return;
  p.alive=false; p.boost=false;
  const step=Math.max(2,Math.floor(p.body.length/32));
  for(let i=0;i<p.body.length;i+=step) makeFood(1,p.body[i], 8+Math.min(14,p.score/12));
}
function removeSocket(ws){
  const p=players.get(ws.pid); if(p){ players.delete(p.id); sockets.delete(p.id); broadcast({type:'servers',servers:servers()}); }
}
function update(){
  while(food.length<300) makeFood(8);
  for(const p of players.values()){
    if(!p.alive) continue;
    if(p.cooldown>0) p.cooldown--;
    p.ang += clamp(wrapAngle(p.target-p.ang), -0.16, 0.16);
    const canBoost = p.boost && p.len>28;
    const speed = canBoost ? 6.65 : 4.55;
    if(canBoost){ p.len -= 0.075; p.score = Math.max(0, p.score - 0.055); if(Math.random()<0.36) makeFood(1,{x:p.x-Math.cos(p.ang)*p.r*1.55,y:p.y-Math.sin(p.ang)*p.r*1.55},3.5); } else { p.boost=false; }
    p.x += Math.cos(p.ang)*speed; p.y += Math.sin(p.ang)*speed;
    p.body.unshift({x:p.x,y:p.y});
    const want=Math.floor(p.len); while(p.body.length>want) p.body.pop();
    p.r = clamp(16 + p.len*0.075, 18, 44);
    for(let i=food.length-1;i>=0;i--){ const f=food[i]; const dx=p.x-f.x, dy=p.y-f.y; if(dx*dx+dy*dy < (p.r+13)*(p.r+13)){ food.splice(i,1); p.score += Math.ceil(f.v); p.len += 0.85 + f.v*0.08; } }
    if(p.cooldown<=0 && (p.x<p.r || p.y<p.r || p.x>MAP-p.r || p.y>MAP-p.r)) kill(p);
  }
  const alive=[...players.values()].filter(p=>p.alive);
  for(const p of alive){
    if(p.cooldown>0) continue;
    outer: for(const o of alive){
      if(o.id===p.id) continue; // own body is safe
      for(let i=8;i<o.body.length;i+=3){ const b=o.body[i], dx=p.x-b.x, dy=p.y-b.y; if(dx*dx+dy*dy < (p.r+o.r*0.5)*(p.r+o.r*0.5)){ kill(p); break outer; } }
    }
  }
  const snapPlayers=[...players.values()].map(p=>{
    const stride = Math.max(1, Math.ceil((p.body.length||1)/46));
    return {id:p.id,name:p.name,skin:p.skin,x:+p.x.toFixed(1),y:+p.y.toFixed(1),ang:+p.ang.toFixed(3),alive:p.alive,score:Math.floor(p.score),r:+p.r.toFixed(1),body:p.body.filter((_,i)=>i%stride===0).map(b=>({x:+b.x.toFixed(1),y:+b.y.toFixed(1)}))};
  });
  broadcast({type:'state',map:MAP,server:{count:aliveCount(),max:MAX_PLAYERS},food:food.slice(-280),leaderboard:alive.sort((a,b)=>b.score-a.score).slice(0,5).map(p=>({name:p.name,score:Math.floor(p.score)})),players:snapPlayers});
}
setInterval(update,TICK_MS);

const server=http.createServer((req,res)=>{
  if(req.url==='/health'){res.writeHead(200); res.end('ok'); return;}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  fs.createReadStream(path.join(__dirname,'index.html')).pipe(res);
});
server.on('upgrade',(req,socket)=>{
  if((req.headers.upgrade||'').toLowerCase()!=='websocket'){ socket.destroy(); return; }
  const key=req.headers['sec-websocket-key']; if(!key){socket.destroy();return;}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  send(socket,{type:'servers',servers:servers()});
  socket.on('data',(buf)=>{ try{
    let off=2, len=buf[1]&127; if(len===126){len=buf.readUInt16BE(2);off=4;} else if(len===127){len=Number(buf.readBigUInt64BE(2));off=10;} const mask=buf.slice(off,off+4); off+=4; const data=Buffer.alloc(len); for(let i=0;i<len;i++) data[i]=buf[off+i]^mask[i&3]; const msg=JSON.parse(data.toString());
    let p=players.get(socket.pid);
    if(msg.type==='join'){
      if(!p){ if(aliveCount()>=MAX_PLAYERS) return send(socket,{type:'full'}); p=createPlayer(socket,msg); }
      else { p.name=String(msg.name||p.name).slice(0,14); p.skin=skins.has(msg.skin)?msg.skin:p.skin; if(!p.alive) respawn(p); }
      send(socket,{type:'joined',id:p.id,map:MAP}); broadcast({type:'servers',servers:servers()});
    } else if(msg.type==='input' && p){ if(Number.isFinite(msg.a)) p.target=msg.a; p.boost=!!msg.b; }
    else if(msg.type==='respawn' && p){ respawn(p); send(socket,{type:'joined',id:p.id,map:MAP}); broadcast({type:'servers',servers:servers()}); }
    else if(msg.type==='home' && p){ p.alive=false; p.boost=false; p.body=[]; broadcast({type:'servers',servers:servers()}); }
  }catch{} });
  socket.on('close',()=>removeSocket(socket)); socket.on('end',()=>removeSocket(socket)); socket.on('error',()=>removeSocket(socket));
});
server.listen(PORT,()=>console.log('Slither Pro Fixed running on '+PORT));
