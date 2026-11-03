// Narration helpers shared by the documentary player (browser) and the voice script (Node).
// A narration line is plain text split into sentences. Clips made by scripts/make-voice.mjs are
// matched to lines by their exact text, so any change to the data or wording falls back to the
// browser's voice until the clips are remade.

export const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Hectares the way a narrator says them: "18.2 million", "445 thousand", "3,120". */
export function sayHa(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} million`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} thousand`;
  return Math.round(n).toLocaleString('en-CA');
}

/** A count: exact below ten thousand, otherwise "more than 26 thousand" (rounded down, so it stays true). */
export function sayCount(n) {
  return n >= 1e4 ? `more than ${Math.floor(n / 1e3)} thousand` : Math.round(n).toLocaleString('en-CA');
}

/** "2025-06-29" → "June 29, 2025". */
export function sayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${FULL_MONTHS[m - 1]} ${d}, ${y}`;
}

/** Split narration into sentences. Decimals ("2.1") and abbreviations without a following capital stay whole. */
export function splitSentences(text) {
  return text.trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Seconds into a clip where `word` is spoken. Sentences carry their own start/end from the voice
 * script; inside a sentence the time is placed by character offset, the same way IRISIdeas lands cues.
 */
export function cueTime(sentences, marks, word) {
  for (let i = 0; i < sentences.length; i++) {
    const k = sentences[i].indexOf(word);
    if (k < 0) continue;
    const { start, end } = marks[i];
    return start + (k / Math.max(1, sentences[i].length)) * (end - start);
  }
  return null;
}

/** Every line a story speaks, in order, as { id, text, sentences }: the opening, each chapter, the close. */
export function storyLines(story) {
  const lines = [];
  const add = (id, text) => lines.push({ id, text: splitSentences(text).join(' '), sentences: splitSentences(text) });
  add('open', story.opening);
  story.chapters.forEach((ch, i) => add(`ch${i}`, ch.say));
  add('close', story.closing);
  return lines;
}
