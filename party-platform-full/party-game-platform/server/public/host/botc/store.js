// store.js
// Tiny shared state + pub/sub for the botc host UI. Every other file under
// public/host/botc/ imports `store` to read the latest data and calls
// `onStateChange` to react to it, instead of main.js manually calling into
// every file on every event -- each file only subscribes to what it renders.
export const store = {
  socket: window.__hostSocket,
  roomCode: null,
  roster: [], // [{ id, nickname, ready, connected }], from room:*/host:room-* events
  distributionTable: null, // meta.distributionTable, once received
  latestState: null, // the most recent host:botc-state payload's `state`
};

const listeners = [];

export function onStateChange(fn) {
  listeners.push(fn);
}

export function setState(patch) {
  Object.assign(store, patch);
  listeners.forEach((fn) => fn(store));
}
