import { describe, it, expect } from 'vitest';
import { exportedCard } from '../character-export.js';

const EXPORTED_AT = new Date('2026-09-12T10:00:00Z');

describe('exportedCard', () => {
  it('adds accepted arc notes to a copy of the seed card', () => {
    const member = {
      name: 'Mara',
      seedCard: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Mara',
          description: 'Keeper of the light.',
          creator_notes: 'By someone.',
          tags: ['sea', 'bureau'],
          extensions: { ursceal_lorebook_id: 'lb-1' },
        },
      },
    };

    const card = exportedCard(
      member,
      [{ content: 'Mara lets Theo steer.' }, { content: 'Mara sleeps through the night now.' }],
      { bureauName: 'Harbor', exportedAt: EXPORTED_AT },
    );

    expect(card.data).toEqual({
      name: 'Mara',
      description:
        'Keeper of the light.\n\nHow Mara has changed:\n- Mara lets Theo steer.\n- Mara sleeps through the night now.',
      creator_notes: 'By someone.\n\nExported from the Bureau "Harbor" on 2026-09-12.',
      tags: ['sea', 'bureau'],
      extensions: { ursceal_lorebook_id: 'lb-1' },
    });
    expect(member.seedCard.data.description).toBe('Keeper of the light.');
  });

  it('exports a character who has not changed with only the export note', () => {
    const card = exportedCard({ name: 'Ines', seedCard: null }, [], {
      bureauName: 'Harbor',
      exportedAt: EXPORTED_AT,
    });

    expect(card).toEqual({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Ines',
        creator_notes: 'Exported from the Bureau "Harbor" on 2026-09-12.',
        tags: ['bureau'],
      },
    });
  });
});
