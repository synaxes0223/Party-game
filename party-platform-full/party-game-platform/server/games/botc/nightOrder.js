// nightOrder.js
// First-night and other-night order for this plan's seven characters plus
// the two pseudo-steps, as data. This encodes the Trouble Brewing structure
// for the subset of characters this plan implements: Minion/Demon info are
// pure reveals that don't depend on any prior action, so they run first on
// the first night, before the Poisoner or any information Townsfolk.
//
// VERIFIED (2026-08-27) against two independent Trouble Brewing night-order
// references (an official night-sheet transcription and a night-order
// lookup tool) -- both agree Minion Info and Demon Info precede the
// Poisoner on the first night. This corrects the plan brief's draft order,
// which had the Poisoner first; see task-9-report.md for the sources and
// reasoning. Other-nights order (Poisoner, then Imp, then Empath, Butler)
// matched both references as drafted.

const FIRST_NIGHT_ORDER = [
  "minion-info",
  "demon-info",
  "poisoner",
  "washerwoman",
  "empath",
  "butler",
];

const OTHER_NIGHTS_ORDER = [
  "poisoner",
  "imp",
  "empath",
  "butler",
];

module.exports = { FIRST_NIGHT_ORDER, OTHER_NIGHTS_ORDER };
