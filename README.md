# Neon Worm Arena — Render Ready

A multiplayer Slither-style HTML game using Node.js, Express, and Socket.IO.

## Features
- 15 real-player cap with visible 0/15 status
- 5200x5200 arena: large, but not too huge
- Selectable neon worm skins
- Food, growth, boost cost, wall collision, body collision, respawn, leaderboard
- Mobile drag/swipe steering and desktop mouse/space controls
- Bots keep the arena active while waiting for players
- Render deployment files included

## Local run
```bash
npm install
npm start
```
Open:
```text
http://localhost:3000
```

## Render settings
Use these exact commands:

```bash
Build Command: npm install
Start Command: npm start
```

Set environment variables:
```text
NODE_VERSION=20
MAX_PLAYERS=15
MAP_SIZE=5200
```

Do not use `rpm install`; Render Node web services need npm commands.
