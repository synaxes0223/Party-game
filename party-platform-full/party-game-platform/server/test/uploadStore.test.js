const test = require("node:test");
const assert = require("node:assert/strict");
const uploadStore = require("../games/uploadStore");

test("addFile returns a record with a generated id and url", () => {
  const file = uploadStore.addFile({ originalName: "song.mp3", storedFilename: "abc-song.mp3" });
  assert.ok(file.id);
  assert.equal(file.originalName, "song.mp3");
  assert.equal(file.storedFilename, "abc-song.mp3");
  assert.equal(file.url, "/uploads/abc-song.mp3");
  assert.ok(typeof file.uploadedAt === "number");
});

test("addFile generates distinct ids for successive files", () => {
  const a = uploadStore.addFile({ originalName: "a.mp3", storedFilename: "x-a.mp3" });
  const b = uploadStore.addFile({ originalName: "b.mp3", storedFilename: "y-b.mp3" });
  assert.notEqual(a.id, b.id);
});

test("listFiles returns everything added so far, in order", () => {
  const before = uploadStore.listFiles().length;
  uploadStore.addFile({ originalName: "c.mp3", storedFilename: "z-c.mp3" });
  const after = uploadStore.listFiles();
  assert.equal(after.length, before + 1);
  assert.equal(after[after.length - 1].originalName, "c.mp3");
});

test("listFiles returns a copy, not the live internal array", () => {
  const list = uploadStore.listFiles();
  list.push({ id: "fake", originalName: "should not persist" });
  const listAgain = uploadStore.listFiles();
  assert.equal(listAgain.some((f) => f.id === "fake"), false);
});
