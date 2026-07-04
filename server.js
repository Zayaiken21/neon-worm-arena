const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAX = 15, MAP = 5600, TICK = 50;
const players = new Map();
const sockets = new Map();
let foods = [];
let nextId = 1;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist2=(a,b)=>{const x=a.x-b.x,y=a.y-b.y;return x*x+y*y};
const rand=(a,b)=>a+Math.random()*(b-a);
const safeSpawn=()=>({x:rand(600,MAP-600), y:rand(600,MAP-600)});
const colors=['aqua','sunset','violet','lime','rose','dog'];

function makeFood(n=1, near=null){ for(let i=0;i<n;i++) foods.push({id:crypto.randomUUID().slice(0,8),x:near?near.x+rand(-90,90):rand(80,MAP-80),y:near?near.y+rand(-90,90):rand(80,MAP-80),v:rand(2,8),c:Math.floor(rand(0,6))}); }
makeFood(320);
function aliveCount(){let n=0; for(const p of players.values()) if(p.alive) n++; return n;}
function publicServers(){ return [{id:'arena',count:aliveCount(),max:MAX}]; }
function send(ws,obj){ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }
function broadcast(obj){ const msg=JSON.stringify(obj); for(const ws of sockets.values()) if(ws.readyState===1) ws.send(msg); }
function createPlayer(ws,data={}){
  const id = 'p'+(nextId++); const sp=safeSpawn();
  const p={id,name:String(data.name||'Player').slice(0,14),skin:colors.includes(data.skin)?data.skin:'aqua',x:sp.x,y:sp.y,ang:rand(0,Math.PI*2),target:0,speed:4.1,boost:false,alive:true,score:0,len:34,r:22,body:[],cool:0,ws};
  for(let i=0;i<p.len;i++) p.body.push({x:p.x-Math.cos(p.ang)*i*12,y:p.y-Math.sin(p.ang)*i*12});
  players.set(id,p); sockets.set(id,ws); ws.pid=id; return p;
}
function respawn(p){
  const sp=safeSpawn(); p.x=sp.x;p.y=sp.y;p.ang=rand(0,Math.PI*2);p.target=p.ang;p.speed=4.1;p.boost=false;p.alive=true;p.score=Math.max(0,Math.floor(p.score*0.25));p.len=34;p.r=22;p.cool=20;p.body=[];
  for(let i=0;i<p.len;i++) p.body.push({x:p.x-Math.cos(p.ang)*i*12,y:p.y-Math.sin(p.ang)*i*12});
}
function kill(p){
  if(!p.alive) return; p.alive=false; p.boost=false;
  const step=Math.max(2,Math.floor(p.body.length/35));
  for(let i=0;i<p.body.length;i+=step) makeFood(1,p.body[i]);
  p.body=[];
}
function step(){
  while(foods.length<320) makeFood(1);
  for(const p of players.values()){
    if(!p.alive) continue;
    if(p.cool>0) p.cool--;
    let d=((p.target-p.ang+Math.PI*3)%(Math.PI*2))-Math.PI;
    p.ang += clamp(d,-0.16,0.16);
    const boostOk = p.boost && p.len>24;
    const spd = boostOk?6.2:4.15;
    if(boostOk && Math.random()<0.32){ p.len-=0.055; if(Math.random()<0.22) makeFood(1,{x:p.x-Math.cos(p.ang)*35,y:p.y-Math.sin(p.ang)*35}); }
    p.x += Math.cos(p.ang)*spd; p.y += Math.sin(p.ang)*spd;
    if(p.x<30||p.y<30||p.x>MAP-30||p.y>MAP-30){ kill(p); continue; }
    p.body.unshift({x:p.x,y:p.y});
    const want=Math.floor(p.len); while(p.body.length>want) p.body.pop();
    for(let i=foods.length-1;i>=0;i--){ const f=foods[i]; if((p.x-f.x)**2+(p.y-f.y)**2 < (p.r+12)**2){ foods.splice(i,1); p.score+=Math.ceil(f.v); p.len+=0.95+f.v*0.09; p.r=clamp(18+p.len*0.08,20,44); }}
  }
  // enemy body collisions only, own body is safe
  const alive=[...players.values()].filter(p=>p.alive);
  for(const p of alive){
    if(p.cool>0) continue;
    outer: for(const o of alive){ if(o.id===p.id) continue; for(let i=6;i<o.body.length;i+=2){ const b=o.body[i]; if((p.x-b.x)**2+(p.y-b.y)**2 < (p.r+o.r*0.55)**2){ kill(p); break outer; } } }
  }
  const snapshot={type:'state',map:MAP,server:{count:aliveCount(),max:MAX},foods:foods.slice(0,360),players:[...players.values()].map(p=>({id:p.id,name:p.name,skin:p.skin,x:p.x,y:p.y,ang:p.ang,alive:p.alive,score:p.score,r:p.r,body:p.body.filter((_,i)=>i%2===0)}))};
  broadcast(snapshot);
}
setInterval(step,TICK);
setInterval(()=>broadcast({type:'servers',servers:publicServers()}),1000);

const server=http.createServer((req,res)=>{
  if(req.url==='/health'){res.end('ok');return;}
  const file=path.join(__dirname,'index.html');
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}); fs.createReadStream(file).pipe(res);
});
server.on('upgrade',(req,socket)=>{
  if(req.headers.upgrade?.toLowerCase()!=='websocket'){socket.destroy();return;}
  const key=req.headers['sec-websocket-key'];
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.readyState=1; socket.send=(s)=>{const b=Buffer.from(s); let h; if(b.length<126){h=Buffer.from([129,b.length]);}else{h=Buffer.alloc(4);h[0]=129;h[1]=126;h.writeUInt16BE(b.length,2);} socket.write(Buffer.concat([h,b]));};
  send(socket,{type:'servers',servers:publicServers()});
  socket.on('data',buf=>{ try{ let off=2, len=buf[1]&127; if(len===126){len=buf.readUInt16BE(2);off=4;} if(len===127) return; const mask=buf.slice(off,off+4); off+=4; const data=Buffer.alloc(len); for(let i=0;i<len;i++) data[i]=buf[off+i]^mask[i%4]; const msg=JSON.parse(data.toString());
    let p=players.get(socket.pid);
    if(msg.type==='join'){ if(!p){ if(aliveCount()>=MAX) return send(socket,{type:'full'}); p=createPlayer(socket,msg); } else { p.name=String(msg.name||p.name).slice(0,14); p.skin=colors.includes(msg.skin)?msg.skin:p.skin; if(!p.alive) respawn(p); } send(socket,{type:'joined',id:p.id,map:MAP}); broadcast({type:'servers',servers:publicServers()}); }
    if(msg.type==='input'&&p){ if(Number.isFinite(msg.a)) p.target=msg.a; p.boost=!!msg.b; }
    if(msg.type==='home'&&p){ kill(p); p.alive=false; broadcast({type:'servers',servers:publicServers()}); }
    if(msg.type==='respawn'&&p){ respawn(p); send(socket,{type:'joined',id:p.id,map:MAP}); }
  }catch(e){} });
  socket.on('close',()=>{ const p=players.get(socket.pid); if(p){players.delete(p.id); sockets.delete(p.id); broadcast({type:'servers',servers:publicServers()});}});
  socket.on('end',()=>socket.emit('close'));
  socket.on('error',()=>socket.emit('close'));
});
server.listen(PORT,()=>console.log('Slither A+ running on '+PORT));
