const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const WORLD = 5600;
const MAX_PLAYERS = 15;
const TICK_HZ = 30;
const SNAP_HZ = 18;
const FOOD_TARGET = 380;

const arena = { players: new Map(), food: [], lastSnap: 0 };
const rand = n => Math.random() * n;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = Math.hypot;

function html(res) {
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    res.writeHead(err ? 404 : 200, {
      'Content-Type': err ? 'text/plain' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(err ? 'index.html missing' : data);
  });
}

const server = http.createServer((req, res) => html(res));

function alivePlayers() { return [...arena.players.values()].filter(p => p.joined && p.alive); }
function addFood(target = FOOD_TARGET) {
  while (arena.food.length < target) {
    arena.food.push({ x: 80 + rand(WORLD - 160), y: 80 + rand(WORLD - 160), r: 5 + rand(4), h: Math.floor(rand(360)), v: 2 });
  }
}
function sanitizeName(name) {
  return String(name || 'Player').replace(/[<>]/g, '').trim().slice(0, 14) || 'Player';
}
function goodSkin(s) {
  return ['aqua', 'orange', 'purple', 'green', 'pink', 'dog', 'galaxy'].includes(s) ? s : 'aqua';
}
function spawn(p) {
  const a = rand(Math.PI * 2);
  const x = 500 + rand(WORLD - 1000);
  const y = 500 + rand(WORLD - 1000);
  p.x = x; p.y = y; p.a = a; p.ta = a;
  p.boost = false; p.alive = true; p.deadAt = 0; p.joined = true;
  p.score = p.score && p.score > 40 ? Math.max(50, Math.floor(p.score * 0.45)) : 75;
  p.trail = [];
  for (let i = 0; i < Math.floor(p.score * 1.25); i++) {
    p.trail.push({ x: x - Math.cos(a) * i * 8.3, y: y - Math.sin(a) * i * 8.3 });
  }
}
function turnToward(a, t, max) {
  const d = ((t - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + clamp(d, -max, max);
}
function tailPoint(p) { return p.trail[p.trail.length - 1] || { x: p.x, y: p.y }; }
function dropFromTail(p, count = 1, value = 1.4) {
  const t = tailPoint(p);
  for (let i = 0; i < count; i++) {
    arena.food.push({
      x: t.x + rand(16) - 8,
      y: t.y + rand(16) - 8,
      r: 4.5 + rand(2.5),
      h: p.skin === 'dog' ? 28 : (p.hue || Math.floor(rand(360))),
      v: value
    });
  }
}
function die(p) {
  if (!p.alive) return;
  p.alive = false;
  p.boost = false;
  p.deadAt = Date.now();
  for (let i = 0; i < p.trail.length; i += 3) {
    const q = p.trail[i];
    arena.food.push({ x: q.x + rand(20) - 10, y: q.y + rand(20) - 10, r: 5.5 + rand(4), h: p.skin === 'dog' ? 28 : (p.hue || Math.floor(rand(360))), v: 3 });
  }
  p.trail = [];
}
function compactState() {
  const players = alivePlayers().map(p => ({
    id: p.id,
    name: p.name,
    skin: p.skin,
    x: Math.round(p.x),
    y: Math.round(p.y),
    a: +p.a.toFixed(3),
    score: Math.floor(p.score),
    trail: p.trail.filter((_, i) => i % 2 === 0).map(q => ({ x: Math.round(q.x), y: Math.round(q.y) }))
  }));
  players.sort((a, b) => b.score - a.score);
  return JSON.stringify({ t: 'state', world: WORLD, alive: players.length, max: MAX_PLAYERS, food: arena.food.slice(0, 520), players });
}
function makeFrame(str) {
  const b = Buffer.from(str);
  if (b.length < 126) return Buffer.concat([Buffer.from([129, b.length]), b]);
  const h = Buffer.alloc(4); h[0] = 129; h[1] = 126; h.writeUInt16BE(b.length, 2);
  return Buffer.concat([h, b]);
}
function send(sock, str) { try { if (!sock.destroyed) sock.write(makeFrame(str)); } catch (_) {} }
function broadcast(force = false) {
  const now = Date.now();
  if (!force && now - arena.lastSnap < 1000 / SNAP_HZ) return;
  arena.lastSnap = now;
  const msg = compactState();
  for (const p of arena.players.values()) if (p.ws && !p.ws.destroyed) send(p.ws, msg);
}
function step() {
  addFood();
  const now = Date.now();
  for (const p of arena.players.values()) {
    if (!p.joined) continue;
    if (!p.alive) {
      if (now - p.deadAt > 1600) spawn(p);
      continue;
    }
    p.a = turnToward(p.a, p.ta, 0.26);
    const boosting = !!p.boost && p.score > 22 && p.trail.length > 24;
    const speed = boosting ? 9.2 : 6.7;
    p.x += Math.cos(p.a) * speed;
    p.y += Math.sin(p.a) * speed;

    if (p.x < 32 || p.y < 32 || p.x > WORLD - 32 || p.y > WORLD - 32) { die(p); continue; }

    p.trail.unshift({ x: p.x, y: p.y });
    const maxLen = Math.max(18, Math.floor(p.score * 1.28));
    while (p.trail.length > maxLen) p.trail.pop();

    if (boosting) {
      p.score = Math.max(20, p.score - 0.62);
      if (p.trail.length > 20) p.trail.pop();
      dropFromTail(p, 1, 1.2);
    }

    for (let i = arena.food.length - 1; i >= 0; i--) {
      const f = arena.food[i];
      if (dist(p.x - f.x, p.y - f.y) < 22 + f.r) {
        p.score += f.v || 2;
        arena.food.splice(i, 1);
      }
    }

    for (const o of arena.players.values()) {
      if (!o.alive || !o.joined || o.id === p.id) continue; // own body is safe
      for (let i = 5; i < o.trail.length; i += 3) {
        const q = o.trail[i];
        if (dist(p.x - q.x, p.y - q.y) < 23) { die(p); break; }
      }
      if (!p.alive) break;
    }
  }
  broadcast();
}
setInterval(step, 1000 / TICK_HZ);

function decodeFrame(buf) {
  if (buf.length < 6) return null;
  const op = buf[0] & 15;
  if (op === 8) return '__close__';
  let len = buf[1] & 127, off = 2;
  if (len === 126) { if (buf.length < 8) return null; len = buf.readUInt16BE(2); off = 4; }
  if (len === 127) return null;
  const masked = !!(buf[1] & 128);
  if (!masked || buf.length < off + 4 + len) return null;
  const mask = buf.slice(off, off + 4); off += 4;
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) out[i] = buf[off + i] ^ mask[i % 4];
  return out.toString();
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  const id = crypto.randomBytes(5).toString('hex');
  const p = { id, name: 'Player', skin: 'aqua', hue: Math.floor(rand(360)), ws: socket, joined: false, alive: false, score: 75, trail: [], a: 0, ta: 0, boost: false };
  arena.players.set(id, p);
  send(socket, JSON.stringify({ t: 'hello', id, alive: alivePlayers().length, max: MAX_PLAYERS }));
  broadcast(true);

  socket.on('data', buf => {
    try {
      const raw = decodeFrame(buf);
      if (!raw || raw === '__close__') return;
      const m = JSON.parse(raw);
      if (m.t === 'join') {
        if (alivePlayers().length >= MAX_PLAYERS && !p.alive) return send(socket, JSON.stringify({ t: 'full' }));
        p.name = sanitizeName(m.name);
        p.skin = goodSkin(m.skin);
        spawn(p);
        send(socket, JSON.stringify({ t: 'spawned', id: p.id }));
        broadcast(true);
      } else if (m.t === 'input' && p.joined) {
        const a = Number(m.a);
        if (Number.isFinite(a)) p.ta = a;
        p.boost = !!m.boost;
      } else if (m.t === 'home') {
        arena.players.delete(p.id);
        broadcast(true);
        try { socket.end(); } catch (_) {}
      }
    } catch (_) {}
  });
  const cleanup = () => { arena.players.delete(p.id); broadcast(true); };
  socket.on('close', cleanup);
  socket.on('end', cleanup);
  socket.on('error', cleanup);
});

server.listen(PORT, () => console.log('Slither Pro Ready running on port ' + PORT));
