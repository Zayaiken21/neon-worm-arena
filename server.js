const http=require('http'), fs=require('fs'), path=require('path'), crypto=require('crypto');
const PORT=process.env.PORT||3000, MAX=15, MAP=4200, TICK=50, SEG=15, FOOD_MAX=360;
const skins=['neon','sunset','ocean','toxic','candy','royal','fire','ice'];
const rooms=new Map(); let last=Date.now();
const id=()=>crypto.randomBytes(6).toString('hex');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)); const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const rnd=(a,b)=>a+Math.random()*(b-a); const now=()=>Date.now();
function roomList(){ clean(); return [...rooms.values()].map(r=>({id:r.id,name:r.name,players:[...r.players.values()].filter(p=>!p.bot).length,cap:MAX,map:MAP})); }
function getRoom(){ clean(); let r=[...rooms.values()].find(x=>[...x.players.values()].filter(p=>!p.bot).length<MAX); if(!r){r={id:id(),name:'Server '+(rooms.size+1),players:new Map(),food:[],created:now()}; rooms.set(r.id,r); for(let i=0;i<FOOD_MAX;i++) food(r); for(let i=0;i<5;i++) bot(r);} return r; }
function food(r,x=rnd(-MAP/2,MAP/2),y=rnd(-MAP/2,MAP/2),v=1){ r.food.push({id:id(),x,y,v,c:Math.floor(Math.random()*360)}); }
function makePlayer(name,skin,bot=false){ let x=rnd(-700,700),y=rnd(-700,700),a=rnd(0,Math.PI*2); let body=[]; for(let i=0;i<22;i++) body.push({x:x-Math.cos(a)*i*SEG,y:y-Math.sin(a)*i*SEG}); return {id:id(),name:(name||'Worm').slice(0,16),skin:skins.includes(skin)?skin:'neon',bot,x,y,a,body,len:22,score:0,boost:false,alive:true,last:now(),cool:0}; }
function bot(r){ let p=makePlayer(['Nova','Byte','Swarm','Glow','Dash','Viper'][Math.floor(Math.random()*6)],skins[Math.floor(Math.random()*skins.length)],true); r.players.set(p.id,p); }
function join(data){ let r=getRoom(); let p=makePlayer(data.name,data.skin,false); r.players.set(p.id,p); return {playerId:p.id,roomId:r.id,roomName:r.name,map:MAP,cap:MAX}; }
function leave(pid){ for(const r of rooms.values()) if(r.players.delete(pid)) return true; return false; }
function input(d){ let r=rooms.get(d.roomId), p=r&&r.players.get(d.playerId); if(!p)return {ok:false}; p.a=Number.isFinite(d.angle)?d.angle:p.a; p.boost=!!d.boost; p.last=now(); return {ok:true}; }
function state(q){ let r=rooms.get(q.room), p=r&&r.players.get(q.player); if(!r||!p) return {dead:true,rooms:roomList()}; p.last=now(); return {me:p.id,map:MAP,room:{id:r.id,name:r.name,players:[...r.players.values()].filter(x=>!x.bot).length,cap:MAX},players:[...r.players.values()].map(pl=>({id:pl.id,n:pl.name,s:pl.skin,x:pl.x,y:pl.y,a:pl.a,b:pl.body,score:pl.score,bot:pl.bot})),food:r.food,board:[...r.players.values()].sort((a,b)=>b.score-a.score).slice(0,8).map(x=>({n:x.name,s:x.score,bot:x.bot}))}; }
function step(dt){ for(const r of rooms.values()){
  while(r.food.length<FOOD_MAX) food(r);
  const arr=[...r.players.values()];
  for(const p of arr){
    if(p.bot){ let near=r.food.reduce((m,f)=>dist(p,f)<dist(p,m)?f:m,r.food[0]||{x:0,y:0}); if(Math.random()<.035)p.a+=rnd(-.8,.8); if(near)p.a=Math.atan2(near.y-p.y,near.x-p.x)+rnd(-.25,.25); p.boost=Math.random()<.012&&p.len>35; }
    let sp=(p.boost&&p.len>26)?6.2:4.2; if(p.boost&&p.len>26&&p.cool<=0){p.len-=.18;p.score=Math.max(0,Math.floor(p.score-.18));p.cool=3;food(r,p.x,p.y,.8)} p.cool-=dt;
    p.x=clamp(p.x+Math.cos(p.a)*sp,-MAP/2,MAP/2); p.y=clamp(p.y+Math.sin(p.a)*sp,-MAP/2,MAP/2);
    p.body.unshift({x:p.x,y:p.y}); while(p.body.length>Math.floor(p.len))p.body.pop();
    for(let i=r.food.length-1;i>=0;i--){let f=r.food[i]; if(Math.hypot(p.x-f.x,p.y-f.y)<18){r.food.splice(i,1);p.len+=1.8*f.v;p.score+=Math.ceil(10*f.v);}}
  }
  for(const p of arr){
    let dead=false; if(Math.abs(p.x)>=MAP/2-3||Math.abs(p.y)>=MAP/2-3) dead=true;
    for(const o of arr){ if(dead)break; let start=o.id===p.id?10:2; for(let i=start;i<o.body.length;i+=2){ if(Math.hypot(p.x-o.body[i].x,p.y-o.body[i].y)<13){dead=true;break;} } }
    if(dead){ for(let i=0;i<p.body.length;i+=2)food(r,p.body[i].x,p.body[i].y,1.5); if(p.bot){r.players.delete(p.id); setTimeout(()=>rooms.has(r.id)&&bot(r),1200)} else {r.players.delete(p.id);} }
  }
 }}
function clean(){ const t=now(); for(const r of rooms.values()){ for(const [pid,p] of r.players) if(!p.bot&&t-p.last>30000) r.players.delete(pid); const humans=[...r.players.values()].filter(p=>!p.bot).length; if(humans===0&&t-r.created>60000) rooms.delete(r.id); }}
setInterval(()=>{let n=Date.now(),dt=(n-last)/50;last=n;step(dt);clean();},TICK);
function readBody(req){return new Promise(res=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{res(JSON.parse(b||'{}'))}catch{res({})}})})}
function send(res,obj){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj));}
const server=http.createServer(async(req,res)=>{ const u=new URL(req.url,'http://x');
 if(u.pathname==='/api/rooms')return send(res,roomList());
 if(u.pathname==='/api/join'&&req.method==='POST')return send(res,join(await readBody(req)));
 if(u.pathname==='/api/input'&&req.method==='POST')return send(res,input(await readBody(req)));
 if(u.pathname==='/api/leave'&&req.method==='POST'){let b=await readBody(req);return send(res,{ok:leave(b.playerId)});}
 if(u.pathname==='/api/state')return send(res,state({room:u.searchParams.get('room'),player:u.searchParams.get('player')}));
 let file=u.pathname==='/'?'index.html':u.pathname.slice(1); let p=path.join(__dirname,file); if(!p.startsWith(__dirname)||!fs.existsSync(p)) {res.writeHead(404);return res.end('Not found')}
 res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html':'text/plain'}); fs.createReadStream(p).pipe(res);
});
server.listen(PORT,()=>console.log('Slither compact running on '+PORT));
