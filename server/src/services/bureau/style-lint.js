/**
 * Style Lint
 *
 * Pure checks over generated prose, run after the Writer and before the
 * Editor (see "Style lint and Editor" in docs/bureau-design.md). Each finding
 * names a paragraph, a rule, and a reason, and the Editor rewrites only the
 * paragraphs named.
 *
 * The checks would rather miss a problem than invent one: a miss leaves one
 * imperfect paragraph, while a false alarm costs a model call and rewrites
 * prose that was fine.
 */

export const LINT_RULES = [
  'multiple_speakers',
  'first_person_narration',
  'speaking_for_reader',
  'repeated_phrase',
  'banned_phrase',
];

const SPEECH_VERBS = [
  'said',
  'says',
  'asked',
  'asks',
  'replied',
  'replies',
  'answered',
  'answers',
  'whispered',
  'whispers',
  'murmured',
  'murmurs',
  'muttered',
  'mutters',
  'shouted',
  'shouts',
  'called',
  'yelled',
  'snapped',
  'added',
  'adds',
  'continued',
  'repeated',
  'admitted',
  'insisted',
  'offered',
  'agreed',
  'sighed',
  'teased',
  'demanded',
  'countered',
  'protested',
  'warned',
  'explained',
  'suggested',
  'interrupted',
  'retorted',
  'remarked',
  'conceded',
  'confessed',
  'promised',
  'mumbled',
  'hissed',
  'growled',
  'stammered',
  'cried',
  'exclaimed',
  'drawled',
  'breathed',
  'laughed',
  'told',
  'went on',
].join('|');

const SPEAKER = String.raw`[\p{Lu}][\p{L}-]*|he|she|they`;

// "…," Mara said / "…," she asked softly / "…," said Mara
const TAG_AFTER = new RegExp(
  String.raw`^[\s,.!?;:—–-]*(?:(${SPEAKER})\s+(?:\p{Ll}+ly\s+)?(?:${SPEECH_VERBS})\b|(?:${SPEECH_VERBS})\s+(${SPEAKER})\b)`,
  'u',
);

// Mara said, "…" / Theo turned and asked: "…"
const TAG_BEFORE = new RegExp(
  String.raw`(?:^|[\s(])(${SPEAKER})\s+(?:\p{Ll}+\s+){0,3}?(?:${SPEECH_VERBS})\b[^.!?"“”]{0,40}[,:]\s*$`,
  'u',
);

// Theo shook his head. "…" (a sentence starting with a name, just before the quote)
const BEAT_BEFORE = /(?:^\s*|[.!?]\s+)([\p{Lu}][\p{L}-]*)\s+\p{Ll}[^.!?"“”]*[.!?]\s*$/u;

// A quote ending in a period (not an ellipsis) ends its sentence, so what follows isn't its tag.
const ENDS_SENTENCE = /(?<!\.)\.["”]?$/;

// Capitalized words that start sentences but aren't speakers' names.
const NOT_NAMES = new Map([
  ['He', 'he'],
  ['She', 'she'],
  ['They', 'they'],
  ...[
    'I',
    'It',
    'We',
    'You',
    'The',
    'A',
    'An',
    'This',
    'That',
    'Then',
    'And',
    'But',
    'So',
    'Her',
    'His',
    'Their',
    'Someone',
    'Everyone',
    'Nobody',
    'One',
    'There',
    'Now',
    'When',
    'As',
    'If',
    'Still',
    'Yes',
    'No',
  ].map((word) => [word, null]),
]);

const PRONOUNS = new Set(['he', 'she', 'they']);
const PARAGRAPH_BREAK = /\n[ \t]*(?:\n[ \t]*)*/g;
const SCENE_BREAK = /^\s*(?:-{3,}|\*{3,}|⁂)\s*$/;
const IMAGE = /!\[|<img\b/i;
const FIRST_PERSON = /\b(?:I|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself)\b/g;
const REPEAT_LENGTH = 7;

/**
 * Split text into paragraphs, keeping the exact breaks between them so the
 * text can be put back together unchanged.
 * @param {string} text
 * @returns {{ paragraphs: string[], separators: string[] }}
 */
export function splitParagraphs(text) {
  const paragraphs = [];
  const separators = [];
  let last = 0;
  for (const match of text.matchAll(PARAGRAPH_BREAK)) {
    paragraphs.push(text.slice(last, match.index));
    separators.push(match[0]);
    last = match.index + match[0].length;
  }
  paragraphs.push(text.slice(last));
  return { paragraphs, separators };
}

/** The inverse of splitParagraphs. */
export function joinParagraphs({ paragraphs, separators }) {
  return paragraphs.map((paragraph, index) => paragraph + (separators[index] ?? '')).join('');
}

/**
 * Quoted spans in a paragraph, with straight or curly double quotes. A quote
 * left open runs to the end of the paragraph, as when speech continues into
 * the next one.
 * @returns {Array<{ start: number, end: number }>} end is just past the closing mark.
 */
export function findQuotes(paragraph) {
  const quotes = [];
  let open = null;
  for (let index = 0; index < paragraph.length; index++) {
    const char = paragraph[index];
    if (char === '“') {
      if (open === null) open = index;
    } else if (char === '”' || (char === '"' && open !== null)) {
      if (open !== null) {
        quotes.push({ start: open, end: index + 1 });
        open = null;
      }
    } else if (char === '"') {
      open = index;
    }
  }
  if (open !== null) quotes.push({ start: open, end: paragraph.length });
  return quotes;
}

function narrationOf(paragraph) {
  let narration = '';
  let last = 0;
  for (const quote of findQuotes(paragraph)) {
    narration += `${paragraph.slice(last, quote.start)} `;
    last = quote.end;
  }
  return narration + paragraph.slice(last);
}

/**
 * The pronoun a character card uses for its character, when it's clear.
 * @param {string} text - Description and personality from the card.
 * @returns {'he'|'she'|null}
 */
export function inferPronoun(text) {
  const words = String(text ?? '')
    .toLowerCase()
    .match(/\b(?:he|him|his|himself|she|her|hers|herself)\b/g);
  if (!words) return null;
  const she = words.filter((word) => word.startsWith('she') || word.startsWith('her')).length;
  const he = words.length - she;
  if (he >= 2 && he >= she * 3) return 'he';
  if (she >= 2 && she >= he * 3) return 'she';
  return null;
}

/** Whether a house style asks for third-person narration. */
export function usesThirdPerson(houseStyle) {
  return (
    /\bthird[- ]person\b/i.test(houseStyle) && !/\b(?:first|second)[- ]person\b/i.test(houseStyle)
  );
}

/**
 * Maps every part of each cast name ("Mara", "Quinn") to the full name, with its pronoun.
 * @param {Array<{ name: string, pronoun?: string|null }>} names
 */
function nameIndex(names) {
  const index = new Map();
  for (const { name, pronoun = null } of names) {
    for (const part of name.split(/\s+/)) {
      if (/^[\p{Lu}][\p{L}-]+$/u.test(part)) index.set(part, { name, pronoun });
    }
  }
  return index;
}

/** A matched speaker as a cast name, another name, or a pronoun; null when it's neither. */
function speakerFrom(token, names) {
  if (!token) return null;
  if (PRONOUNS.has(token)) return { pronoun: token };
  if (NOT_NAMES.has(token)) {
    const pronoun = NOT_NAMES.get(token);
    return pronoun ? { pronoun } : null;
  }
  const known = names.get(token);
  return known ? { name: known.name, pronoun: known.pronoun } : { name: token, pronoun: null };
}

/** Who speaks in a paragraph: named speakers and pronoun-only speakers, by attribution. */
function speakersIn(paragraph, names) {
  const quotes = findQuotes(paragraph);
  const named = new Map();
  const pronouns = new Set();

  for (const [index, quote] of quotes.entries()) {
    const before = paragraph.slice(index === 0 ? 0 : quotes[index - 1].end, quote.start);
    const after = paragraph.slice(quote.end, quotes[index + 1]?.start ?? paragraph.length);

    const endsSentence = ENDS_SENTENCE.test(paragraph.slice(quote.start, quote.end));
    const tagAfter = endsSentence ? null : after.match(TAG_AFTER);
    const tagBefore = before.match(TAG_BEFORE);
    let speaker = speakerFrom(tagAfter?.[1] ?? tagAfter?.[2], names);
    speaker ??= speakerFrom(tagBefore?.[1], names);
    if (!speaker) {
      // An action beat names the speaker only when it's someone in the cast.
      const beat = before.match(BEAT_BEFORE)?.[1];
      if (beat && names.has(beat)) speaker = speakerFrom(beat, names);
    }

    if (speaker?.name) named.set(speaker.name, speaker.pronoun);
    else if (speaker?.pronoun) pronouns.add(speaker.pronoun);
  }

  // A pronoun is someone else only if no named speaker could be it.
  const others = [...pronouns].filter(
    (pronoun) => ![...named.values()].some((known) => known === null || known === pronoun),
  );
  return { named: [...named.keys()], others };
}

function listSpeakers(names) {
  return names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

function wordsOf(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? [];
}

function phrasesOf(text) {
  const words = wordsOf(text);
  const phrases = [];
  for (let index = 0; index + REPEAT_LENGTH <= words.length; index++) {
    phrases.push(words.slice(index, index + REPEAT_LENGTH).join(' '));
  }
  return phrases;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check generated prose against the house style.
 *
 * @param {string} text - The generated passage.
 * @param {Object} [options]
 * @param {Array<{ name: string, pronoun?: string|null }>} [options.names] - Cast members,
 *   with pronouns where known (see inferPronoun).
 * @param {string|null} [options.readerName] - Set when the reader's character must not speak.
 * @param {boolean} [options.thirdPerson] - Flag first-person narration.
 * @param {string} [options.recentText] - Earlier passages, to catch repeated narration.
 * @param {string[]} [options.bannedPhrases]
 * @returns {Array<{ paragraph: number, rule: string, reason: string }>} In paragraph order.
 */
export function lintProse(
  text,
  { names = [], readerName = null, thirdPerson = true, recentText = '', bannedPhrases = [] } = {},
) {
  const index = nameIndex(names);
  const banned = bannedPhrases
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .map((phrase) => ({
      phrase,
      pattern: new RegExp(
        String.raw`(?<![\p{L}\p{N}])${escapeRegExp(phrase)}(?![\p{L}\p{N}])`,
        'iu',
      ),
    }));
  const seenPhrases = new Set(
    splitParagraphs(recentText).paragraphs.flatMap((paragraph) =>
      phrasesOf(narrationOf(paragraph)),
    ),
  );

  const findings = [];
  for (const [number, paragraph] of splitParagraphs(text).paragraphs.entries()) {
    if (!paragraph.trim() || SCENE_BREAK.test(paragraph) || IMAGE.test(paragraph)) continue;
    const flag = (rule, reason) => findings.push({ paragraph: number, rule, reason });
    const narration = narrationOf(paragraph);

    const { named, others } = speakersIn(paragraph, index);
    if (named.length + others.length >= 2) {
      const speakers = [...named, ...others.map((pronoun) => `"${pronoun}"`)];
      flag('multiple_speakers', `${listSpeakers(speakers)} both speak in one paragraph`);
    }

    if (thirdPerson && (narration.match(FIRST_PERSON) ?? []).length >= 2) {
      flag('first_person_narration', 'The narration slips into first person');
    }

    if (readerName && named.includes(readerName)) {
      flag(
        'speaking_for_reader',
        `${readerName} speaks, but their words are the reader's to write`,
      );
    }

    const phrases = phrasesOf(narration);
    const repeated = phrases.find((phrase) => seenPhrases.has(phrase));
    if (repeated) {
      flag('repeated_phrase', `Repeats "${repeated}" from earlier narration`);
    }
    for (const phrase of phrases) seenPhrases.add(phrase);

    for (const { phrase, pattern } of banned) {
      if (pattern.test(paragraph)) flag('banned_phrase', `Uses the banned phrase "${phrase}"`);
    }
  }
  return findings;
}
