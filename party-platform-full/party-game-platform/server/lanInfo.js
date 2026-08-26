// lanInfo.js
// Works out which addresses players can reach this host on, and renders the
// join URL as a QR code. Split out from index.js so it can be unit-tested
// without booting the server, and so the startup banner and the /api/join-info
// endpoint agree on the same address list.

const os = require("os");
const QRCode = require("qrcode-svg");

// Ranked lowest-number-wins. A phone acting as a hotspot usually hands itself
// 192.168.43.1, so that beats the address it got as a WiFi *client* — players
// on the hotspot can only reach the former.
function rankAddress(addr) {
  if (addr.startsWith("192.168.43.")) return 0;
  if (addr.startsWith("192.168.")) return 1;
  if (addr.startsWith("10.")) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 3;
  return 4;
}

function getLanAddresses(nets = os.networkInterfaces()) {
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

function buildJoinInfo(addresses, port) {
  const ranked = [...addresses].sort((a, b) => rankAddress(a) - rankAddress(b));
  const joinUrls = ranked.map((a) => `http://${a}:${port}/player/`);
  return { joinUrls, primaryJoinUrl: joinUrls[0] || null };
}

function buildQrSvg(url) {
  if (!url) return null;
  return new QRCode({ content: url, width: 240, height: 240, padding: 1, ecl: "M" }).svg();
}

module.exports = { getLanAddresses, buildJoinInfo, buildQrSvg };
