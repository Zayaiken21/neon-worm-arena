# Neon Worm Arena

A Render-ready multiplayer Slither-style HTML game using Node.js, Express, and Socket.IO.

## Features
- 15 real-player server cap with visible 0/15 status
- Big balanced 5200x5200 arena
- Selectable neon worm skins
- Food, growth, boost cost, body collision, wall collision, leaderboard
- Mobile drag/swipe steering and desktop mouse/space controls
- Bots fill empty space so the arena feels alive while waiting for users
- Render deployment files included

## Run locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.

## Deploy on Render
1. Upload/push this folder to GitHub.
2. On Render, create a new **Web Service**.
3. Build command: `npm install`
4. Start command: `npm start`
5. Node version: `20`

`render.yaml` is included if you want Blueprint deployment.
