// uploadStore.js
// In-memory pool of host-uploaded audio files. Server-wide (not per-room),
// persists until the server process restarts -- consistent with the
// platform's existing all-in-memory room state, no database.

const crypto = require("crypto");

const files = []; // { id, originalName, storedFilename, url, uploadedAt }

function addFile({ originalName, storedFilename }) {
  const file = {
    id: crypto.randomUUID(),
    originalName,
    storedFilename,
    url: `/uploads/${storedFilename}`,
    uploadedAt: Date.now(),
  };
  files.push(file);
  return file;
}

function listFiles() {
  return files.slice();
}

module.exports = { addFile, listFiles };
