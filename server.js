const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket', 'polling'] });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 15;
const MAP = 4200;
const FOOD_MAX = 620;
const TICK = 1000 / 30;
const VIEW_PAYLOAD_MS = 1000 / 15;
const COLORS = ['#00f5ff','#ff3df2','#9dff3d','#ffd43d','#8a5cff','#ff6b35','#41ff9f','#ffffff'];

let players = new Map();
let inputs = new Map();
let foods = [];
let bots = [];
let lastBroadcast = 0;

function rand(a,b){ return a + Math.random() * (b-a); }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function wrapAngle(a){ while(a > Math.PI) a -= Math.PI*2; while(a < -Math.PI) a += Math.PI*2; return a; }
function id(){ return Math.random().toString(36).slice(2,9); }
function insideMap(x,y){ const r=MAP/2-30; return x>-r&&x<r&&y>-r&&y<r; }
function food(){ return { id:id(), x:rand(-MAP/2+90,MAP/2-90), y:rand(-MAP/2+90,MAP/2-90), v:rand(2,8), c:COLORS[(Math.random()*COLORS.length)|0] }; }
function seedFood(){ while(foods.length < FOOD_MAX) foods.push(food()); }
function makeSnake(pid, name, skin, bot=false){
  const angle = rand(-Math.PI, Math.PI), len = bot ? 18 : 16, x=rand(-900,900), y=rand(-900,900);
  const segs=[]; for(let i=0;i<len;i++) segs.push({x:x-Math.cos(angle)*i*13,y:y-Math.sin(angle)*i*13});
  return { id:pid, name:(name||'Worm').slice(0,14), skin:clamp(skin|0,0,COLORS.length-1), bot, alive:true, x,y, angle, target:angle, score:0, length:len, radius:11, boost:false, respawn:0, segs, kills:0 };
}
function joinCount(){ let n=0; for(const p of players.values()) if(!p.bot) n++; return n; }
function publicPlayer(p){ return {id:p.id,n:p.name,s:p.score|0,k:p.kills|0,c:p.skin,b:p.bot}; }
function dropFoodFromSnake(p){ for(let i=0;i<p.segs.length;i+=2){ const s=p.segs[i]; foods.push({id:id(),x:s.x+rand(-12,12),y:s.y+rand(-12,12),v:rand(4,10),c:COLORS[p.skin]}); } }
function kill(p, killer){ if(!p.alive) return; p.alive=false; p.respawn=p.bot?900:1600; dropFoodFromSnake(p); if(killer && killer.id!==p.id) killer.kills++; }
function respawn(p){ const n=makeSnake(p.id,p.name,p.skin,p.bot); Object.assign(p,n); }
function nearestTarget(p){
  let best=null, bd=999999;
  for(const q of players.values()) if(q.alive && q.id!==p.id){ const d=dist(p,q); if(d<bd){bd=d; best=q;} }
  let fbest=null, fd=bd<500?999999:420;
  for(const f of foods){ const d=Math.hypot(f.x-p.x,f.y-p.y); if(d<fd){fd=d; fbest=f;} }
  return best && bd<650 ? best : fbest;
}
function botThink(p){
  const t=nearestTarget(p); let desired=p.angle;
  if(t){ desired=Math.atan2(t.y-p.y,t.x-p.x); }
  if(Math.random()<0.012) desired += rand(-1.2,1.2);
  p.target=desired; p.boost=!!t && !t.v && dist(p,t)<460 && p.length>22;
}
function updateSnake(p, dt){
  if(!p.alive){ p.respawn-=dt; if(p.respawn<=0) respawn(p); return; }
  if(p.bot) botThink(p); else { const inp=inputs.get(p.id); if(inp){ p.target=inp.a; p.boost=!!inp.b; } }
  const turn=0.18; p.angle += clamp(wrapAngle(p.target-p.angle), -turn, turn);
  const canBoost=p.length>18; const speed=(p.boost&&canBoost?7.0:4.2) * dt/(1000/30);
  p.x += Math.cos(p.angle)*speed; p.y += Math.sin(p.angle)*speed;
  p.x=clamp(p.x,-MAP/2+25,MAP/2-25); p.y=clamp(p.y,-MAP/2+25,MAP/2-25);
  p.segs.unshift({x:p.x,y:p.y});
  let maxLen=Math.floor(p.length + p.score/8);
  if(p.boost&&canBoost&&p.segs.length%4===0){ p.score=Math.max(0,p.score-1); foods.push({id:id(),x:p.x-Math.cos(p.angle)*18,y:p.y-Math.sin(p.angle)*18,v:2,c:COLORS[p.skin]}); }
  while(p.segs.length>maxLen) p.segs.pop();
  for(let i=foods.length-1;i>=0;i--){ const f=foods[i]; if(Math.hypot(f.x-p.x,f.y-p.y)<p.radius+10){ p.score+=f.v; p.length+=0.18; foods.splice(i,1); } }
  if(!insideMap(p.x,p.y)) kill(p,null);
}
function collisions(){
  const arr=[...players.values()].filter(p=>p.alive);
  for(const p of arr){
    for(const q of arr){
      const start=q.id===p.id?12:4;
      for(let i=start;i<q.segs.length;i+=2){
        const s=q.segs[i];
        if(Math.hypot(p.x-s.x,p.y-s.y)<p.radius+7){ kill(p,q); break; }
      }
      if(!p.alive) break;
    }
  }
}
function maintainBots(){
  const humans=joinCount(); const wanted=Math.max(0, Math.min(6, 8-humans));
  bots=bots.filter(id=>players.has(id));
  while(bots.length<wanted){ const bid='bot_'+id(); bots.push(bid); players.set(bid, makeSnake(bid, ['Nova','Viper','Orbit','Pixel','Comet','Ghost'][bots.length%6], bots.length%COLORS.length, true)); }
  while(bots.length>wanted){ players.delete(bots.pop()); }
}
function payload(){
  return {
    map: MAP, cap: MAX_PLAYERS, online: joinCount(),
    foods,
    players:[...players.values()].map(p=>({ id:p.id,n:p.name,c:p.skin,s:p.score|0,k:p.kills,b:p.bot,alive:p.alive,x:p.x,y:p.y,a:p.angle,segs:p.segs.filter((_,i)=>i%2===0) })),
    board:[...players.values()].filter(p=>p.alive).sort((a,b)=>b.score-a.score).slice(0,8).map(publicPlayer)
  };
}
io.on('connection', socket=>{
  socket.emit('hello', { cap:MAX_PLAYERS, online:joinCount() });
  socket.on('join', data=>{
    if(joinCount()>=MAX_PLAYERS){ socket.emit('full', { message:'Arena full. Try again soon.' }); return; }
    const p=makeSnake(socket.id, data && data.name, data && data.skin, false);
    players.set(socket.id,p); inputs.set(socket.id,{a:p.angle,b:false}); socket.emit('joined',{id:socket.id,map:MAP}); maintainBots();
  });
  socket.on('input', d=>{ if(players.has(socket.id) && d && Number.isFinite(d.a)) inputs.set(socket.id,{a:d.a,b:!!d.b}); });
  socket.on('disconnect',()=>{ players.delete(socket.id); inputs.delete(socket.id); maintainBots(); });
});
setInterval(()=>{
  seedFood(); maintainBots();
  for(const p of players.values()) updateSnake(p,TICK);
  collisions(); seedFood();
  const now=Date.now(); if(now-lastBroadcast>VIEW_PAYLOAD_MS){ io.emit('state', payload()); lastBroadcast=now; }
}, TICK);
app.use(express.static(__dirname));
app.get('/health', (_,res)=>res.json({ok:true, players:joinCount()}));
server.listen(PORT, ()=>console.log(`Slither Live Compact running on ${PORT}`));
