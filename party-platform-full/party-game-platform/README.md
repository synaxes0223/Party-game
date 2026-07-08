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

- **iOS Safari audio autoplay**: handled via the "I'm Ready" tap-to-prime
  step before sync playback — required for iOS to allow the later
  timed `play()` call to succeed without another user gesture
- **Sync precision**: ~1.5s buffer before playback start to smooth out
  network jitter across devices; fine for casual party use, not
  frame-accurate
- **No QR code generation yet**: players currently type the room code/URL
  manually
- **One song pair only**: add more to `SONG_PAIRS` for variety across rounds
- **No reconnect handling**: if a player's phone drops WiFi mid-game, they
  need to rejoin as a new player (room state doesn't currently support
  resuming a dropped session)

## Extending the platform with a new game

1. Create `server/games/yourGame.js` exporting `{ meta, onStart, ... }`
   following the pattern in `findTheImposter.js`
2. Register it in `server/games/registry.js`
3. It automatically appears in the host's game-selection list — no other
   platform code changes needed

This plug-in structure is the main architectural bet of the prototype: the
room/lobby/player system stays generic, and each game is a self-contained
module.
