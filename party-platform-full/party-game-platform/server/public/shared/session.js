// session.js
// The player's identity, persisted so a reload or a dropped connection can
// reclaim the same seat. Loaded before the page script; exposes one global.
(function () {
  const STORAGE_KEY = "party-session-token";

  function makeToken() {
    if (window.crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  let token = null;
  try {
    token = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    token = null; // private browsing: fall through to a per-page token
  }

  if (!token) {
    token = makeToken();
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch (err) {
      // Not persisted — reconnection will not work, but nothing breaks.
    }
  }

  window.sessionToken = token;
})();
