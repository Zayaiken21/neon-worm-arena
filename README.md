# Neon Worm Arena

Render-ready Node.js multiplayer worm arena.

## Render Settings

- Environment: Node
- Build Command: `npm install --no-audit --no-fund --loglevel=error`
- Start Command: `npm start`
- Root Directory: leave blank

## Critical Fix

This version removes `package-lock.json` and adds `.npmrc` using the public npm registry. The previous lock file could make Render hang during `npm install` because it pointed to internal package registry URLs.
