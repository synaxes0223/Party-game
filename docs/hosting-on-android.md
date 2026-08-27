# Hosting a party from an Android phone

The server is plain Node.js with three pure-JS dependencies (`express`,
`multer`, `socket.io`, plus `qrcode-svg`) and no native modules, so it runs
unmodified under Termux. There is no Android app to build — the phone runs the
same server your laptop does, and every player (including you) joins from a
browser.

This is the setup for an offline party: the host phone is the WiFi hotspot, and
nothing needs internet.

## One-time setup (do this at home, with internet)

1. **Install Termux from F-Droid**, not the Play Store. The Play Store build is
   abandoned and its package repos no longer work.
   <https://f-droid.org/packages/com.termux/>

2. In Termux:

   ```sh
   pkg update && pkg upgrade
   pkg install nodejs-lts git
   ```

3. Get the code onto the phone:

   ```sh
   git clone <your-repo-url> party_game
   cd party_game/party-platform-full/party-game-platform/server
   npm install
   ```

4. Smoke-test it while you still have internet:

   ```sh
   npm start
   ```

   You should see something like:

   ```
   Server running on port 3000
   Host:    http://localhost:3000/host/
   Players: http://192.168.1.42:3000/player/  <-- try this one first
   ```

   Open `http://localhost:3000/host/` in the phone's browser. Stop the server
   with `Ctrl-C` when you are done.

5. **Required** — install the Termux:API companion app so
   `termux-wake-lock` works, and turn off battery optimisation for Termux
   (Settings → Apps → Termux → Battery → Unrestricted). Without this Android
   will suspend the server a few minutes after you switch away from Termux.

   Game state lives only in the server
   process's memory — there is no save file. Players and the host can now drop
   their connections and reclaim their seats, but if Android kills the Node
   process itself, the game is gone.

## At the party

1. Turn on the phone's **hotspot**. Everyone joins that hotspot.

2. In Termux:

   ```sh
   termux-wake-lock
   cd party_game/party-platform-full/party-game-platform/server
   npm start
   ```

3. Open `http://localhost:3000/host/` on the host phone and create a room.
   The lobby shows the room code, the join URL, and a **QR code** — players
   point their camera at it instead of typing an IP.

   The join URL comes from the server's own network interfaces, not from the
   browser address bar, so it stays correct even though you opened the host
   page on `localhost`. When the phone has more than one address (hotspot *and*
   WiFi client), the lobby lists the alternatives underneath the QR code.

   Players who would rather type than scan can enter just the address — the
   bare `192.168.43.1:3000` redirects to the player page, no path needed.

4. When you are done: `Ctrl-C`, then `termux-wake-unlock`.

## What does not work offline

- **YouTube audio sources.** The YouTube tab needs to reach youtube.com. The
  host page probes for real connectivity when the track-select screen opens and
  disables that tab with an explanatory notice when there is none. Use the
  built-in pairs or upload files instead.
- **Uploaded files and built-in tracks work fine** — they are served from the
  phone. Upload the files at home over WiFi so they are already on the device.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Startup says `No LAN address found` | Hotspot and WiFi are both off. Turn the hotspot on, then restart the server. |
| QR code scans but the page never loads | Players are on a different network. Confirm they joined *your* hotspot, not a nearby WiFi. |
| Some phones connect, one cannot | A few vendor hotspot builds isolate clients. Try the alternative URL shown under the QR, or fall back to a normal WiFi router that everyone joins. |
| Server dies after a few minutes | Wake lock or battery optimisation. Run `termux-wake-lock` and set Termux to Unrestricted battery use. |
| `npm start` fails with `EADDRINUSE` | A previous run is still alive. `pkill node`, then start again. |
| Want a different port | `PORT=8080 npm start`. The banner and the QR code follow the change automatically. |
| A player's phone slept and they came back to a blank page | Expected — reloading `/player/` rejoins them to their seat automatically, as long as they use the same browser (the session token lives in that browser's storage). A different browser or a cleared cache is a new player. |
| The host tab reloaded and the game vanished | The room survives a host reload; the host lands back in the lobby, not the mid-game screen. Re-enter the game from there. If the server process itself restarted, the game is lost. |

## Why not a real Android app

An APK that embeds the server (via `nodejs-mobile-react-native`) was scaffolded
early on and abandoned: it needs the full Android SDK + NDK toolchain to build,
and buys nothing over Termux when the host is a single technical user. If the
goal ever becomes "hand the app to a friend", that decision is worth revisiting
— the server code itself needs no changes either way.
