// sessionToken.js
// A player's identity is a token they generate and keep in localStorage, not
// their socket id — socket ids change on every reconnect, and game state is
// indexed by player id. The server never issues these; it only checks that a
// supplied one has a sane shape before using it as a map key and a socket.io
// room name.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function isValidToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

module.exports = { isValidToken };
