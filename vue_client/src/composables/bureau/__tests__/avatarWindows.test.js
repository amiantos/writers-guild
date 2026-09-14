import { describe, it, expect } from 'vitest';
import { newAvatarWindow, windowCharacters } from '../avatarWindows';

const CAST = [
  { id: 'c1', name: 'Theo', isPersona: true, libraryCharacterId: 'l1' },
  { id: 'c2', name: 'Mara', isPersona: false, libraryCharacterId: 'l2' },
  { id: 'c3', name: 'June', isPersona: false, libraryCharacterId: null },
];

describe('windowCharacters', () => {
  it("lists the chapter's cast first, with portraits from their library characters", () => {
    const library = new Map([
      [
        'l2',
        {
          imageUrl: '/api/characters/l2/image',
          thumbnailMediumUrl: '/api/characters/l2/thumbnail-medium',
        },
      ],
    ]);

    expect(windowCharacters(CAST, ['c3', 'c2'], library)).toEqual([
      {
        id: 'c2',
        name: 'Mara',
        imageUrl: '/api/characters/l2/image',
        thumbnailMediumUrl: '/api/characters/l2/thumbnail-medium',
      },
      { id: 'c3', name: 'June', imageUrl: null, thumbnailMediumUrl: null },
      { id: 'c1', name: 'Theo', imageUrl: null, thumbnailMediumUrl: null },
    ]);
  });
});

describe('newAvatarWindow', () => {
  it("shows the first character in the chapter who isn't the reader's", () => {
    expect(
      newAvatarWindow({ cast: CAST, chapterCastIds: ['c1', 'c3'], windows: [] }),
    ).toMatchObject({ castId: 'c3', x: 20, y: 100, width: 300, height: 400 });
  });

  it("falls back to the reader's character, then anyone in the cast", () => {
    expect(newAvatarWindow({ cast: CAST, chapterCastIds: ['c1'], windows: [] }).castId).toBe('c1');
    expect(newAvatarWindow({ cast: CAST, chapterCastIds: [], windows: [] }).castId).toBe('c1');
    expect(newAvatarWindow({ cast: [], chapterCastIds: [], windows: [] })).toBeNull();
  });

  it('opens past the furthest window, with an id of its own', () => {
    const first = newAvatarWindow({ cast: CAST, chapterCastIds: ['c2'], windows: [] });
    const second = newAvatarWindow({
      cast: CAST,
      chapterCastIds: ['c2'],
      windows: [first, { ...first, id: 'moved', x: 80 }],
    });

    expect(second).toMatchObject({ x: 110, y: 190 });
    expect(second.id).toEqual(expect.any(String));
    expect(second.id).not.toBe(first.id);
  });
});
