const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseYouTubeVideoId,
  buildYoutubePair,
  pickUploadPair,
  computePlayerPosition,
} = require("../games/audioSourceLogic");

test("parseYouTubeVideoId extracts the id from watch, embed, and short URLs", () => {
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("parseYouTubeVideoId returns null for unparseable input", () => {
  assert.equal(parseYouTubeVideoId("not a url"), null);
  assert.equal(parseYouTubeVideoId(""), null);
  assert.equal(parseYouTubeVideoId(undefined), null);
});

test("buildYoutubePair ignores any timestamp embedded in the URL, using the explicit field", () => {
  const result = buildYoutubePair(
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=999s", startSeconds: 10 },
    { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 40 }
  );
  assert.equal(result.normal.startSeconds, 10);
  assert.equal(result.imposter.startSeconds, 40);
  assert.equal(result.normal.videoId, "dQw4w9WgXcQ");
  assert.equal(result.normal.sourceType, "youtube");
});

test("buildYoutubePair errors on an unparseable URL", () => {
  const result = buildYoutubePair(
    { url: "not a url", startSeconds: 0 },
    { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 0 }
  );
  assert.match(result.error, /video ID/);
});

test("buildYoutubePair errors on a negative start second", () => {
  const result = buildYoutubePair(
    { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: -5 },
    { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 0 }
  );
  assert.match(result.error, /zero or positive/);
});

test("pickUploadPair uses explicit ids for both slots when given", () => {
  const pool = [
    { id: "a", url: "/uploads/a.mp3" },
    { id: "b", url: "/uploads/b.mp3" },
  ];
  const result = pickUploadPair(pool, "a", "b");
  assert.equal(result.normal.audioUrl, "/uploads/a.mp3");
  assert.equal(result.imposter.audioUrl, "/uploads/b.mp3");
  assert.equal(result.normal.sourceType, "upload");
  assert.equal(result.normal.startSeconds, 0);
});

test("pickUploadPair randomly fills an omitted slot from the remaining pool", () => {
  const pool = [
    { id: "a", url: "/uploads/a.mp3" },
    { id: "b", url: "/uploads/b.mp3" },
  ];
  const result = pickUploadPair(pool, "a", null);
  assert.equal(result.normal.audioUrl, "/uploads/a.mp3");
  assert.equal(result.imposter.audioUrl, "/uploads/b.mp3");
});

test("pickUploadPair randomly fills both slots when neither is given", () => {
  const pool = [
    { id: "a", url: "/uploads/a.mp3" },
    { id: "b", url: "/uploads/b.mp3" },
    { id: "c", url: "/uploads/c.mp3" },
  ];
  const result = pickUploadPair(pool, null, null);
  assert.notEqual(result.normal.audioUrl, result.imposter.audioUrl);
});

test("pickUploadPair errors when the pool can't satisfy 2 different files", () => {
  const pool = [{ id: "a", url: "/uploads/a.mp3" }];
  const result = pickUploadPair(pool, null, null);
  assert.match(result.error, /at least 2 different/);
});

test("pickUploadPair errors when the host explicitly picks the same file twice", () => {
  const pool = [
    { id: "a", url: "/uploads/a.mp3" },
    { id: "b", url: "/uploads/b.mp3" },
  ];
  const result = pickUploadPair(pool, "a", "a");
  assert.match(result.error, /at least 2 different/);
});

test("pickUploadPair errors when an explicit id doesn't exist in the pool", () => {
  const pool = [{ id: "a", url: "/uploads/a.mp3" }];
  const result = pickUploadPair(pool, "not-real", null);
  assert.match(result.error, /no longer exists/);
});

test("computePlayerPosition adds the track's start-second offset to the elapsed time", () => {
  assert.equal(computePlayerPosition({ startSeconds: 10 }, 500), 10500);
  assert.equal(computePlayerPosition({ startSeconds: 0 }, 500), 500);
  assert.equal(computePlayerPosition({}, 500), 500);
});
