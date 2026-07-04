const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 20000,
  pingInterval: 10000,
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 15);
const MAP_SIZE = Number(process.env.MAP_SIZE || 5200);
const TICK_RATE = 30;
const SNAPSHOT_RATE = 15;
const FOOD_TARGET = 440;
const BOT_TARGET = 6;
const PLAYER_RADIUS = 11;
const BASE_SPEED = 150;
const BOOST_SPEED = 245;
const BOT_PREFIX = 'bot:';

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true, players: players.size, maxPlayers: MAX_PLAYERS }));

const players = new Map();
const foods = new Map();
const inputs = new Map();
let foodSeq = 1;
let botSeq = 1;

const skins = [
  { id: 'aurora', colors: ['#00f5ff', '#7c3cff', '#ff4ecd'] },
  { id: 'citrus', colors: ['#fff95b', '#ff9f1c', '#2ec4b6'] },
  { id: 'berry', colors: ['#ff4ecd', '#9b5de5', '#00bbf9'] },
  { id: 'mint', colors: ['#80ffdb', '#48bfe3', '#64dfdf'] },
  { id: 'lava', colors: ['#ff3c38', '#ff8c42', '#ffd166'] },
  { id: 'cosmic', colors: ['#f72585', '#7209b7', '#3a0ca3'] }
];

function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function safeName(name) { return String(name || 'Player').replace(/[<>]/g, '').trim().slice(0, 16) || 'Player'; }
function randomSkin(id) { return skins.find(s => s.id === id) || skins[Math.floor(Math.random() * skins.length)]; }
function spawnPoint() {
  for (let i = 0; i < 60; i++) {
    const p = { x: rand(-MAP_SIZE * 0.42, MAP_SIZE * 0.42), y: rand(-MAP_SIZE * 0.42, MAP_SIZE * 0.42) };
    let ok = true;
    for (const pl of players.values()) {
      if (dist2(p, pl.head) < 360 * 360) { ok = false; break; }
    }
    if (ok) return p;
  }
  return { x: rand(-600, 600), y: rand(-600, 600) };
}
function makeSegments(head, angle, count) {
  const segs = [];
  for (let i = 0; i < count; i++) segs.push({ x: head.x - Math.cos(angle) * i * 14, y: head.y - Math.sin(angle) * i * 14 });
  return segs;
}
function newPlayer(id, name, skinId, isBot = false) {
  const head = spawnPoint();
  const angle = rand(0, Math.PI * 2);
  const skin = randomSkin(skinId);
  return {
    id, name: safeName(name), skin: skin.id, colors: skin.colors, head, angle, targetAngle: angle,
    segments: makeSegments(head, angle, 20), score: 0, length: 20, alive: true, boost: false,
    lastBoostFood: 0, invincible: 1.8, isBot, turnSpeed: isBot ? 2.2 : 4.4, botThink: 0, botTarget: null
  };
}
function addFood(x = rand(-MAP_SIZE / 2, MAP_SIZE / 2), y = rand(-MAP_SIZE / 2, MAP_SIZE / 2), value = 1, hue = null) {
  const id = 'f' + foodSeq++;
  foods.set(id, { id, x, y, value, hue: hue ?? Math.floor(rand(0, 360)), pulse: rand(0, 9) });
}
function ensureFood() { while (foods.size < FOOD_TARGET) addFood(); }
function ensureBots() {
  const humanCount = [...players.values()].filter(p => !p.isBot).length;
  const botCount = [...players.values()].filter(p => p.isBot).length;
  const wanted = Math.max(0, Math.min(BOT_TARGET, 10 - humanCount));
  while (botCount + [...players.values()].filter(p => p.isBot).length - botCount < wanted) {
    const id = BOT_PREFIX + botSeq++;
    players.set(id, newPlayer(id, ['Nova','Orbit','Viper','Comet','Pixel','Ziggy'][botSeq % 6], skins[botSeq % skins.length].id, true));
  }
  for (const [id, p] of players) {
    if (p.isBot && [...players.values()].filter(x => x.isBot).length > wanted) players.delete(id);
  }
}
function angleDiff(a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }
function turnToward(p, target, dt) {
  const max = p.turnSpeed * dt;
  const d = clamp(angleDiff(p.angle, target), -max, max);
  p.angle += d;
}
function killPlayer(victim, killerName = '') {
  if (!victim.alive) return;
  victim.alive = false;
  for (let i = 0; i < victim.segments.length; i += 2) {
    const s = victim.segments[i];
    addFood(s.x + rand(-8, 8), s.y + rand(-8, 8), Math.max(1, Math.floor(victim.length / 25)), 320);
  }
  if (!victim.isBot) io.to(victim.id).emit('dead', { score: victim.score, killerName });
  else players.delete(victim.id);
}
function updateBot(p, dt) {
  p.botThink -= dt;
  if (p.botThink <= 0) {
    p.botThink = rand(0.3, 0.9);
    let closest = null, best = Infinity;
    for (const f of foods.values()) {
      const d = dist2(p.head, f);
      if (d < best) { best = d; closest = f; }
    }
    p.botTarget = closest;
  }
  let targetAngle = p.angle + rand(-0.15, 0.15);
  if (p.botTarget) targetAngle = Math.atan2(p.botTarget.y - p.head.y, p.botTarget.x - p.head.x);
  if (Math.abs(p.head.x) > MAP_SIZE * 0.44 || Math.abs(p.head.y) > MAP_SIZE * 0.44) targetAngle = Math.atan2(-p.head.y, -p.head.x);
  p.boost = p.length > 35 && Math.random() < 0.03;
  turnToward(p, targetAngle, dt);
}
function step(dt) {
  ensureFood();
  ensureBots();
  for (const p of players.values()) {
    if (!p.alive) continue;
    if (p.isBot) updateBot(p, dt);
    else {
      const inp = inputs.get(p.id);
      if (inp) { p.targetAngle = inp.angle; p.boost = !!inp.boost && p.length > 24; }
      turnToward(p, p.targetAngle, dt);
    }
    p.invincible = Math.max(0, p.invincible - dt);
    const speed = p.boost ? BOOST_SPEED : BASE_SPEED;
    p.head.x += Math.cos(p.angle) * speed * dt;
    p.head.y += Math.sin(p.angle) * speed * dt;
    p.head.x = clamp(p.head.x, -MAP_SIZE / 2, MAP_SIZE / 2);
    p.head.y = clamp(p.head.y, -MAP_SIZE / 2, MAP_SIZE / 2);
    p.segments.unshift({ x: p.head.x, y: p.head.y });
    const maxLen = Math.floor(p.length);
    while (p.segments.length > maxLen) p.segments.pop();
    if (p.boost && Date.now() - p.lastBoostFood > 180) {
      p.lastBoostFood = Date.now(); p.length = Math.max(18, p.length - 0.35); p.score = Math.max(0, p.score - 1);
      const tail = p.segments[p.segments.length - 1]; if (tail) addFood(tail.x, tail.y, 1, 45);
    }
    for (const [id, f] of foods) {
      if (dist2(p.head, f) < (PLAYER_RADIUS + 14) ** 2) {
        foods.delete(id); p.score += f.value * 5; p.length += 0.9 + f.value * 0.18;
      }
    }
  }
  for (const p of players.values()) {
    if (!p.alive || p.invincible > 0) continue;
    if (Math.abs(p.head.x) >= MAP_SIZE / 2 - 2 || Math.abs(p.head.y) >= MAP_SIZE / 2 - 2) { killPlayer(p, 'the arena wall'); continue; }
    for (const other of players.values()) {
      if (!other.alive || other.id === p.id && p.invincible > 0) continue;
      const start = other.id === p.id ? 14 : 5;
      for (let i = start; i < other.segments.length; i += 3) {
        const s = other.segments[i];
        if (dist2(p.head, s) < (PLAYER_RADIUS + 7) ** 2) { killPlayer(p, other.id === p.id ? 'your own tail' : other.name); break; }
      }
      if (!p.alive) break;
    }
  }
}
function snapshot() {
  const board = [...players.values()].filter(p => p.alive).sort((a,b)=>b.score-a.score).slice(0,8).map(p=>({name:p.name,score:Math.floor(p.score),id:p.id}));
  const viewPlayers = [...players.values()].filter(p => p.alive).map(p => ({
    id:p.id,name:p.name,skin:p.skin,colors:p.colors,x:p.head.x,y:p.head.y,angle:p.angle,score:Math.floor(p.score),length:Math.floor(p.length),boost:p.boost,segments:p.segments.filter((_,i)=>i%2===0)
  }));
  io.emit('state', { t: Date.now(), mapSize: MAP_SIZE, players: viewPlayers, foods: [...foods.values()], leaderboard: board, count: [...players.values()].filter(p=>!p.isBot && p.alive).length, max: MAX_PLAYERS });
}

io.on('connection', socket => {
  socket.emit('serverInfo', { count: [...players.values()].filter(p=>!p.isBot && p.alive).length, max: MAX_PLAYERS, mapSize: MAP_SIZE, skins });
  socket.on('join', ({ name, skin }) => {
    const humans = [...players.values()].filter(p => !p.isBot && p.alive).length;
    if (humans >= MAX_PLAYERS) return socket.emit('full', { message: 'Server is full. Please try again soon.' });
    const p = newPlayer(socket.id, name, skin, false);
    players.set(socket.id, p);
    inputs.set(socket.id, { angle: p.angle, boost: false });
    socket.emit('joined', { id: socket.id, mapSize: MAP_SIZE, player: p });
  });
  socket.on('input', data => {
    if (!players.has(socket.id)) return;
    const angle = Number(data.angle);
    if (Number.isFinite(angle)) inputs.set(socket.id, { angle, boost: !!data.boost });
  });
  socket.on('respawn', ({ name, skin }) => {
    players.delete(socket.id); inputs.delete(socket.id);
    const humans = [...players.values()].filter(p => !p.isBot && p.alive).length;
    if (humans < MAX_PLAYERS) {
      const p = newPlayer(socket.id, name, skin, false); players.set(socket.id, p); inputs.set(socket.id, { angle: p.angle, boost: false }); socket.emit('joined', { id: socket.id, mapSize: MAP_SIZE, player: p });
    }
  });
  socket.on('disconnect', () => { players.delete(socket.id); inputs.delete(socket.id); });
});

ensureFood();
setInterval(() => step(1 / TICK_RATE), 1000 / TICK_RATE);
setInterval(snapshot, 1000 / SNAPSHOT_RATE);
server.listen(PORT, () => console.log(`Neon Worm Arena running on ${PORT}`));
