import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BureauStorage, CastConflictError, maskApiKey } from '../bureau-storage.js';
import { closeBureauDb } from '../bureau-db.js';
import { DEFAULT_MODEL } from '../deepseek-client.js';
import { resolveSettings } from '../bureau-settings.js';

const API_KEY = 'sk-storage-test-key-1234';

function card(name) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name, description: `${name} from the library` },
  };
}

describe('BureauStorage', () => {
  let tempDir;
  let storage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-storage-'));
    storage = new BureauStorage(tempDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('maskApiKey', () => {
    it('keeps only the first three and last four characters', () => {
      expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-…cdef');
    });

    it('hides short keys entirely', () => {
      expect(maskApiKey('short')).toBe('••••');
    });

    it('is empty when there is no key', () => {
      expect(maskApiKey('')).toBe('');
    });
  });

  describe('Bureaus', () => {
    it('creates a Bureau with defaults and a masked key', () => {
      const bureau = storage.createBureau({ name: 'Harbor', apiKey: API_KEY });

      expect(bureau).toMatchObject({
        name: 'Harbor',
        description: '',
        model: DEFAULT_MODEL,
        hasApiKey: true,
        apiKeyPreview: 'sk-…1234',
        timezone: null,
        houseStyle: '',
        settings: resolveSettings({}),
        castCount: 0,
      });
      expect(Number.isNaN(Date.parse(bureau.bureauTime))).toBe(false);
      expect(bureau).not.toHaveProperty('presentOffsetDays');
      expect(JSON.stringify(bureau)).not.toContain(API_KEY);
    });

    it('hands out the key only through getBureauCredentials', () => {
      const bureau = storage.createBureau({
        name: 'Harbor',
        apiKey: API_KEY,
        model: 'deepseek-v4-pro',
      });

      expect(storage.getBureauCredentials(bureau.id)).toEqual({
        apiKey: API_KEY,
        model: 'deepseek-v4-pro',
      });
      expect(JSON.stringify(storage.listBureaus())).not.toContain(API_KEY);
    });

    it('lists the most recently modified Bureau first', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
      const first = storage.createBureau({ name: 'First' });
      vi.setSystemTime(new Date('2026-09-02T10:00:00Z'));
      storage.createBureau({ name: 'Second' });
      vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
      storage.updateBureau(first.id, { description: 'Touched' });

      expect(storage.listBureaus().map((bureau) => bureau.name)).toEqual(['First', 'Second']);
    });

    it('updates only the fields it is given', () => {
      const bureau = storage.createBureau({
        name: 'Harbor',
        description: 'Seaside',
        apiKey: API_KEY,
      });

      const updated = storage.updateBureau(bureau.id, {
        name: 'Lighthouse',
        houseStyle: 'One speaker per paragraph.',
      });

      expect(updated).toMatchObject({
        name: 'Lighthouse',
        description: 'Seaside',
        houseStyle: 'One speaker per paragraph.',
        hasApiKey: true,
      });
    });

    it('removes the key when given an empty string', () => {
      const bureau = storage.createBureau({ name: 'Harbor', apiKey: API_KEY });

      const updated = storage.updateBureau(bureau.id, { apiKey: '' });

      expect(updated).toMatchObject({ hasApiKey: false, apiKeyPreview: '' });
      expect(storage.getBureauCredentials(bureau.id).apiKey).toBe('');
    });

    it('returns null for a Bureau that does not exist', () => {
      expect(storage.getBureau('missing')).toBeNull();
      expect(storage.getBureauCredentials('missing')).toBeNull();
      expect(storage.updateBureau('missing', { name: 'Nope' })).toBeNull();
      expect(storage.deleteBureau('missing')).toBe(false);
    });

    it('deletes a Bureau along with its cast and runs', () => {
      const bureau = storage.createBureau({ name: 'Harbor' });
      storage.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'char-1' });
      const runId = storage.createRun({ bureauId: bureau.id, purpose: 'smoke_test' });
      storage.addStep(runId, { position: 0, role: 'director', kind: 'model' });

      expect(storage.deleteBureau(bureau.id)).toBe(true);

      const counts = storage.db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM cast_members) AS cast,
                  (SELECT COUNT(*) FROM agent_runs) AS runs,
                  (SELECT COUNT(*) FROM agent_steps) AS steps`,
        )
        .get();
      expect(counts).toEqual({ cast: 0, runs: 0, steps: 0 });
    });
  });

  describe('cast', () => {
    let bureau;

    beforeEach(() => {
      bureau = storage.createBureau({ name: 'Harbor' });
    });

    it('stores a copy of the card as the seed card', () => {
      const source = card('Mara');
      const member = storage.addCastMember(bureau.id, {
        seedCard: source,
        libraryCharacterId: 'char-1',
      });
      source.data.name = 'Changed after joining';

      expect(member).toMatchObject({
        name: 'Mara',
        libraryCharacterId: 'char-1',
        isPersona: false,
        isDraft: false,
        routine: {},
      });
      expect(storage.getCastMember(bureau.id, member.id).seedCard.data.name).toBe('Mara');
    });

    it('rejects a library character already in the cast', () => {
      const member = storage.addCastMember(bureau.id, {
        seedCard: card('Mara'),
        libraryCharacterId: 'char-1',
      });

      let thrown;
      try {
        storage.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'char-1' });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CastConflictError);
      expect(thrown.castMemberId).toBe(member.id);
    });

    it('lets the same library character join two Bureaus', () => {
      const other = storage.createBureau({ name: 'Other' });
      storage.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'char-1' });

      expect(() =>
        storage.addCastMember(other.id, { seedCard: card('Mara'), libraryCharacterId: 'char-1' }),
      ).not.toThrow();
    });

    it('lists members without seed cards and counts them on the Bureau', () => {
      storage.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'char-1' });
      storage.addCastMember(bureau.id, {
        seedCard: card('Theo'),
        libraryCharacterId: 'char-2',
        isPersona: true,
      });

      const cast = storage.listCast(bureau.id);

      expect(cast.map((member) => [member.name, member.isPersona])).toEqual([
        ['Mara', false],
        ['Theo', true],
      ]);
      expect(cast[0]).not.toHaveProperty('seedCard');
      expect(storage.getBureau(bureau.id).castCount).toBe(2);
    });

    it('marks a member as the persona', () => {
      const member = storage.addCastMember(bureau.id, {
        seedCard: card('Theo'),
        libraryCharacterId: 'char-2',
      });

      expect(storage.updateCastMember(bureau.id, member.id, { isPersona: true }).isPersona).toBe(
        true,
      );
    });

    it("keeps one reader's character per Bureau", () => {
      const theo = storage.addCastMember(bureau.id, {
        seedCard: card('Theo'),
        libraryCharacterId: 'char-2',
        isPersona: true,
      });
      const mara = storage.addCastMember(bureau.id, {
        seedCard: card('Mara'),
        libraryCharacterId: 'char-1',
        isPersona: true,
      });

      expect(mara.isPersona).toBe(true);
      expect(storage.getCastMember(bureau.id, theo.id).isPersona).toBe(false);

      storage.updateCastMember(bureau.id, theo.id, { isPersona: true });
      const readers = storage.listCast(bureau.id).filter((member) => member.isPersona);
      expect(readers.map((member) => member.name)).toEqual(['Theo']);
    });

    it('removes a member', () => {
      const member = storage.addCastMember(bureau.id, {
        seedCard: card('Mara'),
        libraryCharacterId: 'char-1',
      });

      expect(storage.removeCastMember(bureau.id, member.id)).toBe(true);
      expect(storage.listCast(bureau.id)).toEqual([]);
      expect(storage.removeCastMember(bureau.id, member.id)).toBe(false);
    });

    it('adds a draft with no library character, and links it once saved to the library', () => {
      const draft = storage.addCastMember(bureau.id, { seedCard: card('Ines'), isDraft: true });
      storage.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'char-1' });

      expect(draft).toMatchObject({ isDraft: true, libraryCharacterId: null });
      expect(storage.promoteDraft(bureau.id, draft.id, 'char-9')).toMatchObject({
        isDraft: false,
        libraryCharacterId: 'char-9',
      });
      expect(storage.promoteDraft(bureau.id, draft.id, 'char-10')).toBeNull();

      const another = storage.addCastMember(bureau.id, { seedCard: card('Jonas'), isDraft: true });
      expect(() => storage.promoteDraft(bureau.id, another.id, 'char-1')).toThrow(
        CastConflictError,
      );
    });

    it('keeps cast members inside their own Bureau', () => {
      const other = storage.createBureau({ name: 'Other' });
      const member = storage.addCastMember(bureau.id, {
        seedCard: card('Mara'),
        libraryCharacterId: 'char-1',
      });

      expect(storage.getCastMember(other.id, member.id)).toBeNull();
      expect(storage.updateCastMember(other.id, member.id, { isPersona: true })).toBeNull();
      expect(storage.removeCastMember(other.id, member.id)).toBe(false);
    });
  });

  describe('run records', () => {
    let bureau;

    beforeEach(() => {
      bureau = storage.createBureau({ name: 'Harbor' });
    });

    it('stores a run and its steps in order', () => {
      const runId = storage.createRun({
        bureauId: bureau.id,
        purpose: 'smoke_test',
        targetType: 'story',
        targetId: 'story-1',
      });
      storage.addStep(runId, {
        position: 1,
        role: 'director',
        kind: 'tool',
        request: { name: 'recall' },
        response: '{"memories":[]}',
        durationMs: 3,
      });
      storage.addStep(runId, {
        position: 0,
        role: 'director',
        kind: 'model',
        request: { messages: [{ role: 'user', content: 'hi' }] },
        response: { content: '' },
        reasoning: 'Look it up first.',
        toolCalls: [
          { id: 'call_1', type: 'function', function: { name: 'recall', arguments: '{}' } },
        ],
        usage: { prompt_tokens: 10 },
        durationMs: 120,
      });
      storage.finishRun(runId, { status: 'completed' });

      const run = storage.getRun(bureau.id, runId);

      expect(run).toMatchObject({
        purpose: 'smoke_test',
        targetType: 'story',
        targetId: 'story-1',
        status: 'completed',
        error: null,
        stepCount: 2,
      });
      expect(run.finished).not.toBeNull();
      expect(run.steps.map((step) => step.kind)).toEqual(['model', 'tool']);
      expect(run.steps[0]).toMatchObject({
        reasoning: 'Look it up first.',
        usage: { prompt_tokens: 10 },
        toolCalls: [{ id: 'call_1' }],
        durationMs: 120,
      });
      expect(run.steps[1]).toMatchObject({
        response: '{"memories":[]}',
        toolCalls: null,
        reasoning: null,
      });
    });

    it('lists runs newest first', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
      const older = storage.createRun({ bureauId: bureau.id, purpose: 'smoke_test' });
      vi.setSystemTime(new Date('2026-09-02T10:00:00Z'));
      const newer = storage.createRun({ bureauId: bureau.id, purpose: 'smoke_test' });

      expect(storage.listRuns(bureau.id).map((run) => run.id)).toEqual([newer, older]);
      expect(storage.listRuns(bureau.id, { limit: 1 }).map((run) => run.id)).toEqual([newer]);
    });

    it('does not return a run through another Bureau', () => {
      const other = storage.createBureau({ name: 'Other' });
      const runId = storage.createRun({ bureauId: bureau.id, purpose: 'smoke_test' });

      expect(storage.getRun(other.id, runId)).toBeNull();
      expect(storage.listRuns(other.id)).toEqual([]);
    });
  });
});
