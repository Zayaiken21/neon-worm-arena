const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000, WORLD=5600, MAX=15, TICK=30, SNAP=18;
function file(res){fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{res.writeHead(e?404:200,{'Content-Type':e?'text/plain':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(e?'index.html missing':d)})}
const srv=http.createServer((req,res)=>file(res));
const arena={players:new Map(),food:[],lastSnap:0};
const rand=n=>Math.random()*n, clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), hypot=Math.hypot;
function alivePlayers(){return [...arena.players.values()].filter(p=>p.alive)}
function addFood(n=360){while(arena.food.length<n)arena.food.push({x:rand(WORLD-120)+60,y:rand(WORLD-120)+60,r:5+rand(4),h:Math.floor(rand(360)),v:1})}
function spawn(p){let x=400+rand(WORLD-800),y=400+rand(WORLD-800),a=rand(Math.PI*2);Object.assign(p,{x,y,a,ta:a,boost:false,alive:true,score:72,deadAt:0,trail:[]});for(let i=0;i<74;i++)p.trail.push({x:x-Math.cos(a)*i*8.5,y:y-Math.sin(a)*i*8.5});}
function turn(a,t,m){let d=((t-a+Math.PI*3)%(Math.PI*2))-Math.PI;return a+clamp(d,-m,m)}
function dropTail(p,count=1){let t=p.trail[p.trail.length-1];if(!t)return;for(let i=0;i<count;i++)arena.food.push({x:t.x+rand(18)-9,y:t.y+rand(18)-9,r:5+rand(3),h:p.skin==='dog'?28:Math.floor(rand(360)),v:2})}
function die(p){if(!p.alive)return;p.alive=false;p.deadAt=Date.now();for(let i=1;i<p.trail.length;i+=4){let q=p.trail[i];arena.food.push({x:q.x+rand(20)-10,y:q.y+rand(20)-10,r:6+rand(4),h:p.skin==='dog'?28:Math.floor(rand(360)),v:3});}p.trail=[];}
function state(){let players=alivePlayers().map(p=>({id:p.id,name:p.name,skin:p.skin,x:p.x,y:p.y,a:p.a,score:Math.floor(p.score),trail:p.trail.filter((_,i)=>i%2===0)}));return JSON.stringify({t:'state',world:WORLD,alive:players.length,max:MAX,food:arena.food.slice(0,520),players});}
function broadcast(force=false){let now=Date.now();if(!force&&now-arena.lastSnap<1000/SNAP)return;arena.lastSnap=now;let msg=state();for(const p of arena.players.values())if(p.ws&&p.ws.readyState===1)send(p.ws,msg);}
function step(){addFood();for(const p of arena.players.values()){
 if(!p.alive){if(Date.now()-p.deadAt>1200)spawn(p);continue;}
 p.a=turn(p.a,p.ta,0.22);let boosting=p.boost&&p.score>24&&p.trail.length>26;let speed=boosting?8.9:6.25;
 p.x+=Math.cos(p.a)*speed;p.y+=Math.sin(p.a)*speed;
 if(p.x<28||p.y<28||p.x>WORLD-28||p.y>WORLD-28){die(p);continue;}
 p.trail.unshift({x:p.x,y:p.y});let maxLen=Math.max(20,Math.floor(p.score*1.28));while(p.trail.length>maxLen)p.trail.pop();
 if(boosting){p.score=Math.max(20,p.score-.46); if(p.trail.length>22)p.trail.pop(); if(Math.random()<.9)dropTail(p,1);}
 for(let i=arena.food.length-1;i>=0;i--){let f=arena.food[i];if(hypot(p.x-f.x,p.y-f.y)<22+f.r){p.score+=f.v?3.2:2.0;arena.food.splice(i,1);}}
 for(const o of arena.players.values()){if(!o.alive||o.id===p.id)continue;for(let i=6;i<o.trail.length;i+=3){let q=o.trail[i];if(hypot(p.x-q.x,p.y-q.y)<23){die(p);break;}}if(!p.alive)break;}
}
broadcast();}
setInterval(step,1000/TICK);
function makeFrame(s){let b=Buffer.from(s),h;if(b.length<126)h=Buffer.from([129,b.length]);else{h=Buffer.alloc(4);h[0]=129;h[1]=126;h.writeUInt16BE(b.length,2)}return Buffer.concat([h,b]);}
function send(sock,s){try{sock.write(makeFrame(s))}catch(e){}}
function decode(buf){if(buf.length<6)return null;let len=buf[1]&127,off=2;if(len===126){len=buf.readUInt16BE(2);off=4}else if(len===127)return null;let mask=buf.slice(off,off+4);off+=4;if(buf.length<off+len)return null;let out=Buffer.alloc(len);for(let i=0;i<len;i++)out[i]=buf[off+i]^mask[i%4];return out.toString();}
srv.on('upgrade',(req,socket)=>{let key=req.headers['sec-websocket-key'];if(!key){socket.destroy();return;}let accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.readyState=1;let p={id:crypto.randomBytes(5).toString('hex'),name:'Player',skin:'aqua',ws:socket};arena.players.set(p.id,p);spawn(p);send(socket,JSON.stringify({t:'hello',id:p.id,alive:alivePlayers().length,max:MAX}));broadcast(true);
 socket.on('data',buf=>{try{let raw=decode(buf);if(!raw)return;let m=JSON.parse(raw);if(m.t==='join'){p.name=String(m.name||'Player').replace(/[<>]/g,'').slice(0,14)||'Player';p.skin=['aqua','orange','purple','green','pink','dog','galaxy'].includes(m.skin)?m.skin:'aqua';broadcast(true);}else if(m.t==='input'){let a=Number(m.a);if(Number.isFinite(a))p.ta=a;p.boost=!!m.boost;}else if(m.t==='home'){arena.players.delete(p.id);broadcast(true);socket.end();}}catch(e){}});
 socket.on('close',()=>{arena.players.delete(p.id);broadcast(true)});socket.on('error',()=>{arena.players.delete(p.id);broadcast(true)});
});
srv.listen(PORT,()=>console.log('Slither Pro Engagement running on '+PORT));
