import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  RECORD_OFFSCREEN_TOOL,
  buildOffscreenMessages,
  findOffscreenGaps,
  generateOffscreenLife,
  isOffscreenGap,
} from '../offscreen.js';
import { getBureauStores } from '../stores.js';
import { closeBureauDb } from '../bureau-db.js';
import { assertStrictSchema } from '../deepseek-client.js';
import { RunRecorder } from '../run-recorder.js';

const FROM = '2026-10-01T20:00:00.000Z';
const TO = '2026-10-08T20:00:00.000Z';

function card(name, description = '') {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description } };
}

/** A client that answers with a record_offscreen call holding `entries`. */
function offscreenClient(entries, { failWith = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async chat(options) {
      client.calls.push(options);
      if (failWith) throw failWith;
      return {
        content: '',
        reasoning: '',
        finishReason: 'tool_calls',
        model: 'deepseek-flash',
        usage: { prompt_tokens: 500, completion_tokens: 80 },
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'record_offscreen', arguments: JSON.stringify({ entries }) },
          },
        ],
      };
    },
  };
  return client;
}

describe('isOffscreenGap', () => {
  it('needs at least twelve hours forward', () => {
    expect(isOffscreenGap(FROM, '2026-10-02T07:59:00.000Z')).toBe(false);
    expect(isOffscreenGap(FROM, new Date('2026-10-02T08:00:00.000Z'))).toBe(true);
    expect(isOffscreenGap(TO, FROM)).toBe(false);
    expect(isOffscreenGap('not a date', TO)).toBe(false);
  });
});

describe('buildOffscreenMessages', () => {
  it("describes each character's time away", () => {
    const mara = {
      id: 'c1',
      name: 'Mara',
      seedCard: card('Mara', 'Keeps the light.'),
      routine: { text: 'Nights at the light.' },
    };

    const [, user] = buildOffscreenMessages({
      bureau: { timezone: 'UTC' },
      gaps: [{ member: mara, from: FROM }],
      to: TO,
      now: new Date('2026-10-08T21:00:00Z'),
      memoriesByCast: new Map([
        [
          'c1',
          {
            knowledge: [{ content: "Theo can't swim." }],
            episodes: [{ content: 'Fixed the lamp with Theo.' }],
            offscreen: { content: 'Painted the boathouse.' },
          },
        ],
      ]),
      notesByCast: new Map([['c1', [{ content: 'Mara lets Theo help now.' }]]]),
    });

    expect(user.content).toContain("=== NOW ===\nIt's 8:00 PM on Thursday, October 8, 2026.");
    expect(user.content).toContain(
      [
        '=== MARA ===',
        'Last seen: 8:00 PM on Thursday, October 1, 2026 (about a week ago)',
        'Description: Keeps the light.',
        'Usual routine: Nights at the light.',
        'How Mara has changed:',
        '- Mara lets Theo help now.',
        'Knows:',
        "- Theo can't swim.",
        'Recently:',
        '- Fixed the lamp with Theo.',
        'The last time away: Painted the boathouse.',
      ].join('\n'),
    );
    expect(user.content).not.toContain('The year is');
  });
});

describe('offscreen life in a Bureau', () => {
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let ines;
  let theo;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offscreen-'));
    stores = getBureauStores(tempDir);
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-test' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara', 'Keeps the light.'),
      libraryCharacterId: 'c1',
    });
    ines = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Ines', 'Runs the pub.'),
      libraryCharacterId: 'c3',
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
  });

  afterEach(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function member(castMember) {
    return stores.bureaus.getCastMember(bureau.id, castMember.id);
  }

  function seen(castMember, worldTime) {
    stores.memories.addMemory(bureau.id, castMember.id, {
      layer: 'knowledge',
      content: `${castMember.name} was around.`,
      worldTime,
    });
  }

  describe('findOffscreenGaps', () => {
    it("measures each character's gap from when they were last seen", () => {
      seen(mara, FROM);
      seen(ines, '2026-10-08T12:00:00.000Z');

      const gaps = findOffscreenGaps(
        stores,
        bureau,
        [member(mara), member(ines), member(theo)],
        TO,
      );

      expect(gaps.map((gap) => [gap.member.id, gap.from])).toEqual([[mara.id, FROM]]);
    });

    it("gives the reader's character an account like anyone else", () => {
      seen(theo, FROM);

      expect(findOffscreenGaps(stores, bureau, [member(theo)], TO)).toEqual([
        { member: member(theo), from: FROM },
      ]);
    });

    it('counts their messages, and has nothing to go on for someone never seen', () => {
      const thread = stores.threads.getOrCreateThread(bureau.id, mara.id);
      stores.threads.addMessage(thread.id, {
        source: 'generated',
        senderCastId: mara.id,
        content: 'Night.',
        bureauTime: FROM,
      });

      expect(
        findOffscreenGaps(stores, bureau, [member(mara), member(ines)], TO).map(
          (gap) => gap.member.id,
        ),
      ).toEqual([mara.id]);
    });

    it('treats a story as time they were seen, and leaves alone anyone in a story still going', () => {
      seen(mara, FROM);
      const week = stores.stories.createStory(bureau.id, { startTime: FROM, castIds: [mara.id] });
      stores.stories.endStory(bureau.id, week.id, { endTime: '2026-10-08T10:00:00.000Z' });
      seen(ines, FROM);
      const open = stores.stories.createStory(bureau.id, {
        startTime: '2026-10-02T09:00:00.000Z',
        castIds: [ines.id],
      });

      expect(findOffscreenGaps(stores, bureau, [member(mara), member(ines)], TO)).toEqual([]);
      expect(
        findOffscreenGaps(stores, bureau, [member(ines)], TO, { ignoreStoryId: open.id }).map(
          (gap) => gap.from,
        ),
      ).toEqual([FROM]);
    });
  });

  describe('generateOffscreenLife', () => {
    it('uses a schema that strict mode accepts', () => {
      expect(() => assertStrictSchema(RECORD_OFFSCREEN_TOOL.parameters)).not.toThrow();
    });

    it('saves an account for each character just before the new time', async () => {
      const client = offscreenClient([
        { character: 'mara', content: 'Repainted the boathouse and argued with the ferry clerk.' },
        { character: 'Theo', content: 'Should be skipped.' },
        { character: 'Ines', content: 'Not owed an account.' },
      ]);

      const saved = await generateOffscreenLife({
        stores,
        bureau: stores.bureaus.getBureau(bureau.id),
        gaps: [{ member: member(mara), from: FROM }],
        to: TO,
        client,
      });

      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        castMemberId: mara.id,
        layer: 'offscreen',
        sourceType: 'offscreen',
        importance: 2,
        worldTime: '2026-10-08T19:59:59.999Z',
        content: 'Repainted the boathouse and argued with the ferry clerk.',
      });
      expect(client.calls[0]).toMatchObject({
        strict: true,
        toolChoice: { name: 'record_offscreen' },
        thinking: false,
      });
      expect(client.calls[0].messages[1].content).toContain('=== MARA ===');
      expect(client.calls[0].messages[1].content).not.toContain('=== INES ===');
      const run = stores.bureaus.getRun(bureau.id, saved[0].runId);
      expect(run).toMatchObject({ purpose: 'offscreen', status: 'completed' });
      expect(run.steps.at(-1).response).toEqual({ saved: 1, skipped: ['Theo', 'Ines'] });
    });

    it('does nothing when no one is owed an account', async () => {
      const client = offscreenClient([]);

      expect(await generateOffscreenLife({ stores, bureau, gaps: [], to: TO, client })).toEqual([]);
      expect(client.calls).toHaveLength(0);
    });

    it('records into a run it was given, and saves nothing when the call fails', async () => {
      const recorder = new RunRecorder(stores.bureaus, {
        bureauId: bureau.id,
        purpose: 'reply',
        targetType: 'thread',
        targetId: 'thread-1',
      });

      await expect(
        generateOffscreenLife({
          stores,
          bureau: stores.bureaus.getBureau(bureau.id),
          gaps: [{ member: member(mara), from: FROM }],
          to: TO,
          client: offscreenClient([], { failWith: new Error('Network down') }),
          recorder,
        }),
      ).rejects.toThrow('Network down');

      const run = stores.bureaus.getRun(bureau.id, recorder.runId);
      expect(run.status).toBe('running');
      expect(run.steps.map((step) => [step.role, step.error])).toEqual([
        ['offscreen', 'Network down'],
      ]);
      expect(stores.memories.listMemories(bureau.id, mara.id)).toEqual([]);
    });
  });
});
