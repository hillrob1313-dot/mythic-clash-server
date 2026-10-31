# Mythic Clash — Online Multiplayer Server

## Features
- Private room codes and public lobby browser
- Live room membership and host migration
- Server-authoritative trivia combat: turns, answer validation, HP, score, damage, match timer, winner
- Each player answers on their own device; only the active player can submit
- Up to 10 players per room

## Run locally
1. Install Node.js 18+
2. Open terminal in this folder
3. Run `npm install`
4. Run `npm start`
5. Visit `http://localhost:3000` on the host and other devices on the same Wi-Fi using the host computer's LAN IP.

## Deploy publicly
Deploy this folder to a Node.js host supporting persistent WebSockets (Render, Railway, etc). Start command: `npm start`. Share the public URL. Server uses `process.env.PORT`.

## Gameplay
Host creates a public or private room, at least 2 players join, and host presses Start Match. Online match opens a synced battle interface. Every turn the active player selects an answer and attacks the first living opponent. Server validates answers, updates HP/score, advances turns, and broadcasts the shared state. The match ends when only one fighter remains or the match timer expires.

## Note
This is the first synchronized multiplayer combat implementation. It uses a dedicated online battle UI layer over the existing local arena. It does not yet synchronize character-specific abilities, cinematic attacks, or custom target selection.
