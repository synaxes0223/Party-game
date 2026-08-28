// drunk.js
// "You do not know you are the Drunk. You think you are a Townsfolk, but you
// are not." Passive: no night step of its own. The believed Townsfolk's
// module runs instead, scheduled by nightLoop on believedCharacterId, and
// grimoire.isImpaired is already true for this seat (characterId !==
// believedCharacterId), so only false information should ever be sent.

module.exports = {
  id: "drunk",
  team: "outsider",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};
