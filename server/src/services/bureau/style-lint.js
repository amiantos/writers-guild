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

// Mara said, "…" / Mara turned to Theo and asked: "…" (the speaker starts the sentence, so a
// name later in it, such as the person spoken to, isn't taken for the speaker)
const TAG_BEFORE = new RegExp(
  String.raw`(?:^[\s,;—–-]*|[.!?]["”’]?\s+)(${SPEAKER})\s+(?:[\p{L}'’-]+,?\s+){0,6}?(?:${SPEECH_VERBS})\b[^.!?"“”]{0,40}[,:]\s*$`,
  'u',
);

// Theo shook his head. "…" (a sentence starting with a name, just before the quote)
// Group 1 is the sentence, group 2 its first word.
const BEAT_BEFORE = /(?:^\s*|[.!?]\s+)(([\p{Lu}][\p{L}-]*)\s+\p{Ll}[^.!?"“”]*[.!?])\s*$/u;

// A quote ending in a period (not an ellipsis) ends its sentence, so what follows isn't its tag.
const ENDS_SENTENCE = /(?<!\.)\.["”’]?$/;

// "…my fear, she thought." A thought, often italic before asterisks were stripped, isn't narration.
const THOUGHT =
  /[^.!?]*[,—–-]\s*(?:he|she|they|[\p{Lu}][\p{L}-]*)\s+(?:thought|wondered|told (?:himself|herself|themselves))\b[^.!?]*[.!?]?/gu;

// Capitalized words after a lowercase word or a comma: mid-sentence, so likely names.
const MID_SENTENCE_CAPITAL = /(?<=[\p{Ll},;]\s+)[\p{Lu}][\p{L}-]+/gu;

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
const FIRST_PERSON = /\b(?:I|[Mm]e|[Mm]y|[Mm]yself)\b/g;
// First-person words outside dialogue and thoughts before narration counts as drifting.
const FIRST_PERSON_THRESHOLD = 3;
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
 * Quoted spans in a paragraph, with straight or curly double quotes, or curly
 * single quotes. A curly apostrophe inside a word doesn't end a single-quoted
 * span. A quote left open runs to the end of the paragraph, as when speech
 * continues into the next one.
 * @returns {Array<{ start: number, end: number }>} end is just past the closing mark.
 */
export function findQuotes(paragraph) {
  const quotes = [];
  let open = null;
  let single = false;
  for (let index = 0; index < paragraph.length; index++) {
    const char = paragraph[index];
    if (open === null) {
      if (char === '“' || char === '"') {
        open = index;
        single = false;
      } else if (char === '‘' && /[\s(—–-]/.test(paragraph[index - 1] ?? ' ')) {
        open = index;
        single = true;
      }
    } else if (
      single
        ? char === '’' && !/\p{L}/u.test(paragraph[index + 1] ?? '')
        : char === '”' || char === '"'
    ) {
      quotes.push({ start: open, end: index + 1 });
      open = null;
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
 * The cast as members with the parts of their names ("Mara", "Quinn"), plus an
 * index from each part to its member.
 * @param {Array<{ name: string, pronoun?: string|null }>} names
 */
function castFrom(names) {
  const index = new Map();
  const members = [];
  for (const { name, pronoun = null } of names) {
    const parts = name.split(/\s+/).filter((part) => /^[\p{Lu}][\p{L}-]+$/u.test(part));
    const member = { name, pronoun, parts };
    members.push(member);
    for (const part of parts) index.set(part, member);
  }
  return { index, members };
}

/** Whether text mentions any part of a cast member's name. */
function mentions(text, member) {
  return member.parts.some((part) =>
    new RegExp(String.raw`(?<!\p{L})${part}(?!\p{L})`, 'u').test(text),
  );
}

/**
 * A matched speaker as a cast name, another name, or a pronoun; null when it's neither.
 * @param {Set<string>|null} [properNouns] - When given, a name outside the cast must be one of
 *   these: a sentence can open with a capitalized word that isn't a name ("Finally").
 */
function speakerFrom(token, index, properNouns = null) {
  if (!token) return null;
  if (PRONOUNS.has(token)) return { pronoun: token };
  if (NOT_NAMES.has(token)) {
    const pronoun = NOT_NAMES.get(token);
    return pronoun ? { pronoun } : null;
  }
  const known = index.get(token);
  if (known) return { name: known.name, pronoun: known.pronoun };
  if (properNouns && !properNouns.has(token)) return null;
  return { name: token, pronoun: null };
}

/**
 * Who speaks in a paragraph: named speakers, and speakers known only by a pronoun.
 * @param {string} paragraph
 * @param {ReturnType<typeof castFrom>} cast
 * @param {Set<string>} properNouns - Capitalized words that appear mid-sentence in the passage.
 * @param {string} context - This paragraph and the one before, for resolving pronouns.
 */
function speakersIn(paragraph, cast, properNouns, context) {
  const quotes = findQuotes(paragraph);
  const named = new Map();
  const pronouns = new Set();

  for (const [index, quote] of quotes.entries()) {
    const before = paragraph.slice(index === 0 ? 0 : quotes[index - 1].end, quote.start);
    const after = paragraph.slice(quote.end, quotes[index + 1]?.start ?? paragraph.length);

    const endsSentence = ENDS_SENTENCE.test(paragraph.slice(quote.start, quote.end));
    const tagAfter = endsSentence ? null : after.match(TAG_AFTER);
    let speaker = speakerFrom(tagAfter?.[1] ?? tagAfter?.[2], cast.index);
    speaker ??= speakerFrom(before.match(TAG_BEFORE)?.[1], cast.index, properNouns);
    if (!speaker) {
      // An action beat names the speaker only when its subject is in the cast and it mentions
      // no one else from the cast.
      const beat = before.match(BEAT_BEFORE);
      const member = beat ? cast.index.get(beat[2]) : null;
      if (member && !cast.members.some((other) => other !== member && mentions(beat[1], other))) {
        speaker = { name: member.name, pronoun: member.pronoun };
      }
    }

    if (speaker?.name) named.set(speaker.name, speaker.pronoun);
    else if (speaker?.pronoun) pronouns.add(speaker.pronoun);
  }

  // A pronoun that no named speaker could be is someone else: the one cast member who uses it,
  // when they're named nearby, or an unnamed speaker otherwise.
  const others = [];
  for (const pronoun of pronouns) {
    const couldBeNamed = [...named.values()].some((known) => known === null || known === pronoun);
    if (couldBeNamed) continue;
    const candidates = cast.members.filter((member) => member.pronoun === pronoun);
    if (candidates.length === 1 && mentions(context, candidates[0])) {
      named.set(candidates[0].name, pronoun);
    } else {
      others.push(pronoun);
    }
  }
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
 * @param {boolean} [options.thirdPerson] - Flag first-person narration.
 * @param {string} [options.recentText] - Earlier passages, to catch repeated narration.
 * @param {string[]} [options.bannedPhrases]
 * @returns {Array<{ paragraph: number, rule: string, reason: string }>} In paragraph order.
 */
export function lintProse(
  text,
  { names = [], thirdPerson = true, recentText = '', bannedPhrases = [] } = {},
) {
  const cast = castFrom(names);
  const properNouns = new Set(text.match(MID_SENTENCE_CAPITAL) ?? []);
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
  const { paragraphs } = splitParagraphs(text);
  // Once one paragraph clearly narrates in first person, the passage has drifted, so any
  // first-person narration in the others is flagged too.
  const firstPersonCounts = paragraphs.map(
    (paragraph) => (narrationOf(paragraph).replace(THOUGHT, ' ').match(FIRST_PERSON) ?? []).length,
  );
  const drifted = thirdPerson && firstPersonCounts.some((count) => count >= FIRST_PERSON_THRESHOLD);
  for (const [number, paragraph] of paragraphs.entries()) {
    if (!paragraph.trim() || SCENE_BREAK.test(paragraph) || IMAGE.test(paragraph)) continue;
    const flag = (rule, reason) => findings.push({ paragraph: number, rule, reason });
    const narration = narrationOf(paragraph);

    const context = `${paragraphs[number - 1] ?? ''}\n${paragraph}`;
    const { named, others } = speakersIn(paragraph, cast, properNouns, context);
    if (named.length + others.length >= 2) {
      const speakers = [...named, ...others.map((pronoun) => `"${pronoun}"`)];
      flag('multiple_speakers', `${listSpeakers(speakers)} both speak in one paragraph`);
    }

    if (drifted && firstPersonCounts[number] > 0) {
      flag('first_person_narration', 'The narration slips into first person');
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
