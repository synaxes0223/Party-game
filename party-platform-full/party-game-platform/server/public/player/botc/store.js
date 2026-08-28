// store.js
// Tiny shared state for the botc player UI. Every other file under
// public/player/botc/ imports `store` to read the latest data (just the
// socket and the room code -- much smaller than the host UI's store.js,
// since a player never sees a roster or a distribution table). No pub/sub
// here unlike the host UI's store.js: every player screen reacts directly
// to its own targeted socket event (game:botc-role, game:botc-your-turn,
// etc.), not to a shared "latest state" object, so there is nothing for a
// second file to subscribe to.
export const store = {
  socket: window.__playerSocket,
  roomCode: null,
};

export function setState(patch) {
  Object.assign(store, patch);
}
