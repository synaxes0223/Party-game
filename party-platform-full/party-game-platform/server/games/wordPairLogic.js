// wordPairLogic.js
// Pure functions for Word Wolf's word-pair sources: the built-in curated
// dataset, auto-pick-without-immediate-repeat, and custom-pair validation.
// No socket.io, no room state -- plain data in, plain data out.

const WORD_PAIRS = [
  { normal: "Coffee", imposter: "Tea" },
  { normal: "Beach", imposter: "Desert" },
  { normal: "Winter", imposter: "Summer" },
  { normal: "Cat", imposter: "Dog" },
  { normal: "Pizza", imposter: "Burger" },
  { normal: "Ocean", imposter: "Lake" },
  { normal: "Guitar", imposter: "Piano" },
  { normal: "Football", imposter: "Basketball" },
  { normal: "Movie", imposter: "TV Show" },
  { normal: "Book", imposter: "Magazine" },
  { normal: "Doctor", imposter: "Nurse" },
  { normal: "Airplane", imposter: "Helicopter" },
  { normal: "Chocolate", imposter: "Vanilla" },
  { normal: "Mountain", imposter: "Hill" },
  { normal: "Rain", imposter: "Snow" },
  { normal: "Camera", imposter: "Phone" },
  { normal: "Bicycle", imposter: "Motorcycle" },
  { normal: "Library", imposter: "Bookstore" },
  { normal: "Sandwich", imposter: "Salad" },
  { normal: "Train", imposter: "Bus" },
  { normal: "Painter", imposter: "Sculptor" },
  { normal: "Volleyball", imposter: "Tennis" },
  { normal: "Castle", imposter: "Palace" },
  { normal: "Wolf", imposter: "Fox" },
  { normal: "River", imposter: "Stream" },
  { normal: "Comedy", imposter: "Drama" },
  { normal: "Backpack", imposter: "Suitcase" },
  { normal: "Sushi", imposter: "Ramen" },
  { normal: "Campfire", imposter: "Bonfire" },
  { normal: "Umbrella", imposter: "Raincoat" },
  { normal: "Notebook", imposter: "Diary" },
  { normal: "Marathon", imposter: "Sprint" },
];

// Picks a random pair whose index isn't in usedIndexes. Once every index has
// been used, resets (returning a fresh set containing only the newly picked
// index) so a long game session never runs dry. Returns a NEW Set rather
// than mutating the one passed in, keeping this function pure.
function pickAutoPair(pool, usedIndexes) {
  let availableIndexes = pool.map((_, i) => i).filter((i) => !usedIndexes.has(i));
  let baseUsed = usedIndexes;
  if (availableIndexes.length === 0) {
    availableIndexes = pool.map((_, i) => i);
    baseUsed = new Set();
  }
  const index = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
  const nextUsed = new Set(baseUsed);
  nextUsed.add(index);
  return { pair: pool[index], index, usedIndexes: nextUsed };
}

// Validates a host-submitted custom word pair: both non-empty after
// trimming, and not the same word (case-insensitive).
function buildCustomPair(normalWord, imposterWord) {
  const normal = (normalWord || "").trim();
  const imposter = (imposterWord || "").trim();
  if (!normal || !imposter) return { error: "Both words are required." };
  if (normal.toLowerCase() === imposter.toLowerCase()) {
    return { error: "The two words must be different." };
  }
  return { normal: { word: normal }, imposter: { word: imposter } };
}

module.exports = { WORD_PAIRS, pickAutoPair, buildCustomPair };
