# Party Game Platform — Prototype

A working prototype of the platform shell + one game: **Find the Imposter**.

Host creates a room from a laptop (or any device on the WiFi), players join
from their own phones via browser (no app install), and everyone hears audio
through their own earphones — one player secretly gets a different track.

## What's included

- **Room system**: create/join rooms via 4-letter code, nickname-only players
  (Kahoot-style, no accounts)
- **Game registry**: plug-in style — new games register themselves without
  touching platform code (see `server/games/registry.js`)
- **Find the Imposter**: the first game — assigns one random player a
  different audio track, synced playback across all devices, voting, reveal
- **Audio sync engine**: server tells every client "play at timestamp X" so
  playback starts within ~tens of milliseconds across devices, even though
  each device may be playing a *different* file

## Project structure

```
server/
  index.js              — Express + Socket.io entry point, wires events to services
  roomService.js         — room lifecycle (create/join/leave), game-agnostic
  games/
    registry.js           — list of available games (add new games here)
    findTheImposter.js    — imposter game logic (song assignment, votes, reveal)
  audio/
    normal-song1.mp3      — placeholder track (440Hz tone)
    imposter-song1.mp3    — placeholder "imposter" track (same tone + tremolo effect)
  public/
    host/                 — host web page (create room, lobby, start game, results)
    player/                — player web page (join, audio-ready, vote, results)
```

## Running it

```bash
cd server
npm install
npm start
```

You'll see output like:

```
Server running on port 3000
Local:  http://localhost:3000
Network: http://192.168.1.42:3000  <-- use this on phones (same WiFi)
```

- **Host**: open `http://localhost:3000/host/` on your laptop
- **Players**: open the **Network** URL shown (e.g. `http://192.168.1.42:3000/player/`)
  on their phones — they must be on the **same WiFi network** as the host machine
- Tip: generate a QR code for that network URL (e.g. via any free QR generator)
  so players can scan instead of typing it — this isn't built into the
  prototype yet but is a natural next addition

## Swapping in real songs

Replace the placeholder files in `server/audio/` with real MP3s, then update
`SONG_PAIRS` in `server/games/findTheImposter.js`:

```js
const SONG_PAIRS = [
  {
    id: "pair1",
    label: "Some Song Name",
    normalUrl: "/audio/normal-song1.mp3",
    imposterUrl: "/audio/imposter-song1.mp3",
  },
  // add more pairs — one gets picked at random each round
];
```

Design tip carried over from our discussion: the imposter track works best as
a **subtle** variation (different instrument mixed out, slight pitch/tempo
shift, added filter) rather than a completely different song — makes the
guessing genuinely fun instead of obvious.

**Note on copyrighted music**: for a private party this is generally fine,
but if you ever plan to distribute this platform publicly or use it
commercially, using copyrighted songs would need proper licensing.

## Known limitations (prototype-stage, by design)

- **iOS Safari audio autoplay** (Find the Imposter): handled via the
  "I'm Ready" tap-to-prime step before sync playback — required for iOS to
  allow the later timed `play()` call to succeed without another user gesture
- **Sync precision** (Find the Imposter): ~1.5s buffer before playback start
  to smooth out network jitter across devices; fine for casual party use, not
  frame-accurate
- **Join QR code**: the host page shows a QR code for the best-guess LAN join
  URL (built by `server/lanInfo.js` and served from `/api/join-info`).
  The address is guessed from the host's network interfaces, so on machines
  with several interfaces (e.g. WiFi client + hotspot) the QR may point at
  an unreachable address and players have to use one of the other listed URLs
- **One built-in song pair only** (Find the Imposter): add more to
  `SONG_PAIRS` for variety across rounds, or use a pasted YouTube pair or
  uploaded files instead
- **Reconnects are token-based**: each browser keeps a session token in
  `localStorage`. A player who drops WiFi and comes back with the same token
  reclaims their seat, even mid-game, and a returning host reclaims the
  room. Players who clear storage or switch browser/device get a new token
  and can only join as new players while the room is still in the lobby.
  Rooms where nobody is connected are deleted after about 10 minutes

## Extending the platform with a new game

1. Create `server/games/yourGame.js` exporting `{ meta, onStart, ... }`
   following the pattern in `findTheImposter.js`
2. Register it in `server/games/registry.js`
3. It automatically appears in the host's game-selection list — no other
   platform code changes needed

This plug-in structure is the main architectural bet of the prototype: the
room/lobby/player system stays generic, and each game is a self-contained
module.
