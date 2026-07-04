# Slither Pro Live V2

Compact Render-ready multiplayer HTML slither arena.

## Files
- `index.html` — full game client, menu, skins, joystick, rendering
- `server.js` — HTTP + built-in WebSocket multiplayer server, no external packages
- `package.json` — zero dependencies
- `render.yaml` — Render config
- `README.md`

## Render settings
- Build Command: `npm run build`
- Start Command: `npm start`
- Root Directory: leave blank

## Fixed in V2
- Camera is pulled back for clearer gameplay.
- Smoother slither rendering.
- Death drops glowing food orbs for other players.
- Body collision/trapping makes players restart.
- Home button returns to the main menu.
- Server list only shows count like `0/15`.
- Added detailed wiener dog worm skin.
