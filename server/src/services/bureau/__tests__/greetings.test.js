import { describe, it, expect } from 'vitest';
import { greetingsFor, listGreetings } from '../greetings.js';

function member(id, name, data = {}, fields = {}) {
  return {
    id,
    name,
    seedCard: { spec: 'chara_card_v2', spec_version: '2.0', data: { name, ...data } },
    ...fields,
  };
}

const COUNTER = '![June at the counter](/api/assets/characters/c1/counter.webp)';

describe('greetingsFor', () => {
  it('fills in names, drops asterisks, and keeps the numbering on the card', () => {
    const june = member('c1', 'June', {
      first_mes: `*{{char}} looks up.* "Hi, {{user}}."\r\n\r\n${COUNTER}`,
      alternate_greetings: ['  ', '{{char}} waves at {{User}}.'],
    });

    expect(greetingsFor(june, 'Theo')).toEqual([
      {
        castId: 'c1',
        name: 'June',
        index: 0,
        label: 'First message',
        content: `June looks up. "Hi, Theo."\n\n${COUNTER}`,
      },
      {
        castId: 'c1',
        name: 'June',
        index: 2,
        label: 'Alternate greeting 2',
        content: 'June waves at Theo.',
      },
    ]);
  });

  it("calls the reader User without a reader's character, and skips a card with no greetings", () => {
    expect(greetingsFor(member('c1', 'June', { first_mes: 'Hi, {{user}}.' }), null)).toMatchObject([
      { content: 'Hi, User.' },
    ]);
    expect(greetingsFor(member('c2', 'Mara'), 'Theo')).toEqual([]);
  });
});

describe('listGreetings', () => {
  it("offers greetings from everyone in the chapter but the reader's character", () => {
    const theo = member('c1', 'Theo', { first_mes: 'Theo waves.' }, { isPersona: true });
    const june = member('c2', 'June', { first_mes: 'June looks up at {{user}}.' });
    const mara = member('c3', 'Mara', { alternate_greetings: ['Mara nods at {{user}}.'] });

    expect(
      listGreetings([june, theo, mara]).map(({ castId, index, content }) => ({
        castId,
        index,
        content,
      })),
    ).toEqual([
      { castId: 'c2', index: 0, content: 'June looks up at Theo.' },
      { castId: 'c3', index: 1, content: 'Mara nods at Theo.' },
    ]);
  });
});
