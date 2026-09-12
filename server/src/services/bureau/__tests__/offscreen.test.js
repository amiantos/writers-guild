import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  RECORD_OFFSCREEN_TOOL,
  buildOffscreenMessages,
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
  it("describes the gap and each character, and leaves the reader's character out", () => {
    const mara = {
      id: 'c1',
      name: 'Mara',
      seedCard: card('Mara', 'Keeps the light.'),
      routine: { text: 'Nights at the light.' },
    };

    const [system, user] = buildOffscreenMessages({
      bureau: { timezone: 'UTC', presentOffsetDays: 0 },
      members: [mara],
      persona: { name: 'Theo' },
      from: FROM,
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

    expect(system.content).toContain('Leave Theo out entirely');
    expect(user.content).toContain(
      '=== TIME THAT PASSED ===\nFrom a Thursday, evening, early October to a Thursday, evening, early October: about a week.',
    );
    expect(user.content).toContain(
      [
        '=== MARA ===',
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

describe('generateOffscreenLife', () => {
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let theo;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offscreen-'));
    stores = getBureauStores(tempDir);
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-test' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara', 'Keeps the light.'),
      libraryCharacterId: 'c1',
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

  function generate(client, options = {}) {
    return generateOffscreenLife({
      stores,
      bureau: stores.bureaus.getBureau(bureau.id),
      members: [
        stores.bureaus.getCastMember(bureau.id, mara.id),
        stores.bureaus.getCastMember(bureau.id, theo.id),
      ],
      from: FROM,
      to: TO,
      client,
      ...options,
    });
  }

  it('uses a schema that strict mode accepts', () => {
    expect(() => assertStrictSchema(RECORD_OFFSCREEN_TOOL.parameters)).not.toThrow();
  });

  it('saves an account for each character just before the new time', async () => {
    const client = offscreenClient([
      { character: 'mara', content: 'Repainted the boathouse and argued with the ferry clerk.' },
      { character: 'Theo', content: 'Should be skipped.' },
      { character: 'Ines', content: 'Not in the cast.' },
    ]);

    const saved = await generate(client);

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
    expect(client.calls[0].messages[1].content).not.toContain('=== THEO ===');
    const run = stores.bureaus.getRun(bureau.id, saved[0].runId);
    expect(run).toMatchObject({ purpose: 'offscreen', status: 'completed' });
    expect(run.steps.at(-1).response).toEqual({ saved: 1, skipped: ['Theo', 'Ines'] });
  });

  it('does nothing for a short gap or with no one to account for', async () => {
    const client = offscreenClient([]);

    expect(await generate(client, { to: '2026-10-02T01:00:00.000Z' })).toEqual([]);
    expect(
      await generate(client, { members: [stores.bureaus.getCastMember(bureau.id, theo.id)] }),
    ).toEqual([]);
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
      generate(offscreenClient([], { failWith: new Error('Network down') }), { recorder }),
    ).rejects.toThrow('Network down');

    const run = stores.bureaus.getRun(bureau.id, recorder.runId);
    expect(run.status).toBe('running');
    expect(run.steps.map((step) => [step.role, step.error])).toEqual([
      ['offscreen', 'Network down'],
    ]);
    expect(stores.memories.listMemories(bureau.id, mara.id)).toEqual([]);
  });
});
