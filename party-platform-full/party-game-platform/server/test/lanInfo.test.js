const test = require("node:test");
const assert = require("node:assert/strict");
const lanInfo = require("../lanInfo");

const FAKE_NETS = {
  lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  "wlan0": [
    { family: "IPv6", address: "fe80::1", internal: false },
    { family: "IPv4", address: "192.168.1.42", internal: false },
  ],
  "ap0": [{ family: "IPv4", address: "192.168.43.1", internal: false }],
  "docker0": [{ family: "IPv4", address: "172.17.0.1", internal: false }],
};

test("getLanAddresses keeps only external IPv4 addresses", () => {
  const addrs = lanInfo.getLanAddresses(FAKE_NETS);
  assert.deepEqual(addrs.sort(), ["172.17.0.1", "192.168.1.42", "192.168.43.1"]);
});

test("getLanAddresses returns an empty list when there is no external interface", () => {
  const addrs = lanInfo.getLanAddresses({ lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }] });
  assert.deepEqual(addrs, []);
});

test("buildJoinInfo turns addresses into player join URLs on the given port", () => {
  const info = lanInfo.buildJoinInfo(["192.168.1.42"], 3000);
  assert.deepEqual(info.joinUrls, ["http://192.168.1.42:3000/player/"]);
});

test("buildJoinInfo prefers a 192.168.* address as the primary URL", () => {
  const info = lanInfo.buildJoinInfo(["172.17.0.1", "192.168.1.42"], 3000);
  assert.equal(info.primaryJoinUrl, "http://192.168.1.42:3000/player/");
});

test("buildJoinInfo prefers the Android hotspot address over other private ranges", () => {
  const info = lanInfo.buildJoinInfo(["192.168.1.42", "192.168.43.1"], 3000);
  assert.equal(info.primaryJoinUrl, "http://192.168.43.1:3000/player/");
});

test("buildJoinInfo reports no primary URL when the host has no LAN address", () => {
  const info = lanInfo.buildJoinInfo([], 3000);
  assert.equal(info.primaryJoinUrl, null);
  assert.deepEqual(info.joinUrls, []);
});

test("buildQrSvg renders an SVG for the given URL", () => {
  const svg = lanInfo.buildQrSvg("http://192.168.43.1:3000/player/");
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg/);
});

test("buildQrSvg returns null when there is no URL to encode", () => {
  assert.equal(lanInfo.buildQrSvg(null), null);
});
