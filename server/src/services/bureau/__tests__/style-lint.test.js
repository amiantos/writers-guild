import { describe, it, expect } from 'vitest';
import {
  findQuotes,
  inferPronoun,
  joinParagraphs,
  lintProse,
  splitParagraphs,
  usesThirdPerson,
} from '../style-lint.js';

const CAST = [
  { name: 'Mara Quinn', pronoun: 'she' },
  { name: 'Theo', pronoun: 'he' },
];

function rules(text, options = {}) {
  return lintProse(text, { names: CAST, ...options }).map((finding) => [
    finding.paragraph,
    finding.rule,
  ]);
}

describe('lintProse: multiple speakers', () => {
  it('flags two tagged speakers in one paragraph', () => {
    const findings = lintProse('"Coming?" Mara asked. "Not tonight," Theo said.', { names: CAST });

    expect(findings).toEqual([
      {
        paragraph: 0,
        rule: 'multiple_speakers',
        reason: 'Mara Quinn and Theo both speak in one paragraph',
      },
    ]);
  });

  it('flags a second speaker introduced by an action beat', () => {
    expect(rules('"Coming?" Mara asked. Theo shook his head. "Not tonight."')).toEqual([
      [0, 'multiple_speakers'],
    ]);
  });

  it('reads an action beat that follows an earlier quote', () => {
    expect(
      rules(
        '"You\'re soaked," Mara said. "Sit down." Theo dropped into the chair. "I\'ve been wetter."',
      ),
    ).toEqual([[0, 'multiple_speakers']]);
  });

  it("doesn't read narration after a finished sentence as a dialogue tag", () => {
    expect(
      rules('"You\'re soaked," Mara said. "Sit down." Theo laughed and dropped into the chair.'),
    ).toEqual([]);
    expect(rules('"Well..." Theo said. "Fine," Mara said.')).toEqual([[0, 'multiple_speakers']]);
  });

  it("doesn't take the person spoken to, or a second name in a beat, for the speaker", () => {
    expect(
      rules('Mara turned to Theo and said, "Let\'s go." She took his hand. "Now," she added.', {
        readerName: 'Theo',
      }),
    ).toEqual([]);
    expect(rules('Theo hesitated, and Mara pressed. "Well?"', { readerName: 'Theo' })).toEqual([]);
  });

  it("doesn't count a capitalized sentence opener as a speaker", () => {
    expect(rules('"Is that all?" Mara asked. Finally she said, "Then we go."')).toEqual([]);
    expect(rules('"Hi," Harold said. "Hey," Theo said.')).toEqual([[0, 'multiple_speakers']]);
  });

  it("recognizes the reader's character by pronoun when they were just named", () => {
    expect(
      rules('Theo lowered the map.\n\n"Three nights running," he said.', { readerName: 'Theo' }),
    ).toEqual([[1, 'speaking_for_reader']]);
    expect(
      rules('The harbormaster shrugged.\n\n"Three nights running," he said.', {
        readerName: 'Theo',
      }),
    ).toEqual([]);
  });

  it('reads tags before quotes, "said Mara" order, and curly quotes', () => {
    expect(rules('Mara leaned in and asked, “Coming?” “No,” said Theo.')).toEqual([
      [0, 'multiple_speakers'],
    ]);
  });

  it('flags he and she, and a pronoun that no named speaker can be', () => {
    expect(rules('"Stay," he said. "No," she said.')).toEqual([[0, 'multiple_speakers']]);
    expect(rules('"Stay," Theo said. "No," she said.')).toEqual([[0, 'multiple_speakers']]);
  });

  it("doesn't count a pronoun as someone else when a named speaker could be it", () => {
    expect(rules('"Stay," Theo said. "Please," he added.')).toEqual([]);
    expect(
      lintProse('"Stay," Ines said. "No," she said.', { names: [{ name: 'Ines', pronoun: null }] }),
    ).toEqual([]);
  });

  it('leaves one speaker alone, across interrupted quotes, beats, and surnames', () => {
    expect(
      rules(
        '"I think," Mara said, setting down her cup, "we should go." She stood. "Now," Quinn added.',
      ),
    ).toEqual([]);
    expect(rules('Theo sat down. "Tea?" Mara asked.')).toEqual([]);
  });

  it('leaves speakers in separate paragraphs alone', () => {
    expect(rules('"Coming?" Mara asked.\n\n"Not tonight," Theo said.')).toEqual([]);
  });

  it('skips paragraphs with images and scene breaks', () => {
    expect(
      rules('"Look," Mara said. ![map](https://example.com/map.png) "Oh," Theo said.\n\n---'),
    ).toEqual([]);
  });
});

describe('lintProse: other rules', () => {
  it('flags first-person narration, but not dialogue, thoughts, or the word "mine"', () => {
    const drift = 'I walked to the door and my hands shook. I told myself to breathe.';

    expect(rules(drift)).toEqual([[0, 'first_person_narration']]);
    expect(rules(drift, { thirdPerson: false })).toEqual([]);
    expect(rules('"I know my way, and I know mine," Mara said.')).toEqual([]);
    expect(rules('‘I told you my way was faster,’ Mara said, and I laughed.')).toEqual([]);
    expect(rules('I can’t let him see my fear, she thought, and I won’t.')).toEqual([]);
    expect(
      rules('The mine was dark. Mara stepped into the mine, and the mine swallowed her lamp.'),
    ).toEqual([]);
  });

  it("flags the reader's character speaking only when asked to", () => {
    expect(rules('"Fine," Theo said.', { readerName: 'Theo' })).toEqual([
      [0, 'speaking_for_reader'],
    ]);
    expect(rules('"Fine," Theo said.')).toEqual([]);
  });

  it('flags narration repeated from earlier passages or paragraphs, not dialogue', () => {
    const recentText = 'The wind moved through the tall grass like a slow tide.';

    expect(
      rules('Outside, the wind moved through the tall grass like a slow tide again.', {
        recentText,
      }),
    ).toEqual([[0, 'repeated_phrase']]);
    expect(
      rules('"The wind moved through the tall grass like a slow tide," Mara said.', {
        recentText,
      }),
    ).toEqual([]);
    expect(
      rules(
        'Rain fell on the old slate roof of the chapel.\n\nLater, rain fell on the old slate roof of the chapel.',
      ),
    ).toEqual([[1, 'repeated_phrase']]);
  });

  it('flags banned phrases as whole words, ignoring case', () => {
    const bannedPhrases = ['a testament to', ' '];

    expect(rules('It was A testament to her patience.', { bannedPhrases })).toEqual([
      [0, 'banned_phrase'],
    ]);
    expect(rules('They were testaments to nothing.', { bannedPhrases })).toEqual([]);
  });
});

describe('splitParagraphs and joinParagraphs', () => {
  it('round-trips text with any mix of line breaks', () => {
    const text = 'One.\n\nTwo.\nThree.\n \n\nFour.';
    const split = splitParagraphs(text);

    expect(split.paragraphs).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
    expect(joinParagraphs(split)).toBe(text);
  });
});

describe('findQuotes', () => {
  it('pairs straight and curly quotes, and runs an open quote to the end', () => {
    const paragraph = '“Wait,” she said. "Go on';

    expect(findQuotes(paragraph).map(({ start, end }) => paragraph.slice(start, end))).toEqual([
      '“Wait,”',
      '"Go on',
    ]);
  });
});

describe('findQuotes with single quotes', () => {
  it('reads curly single quotes without mistaking apostrophes for them', () => {
    const paragraph = '‘I can’t,’ she said. “Go.”';

    expect(findQuotes(paragraph).map(({ start, end }) => paragraph.slice(start, end))).toEqual([
      '‘I can’t,’',
      '“Go.”',
    ]);
  });
});

describe('inferPronoun', () => {
  it('reads a clear pronoun from card text', () => {
    expect(inferPronoun('She keeps the light. Her hands are rough; she rarely smiles.')).toBe(
      'she',
    );
    expect(inferPronoun('He maps the coast and keeps his notes close.')).toBe('he');
    expect(inferPronoun('She met him once. He remembers her.')).toBeNull();
    expect(inferPronoun('')).toBeNull();
  });
});

describe('usesThirdPerson', () => {
  it('checks the house style for third-person narration', () => {
    expect(usesThirdPerson('Write in third-person past tense.')).toBe(true);
    expect(usesThirdPerson('First person, present tense.')).toBe(false);
  });
});
