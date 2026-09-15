import { describe, it, expect } from 'vitest';
import { bureauText, cardText, profileLines } from '../profile-text.js';

const MARA = {
  name: 'Mara',
  seedCard: {
    data: {
      name: 'Mara',
      description: '{{char}} lives with {{user}}. ![Mara](/api/assets/characters/c1/mara.webp)',
      personality: '*Dry.*',
    },
  },
};

describe('profile text', () => {
  it('gives a whole profile with the characters named and images as labels', () => {
    expect(profileLines(MARA, 'Theo')).toEqual([
      'Description: Mara lives with Theo. [image: Mara]',
      'Personality: Dry.',
    ]);
  });

  it("falls back to User, never null, when there's no reader's character", () => {
    expect(cardText('{{char}} waves at {{user}}.', MARA, null)).toBe('Mara waves at User.');
    expect(bureauText('{{user}} lives next door to Mara.', null)).toBe(
      'User lives next door to Mara.',
    );
    expect(bureauText('{{user}} lives next door to Mara.', 'Theo')).toBe(
      'Theo lives next door to Mara.',
    );
  });
});
