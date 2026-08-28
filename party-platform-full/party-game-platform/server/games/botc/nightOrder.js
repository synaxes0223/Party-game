// nightOrder.js
// First-night and other-night order for the curated character library, as
// data. Covers the 14 registered characters (Virgin and Slayer, which have
// no night step, land in the day-drama plan). Minion Info / Demon Info are
// pure reveals that don't depend on any prior action, so they run first on
// the first night; the Poisoner acts before the information Townsfolk so
// their reads can already be wrong.
//
// VERIFIED 2026-08-28 against the official Trouble Brewing night sheet. A
// step id for a character not currently dealt is inert -- nightLoop.js
// skips it.

const FIRST_NIGHT_ORDER = [
  "minion-info",
  "demon-info",
  "poisoner",
  "washerwoman",
  "librarian",
  "investigator",
  "chef",
  "empath",
  "fortuneTeller",
  "butler",
];

const OTHER_NIGHTS_ORDER = [
  "poisoner",
  "monk",
  "imp",
  "empath",
  "fortuneTeller",
  "butler",
];

module.exports = { FIRST_NIGHT_ORDER, OTHER_NIGHTS_ORDER };
