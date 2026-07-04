'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const MAX_PLAYERS = 15;
const MAP = 3600;
const TICK = 1000 / 30;
const SEND = 1000 / 15;
const rooms = new Map();
const sockets = new Set();
let ridSeq = 1;

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function rand(a,b){ return a + Math.random() * (b-a); }
function dist(a,b,c,d){ return Math.hypot(a-c,b-d); }
function id(prefix='id'){ return prefix + Math.random().toString(36).slice(2,8) + Date.now().toString(36).slice(-3); }

function makeFood(n=260){ const arr=[]; for(let i=0;i<n;i++) arr.push({id:id('f'),x:rand(-MAP,MAP),y:rand(-MAP,MAP),r:rand(3.2,7.5),h:Math.floor(rand(0,360))}); return arr; }
function makeRoom(){
  const room = { id:'Arena-' + String(ridSeq++).padStart(2,'0'), players:new Map(), food:makeFood(), last:Date.now(), created:Date.now() };
  rooms.set(room.id, room); return room;
}
function openRoom(){
  for(const r of rooms.values()) if(r.players.size < MAX_PLAYERS) return r;
  return makeRoom();
}
function roomList(){
  const list = [...rooms.values()].filter(r=>r.players.size>0 || Date.now()-r.created<60000).map(r=>({id:r.id,count:r.players.size,max:MAX_PLAYERS}));
  if(!list.length){ const r = makeRoom(); return [{id:r.id,count:0,max:MAX_PLAYERS}]; }
  return list;
}
function spawnPlayer(name, skin){
  const x=rand(-900,900), y=rand(-900,900);
  const pts=[]; for(let i=0;i<32;i++) pts.push({x:x-i*7,y});
  const allowed = new Set(['aqua','sun','violet','lime','rose','dog']);
  skin = allowed.has(String(skin)) ? String(skin) : 'aqua';
  return { id:id('p'), name:String(name||'Player').slice(0,14), skin, x,y, a:rand(0,Math.PI*2), tx:x+200, ty:y, pts, score:0, alive:true, boost:false, speed:3.8, join:Date.now(), inv:70 };
}
function publicPlayer(p){ return {id:p.id,name:p.name,skin:p.skin,x:p.x,y:p.y,a:p.a,pts:p.pts,score:Math.floor(p.score),alive:p.alive}; }
function broadcastRoom(r, obj){ for(const c of r.players.values()) send(c.ws, obj); }
function broadcastLobby(){ const msg={type:'rooms', rooms:roomList()}; for(const ws of sockets) if(!ws.roomId) send(ws,msg); }

const server = http.createServer((req,res)=>{
  if(req.url === '/' || req.url.startsWith('/?')){ res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'}); return res.end(INDEX); }
  res.writeHead(404); res.end('Not found');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if(!key){ socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.id = id('s'); socket.alive = true; sockets.add(socket); send(socket,{type:'rooms',rooms:roomList()});
  socket.on('data', buf => readFrames(socket, buf));
  socket.on('close', ()=>drop(socket)); socket.on('error', ()=>drop(socket));
});
function encode(str){
  const payload = Buffer.from(str); let header;
  if(payload.length < 126){ header = Buffer.from([0x81, payload.length]); }
  else if(payload.length < 65536){ header = Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(payload.length,2); }
  else { header = Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(payload.length),2); }
  return Buffer.concat([header,payload]);
}
function send(ws,obj){ if(ws.destroyed) return; try{ ws.write(encode(JSON.stringify(obj))); }catch(e){} }
function readFrames(ws, buffer){
  let off=0;
  while(off + 2 <= buffer.length){
    const b1=buffer[off++], b2=buffer[off++]; const opcode=b1&15; let len=b2&127; const masked=!!(b2&128);
    if(len===126){ if(off+2>buffer.length) return; len=buffer.readUInt16BE(off); off+=2; }
    else if(len===127){ if(off+8>buffer.length) return; len=Number(buffer.readBigUInt64BE(off)); off+=8; }
    let mask; if(masked){ if(off+4>buffer.length) return; mask=buffer.slice(off,off+4); off+=4; }
    if(off+len>buffer.length) return;
    let data=buffer.slice(off,off+len); off+=len;
    if(masked){ const out=Buffer.alloc(len); for(let i=0;i<len;i++) out[i]=data[i]^mask[i%4]; data=out; }
    if(opcode===8){ drop(ws); return; }
    if(opcode===1){ try{ onMsg(ws, JSON.parse(data.toString())); }catch(e){} }
  }
}
function onMsg(ws,m){
  if(m.type==='list') return send(ws,{type:'rooms',rooms:roomList()});
  if(m.type==='join'){
    if(ws.roomId) drop(ws, true);
    let r = m.roomId && rooms.get(m.roomId) && rooms.get(m.roomId).players.size<MAX_PLAYERS ? rooms.get(m.roomId) : openRoom();
    const p = spawnPlayer(m.name, m.skin); ws.roomId=r.id; ws.playerId=p.id; p.ws=ws; r.players.set(p.id,p);
    send(ws,{type:'joined',you:p.id,room:{id:r.id,count:r.players.size,max:MAX_PLAYERS},map:MAP});
    broadcastRoom(r,{type:'notice',text:'A player entered the arena'}); broadcastLobby(); return;
  }
  if(m.type==='input' && ws.roomId){ const r=rooms.get(ws.roomId), p=r&&r.players.get(ws.playerId); if(!p||!p.alive) return; p.tx=Number(m.x)||p.x; p.ty=Number(m.y)||p.y; p.boost=!!m.boost; }
  if(m.type==='home') drop(ws, true);
}
function drop(ws, keep=false){
  if(ws.roomId){ const r=rooms.get(ws.roomId); if(r){ r.players.delete(ws.playerId); if(r.players.size===0 && Date.now()-r.created>30000) rooms.delete(r.id); else broadcastRoom(r,{type:'notice',text:'Arena host switched'}); } }
  ws.roomId=null; ws.playerId=null; if(!keep){ sockets.delete(ws); try{ws.destroy();}catch(e){} } else send(ws,{type:'rooms',rooms:roomList()}); broadcastLobby();
}
function step(){
  const now=Date.now();
  for(const r of rooms.values()){
    const dt=Math.min(2,(now-r.last)/TICK); r.last=now;
    for(const p of r.players.values()){
      if(!p.alive) continue;
      const dx=p.tx-p.x, dy=p.ty-p.y; const target=Math.atan2(dy,dx); let da=((target-p.a+Math.PI*3)%(Math.PI*2))-Math.PI;
      p.a += clamp(da,-0.16,0.16)*dt;
      const boosting=p.boost && p.pts.length>34 && p.score>6; const sp=(boosting?5.9:3.65)*dt;
      p.x=clamp(p.x+Math.cos(p.a)*sp,-MAP,MAP); p.y=clamp(p.y+Math.sin(p.a)*sp,-MAP,MAP);
      const last=p.pts[0];
      if(!last || dist(p.x,p.y,last.x,last.y)>4.6) p.pts.unshift({x:p.x,y:p.y});
      const maxLen=32+Math.floor(p.score/2.1); while(p.pts.length>maxLen) p.pts.pop();
      if(boosting){ p.score=Math.max(0,p.score-0.045*dt); if(Math.random()<0.32) r.food.push({id:id('f'),x:p.pts[p.pts.length-1].x,y:p.pts[p.pts.length-1].y,r:4,h:Math.floor(rand(0,360))}); }
      for(let i=r.food.length-1;i>=0;i--){ const f=r.food[i]; if(dist(p.x,p.y,f.x,f.y)<18+f.r){ p.score += f.r; r.food.splice(i,1); } }
      p.inv=Math.max(0,p.inv-dt);
    }
    while(r.food.length<260) r.food.push({id:id('f'),x:rand(-MAP,MAP),y:rand(-MAP,MAP),r:rand(3.2,7.5),h:Math.floor(rand(0,360))});
    const players=[...r.players.values()].filter(p=>p.alive);
    for(const p of players){ if(p.inv>0) continue; let dead=false;
      if(Math.abs(p.x)>=MAP-5||Math.abs(p.y)>=MAP-5) dead=true;
      for(const q of players){ if(dead) break; for(let i=(p.id===q.id?16:5); i<q.pts.length; i+=3){ const s=q.pts[i]; if(s && dist(p.x,p.y,s.x,s.y)<16){ dead=true; break; } } }
      if(dead){ p.alive=false; for(let i=0;i<p.pts.length;i+=2) r.food.push({id:id('f'),x:p.pts[i].x+rand(-10,10),y:p.pts[i].y+rand(-10,10),r:rand(4.5,9),h:Math.floor(rand(0,360))});
        p.score=0; p.pts=[]; send(p.ws,{type:'dead'}); }
    }
  }
}
setInterval(step, TICK);
setInterval(()=>{
  for(const r of rooms.values()){
    if(!r.players.size) continue;
    const state={type:'state',room:{id:r.id,count:r.players.size,max:MAX_PLAYERS},players:[...r.players.values()].map(publicPlayer),food:r.food.slice(0,320),leader:[...r.players.values()].sort((a,b)=>b.score-a.score).slice(0,5).map(p=>({name:p.name,score:Math.floor(p.score)}))};
    broadcastRoom(r,state);
  }
}, SEND);
setInterval(broadcastLobby, 2000);
server.listen(PORT,()=>console.log('Slither Pro Live running on :' + PORT));
