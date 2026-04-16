export const THEMES = {
  Movies: [
    'Inception',
    'Titanic',
    'Avatar',
    'The Matrix',
    'Parasite',
    'Interstellar',
    'Joker',
    'Frozen',
    'Gladiator',
    'Clueless',
  ],
  Animals: [
    'Elephant',
    'Dolphin',
    'Penguin',
    'Cheetah',
    'Kangaroo',
    'Flamingo',
    'Octopus',
    'Gorilla',
    'Chameleon',
    'Narwhal',
  ],
  Food: [
    'Sushi',
    'Biryani',
    'Tacos',
    'Croissant',
    'Dumplings',
    'Cheesecake',
    'Ramen',
    'Falafel',
    'Paella',
    'Tiramisu',
  ],
  Sports: [
    'Cricket',
    'Basketball',
    'Badminton',
    'Surfing',
    'Fencing',
    'Polo',
    'Curling',
    'Archery',
    'Snooker',
    'Bobsled',
  ],
  Places: [
    'Machu Picchu',
    'Santorini',
    'Kyoto',
    'Marrakech',
    'Patagonia',
    'Iceland',
    'Maldives',
    'Prague',
    'New Orleans',
    'Bali',
  ],
  Professions: [
    'Astronaut',
    'Locksmith',
    'Sommelier',
    'Taxidermist',
    'Glassblower',
    'Cartographer',
    'Falconer',
    'Puppeteer',
    'Cryptographer',
    'Gondolier',
  ],
};

export const THEME_NAMES = Object.keys(THEMES);
export const ROUND_DURATION_SECONDS = 120;

export function pickWord(themeName) {
  const words = THEMES[themeName];
  if (!words || !Array.isArray(words) || words.length === 0) {
    throw new Error(`Unknown theme: ${themeName}`);
  }
  const idx = Math.floor(Math.random() * words.length);
  return words[idx];
}

export function generateRoomCode() {
  // Avoid ambiguous characters: 0/O/I/1
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function assignImposters(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    throw new Error('assignImposters requires a non-empty array');
  }

  const impostorUid = playerIds[Math.floor(Math.random() * playerIds.length)];
  const result = {};
  for (const uid of playerIds) {
    result[uid] = uid === impostorUid;
  }
  return result;
}

export function tallyVotes(votes) {
  // votes shape: { [voterUid]: targetUid }
  const voteCounts = {};
  const entries = votes && typeof votes === 'object' ? Object.entries(votes) : [];

  for (const [, targetUid] of entries) {
    if (!targetUid) continue;
    voteCounts[targetUid] = (voteCounts[targetUid] || 0) + 1;
  }

  const counts = Object.values(voteCounts);
  if (counts.length === 0) return { winner: null, isTie: false };

  const maxVotes = Math.max(...counts);
  const top = Object.entries(voteCounts)
    .filter(([, c]) => c === maxVotes)
    .map(([uid]) => uid);

  if (top.length === 1) return { winner: top[0], isTie: false };
  return { winner: null, isTie: true };
}

