import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BureauStorage } from '../bureau-storage.js';
import { BureauSettingsError, DEFAULT_SETTINGS } from '../bureau-settings.js';
import { closeBureauDb } from '../bureau-db.js';

describe('BureauStorage settings, clock, and world', () => {
  let tempDir;
  let storage;
  let bureau;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-world-'));
    storage = new BureauStorage(tempDir);
    bureau = storage.createBureau({ name: 'Harbor' });
  });

  afterEach(() => {
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('settings', () => {
    it('starts with the default settings', () => {
      expect(bureau.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('applies updates on top of earlier ones', () => {
      storage.updateSettings(bureau.id, { writer: { thinking: true } });

      const updated = storage.updateSettings(bureau.id, { writer: { temperature: 1.3 } });

      expect(updated.settings.writer).toEqual({
        ...DEFAULT_SETTINGS.writer,
        thinking: true,
        temperature: 1.3,
      });
    });

    it('saves nothing when an update is invalid', () => {
      expect(() => storage.updateSettings(bureau.id, { writer: { temperature: 5 } })).toThrow(
        BureauSettingsError,
      );
      expect(storage.getBureau(bureau.id).settings.writer.temperature).toBe(
        DEFAULT_SETTINGS.writer.temperature,
      );
    });

    it('returns null for a Bureau that does not exist', () => {
      expect(storage.updateSettings('missing', { writer: { thinking: true } })).toBeNull();
    });
  });

  describe('clock and time zone', () => {
    it('sets and clears the time zone', () => {
      expect(storage.updateBureau(bureau.id, { timezone: 'America/Chicago' }).timezone).toBe(
        'America/Chicago',
      );
      expect(storage.updateBureau(bureau.id, { name: 'Renamed' }).timezone).toBe('America/Chicago');
      expect(storage.updateBureau(bureau.id, { timezone: null }).timezone).toBeNull();
    });

    it('moves the Bureau clock', () => {
      expect(storage.setBureauTime(bureau.id, '1996-06-04T04:00:00.000Z')).toBe(true);
      expect(storage.getBureau(bureau.id).bureauTime).toBe('1996-06-04T04:00:00.000Z');
      expect(storage.setBureauTime('missing', '1996-06-04T04:00:00.000Z')).toBe(false);
    });
  });

  describe('lorebooks', () => {
    it('attaches each lorebook once, in order, and detaches them', () => {
      expect(storage.attachLorebook(bureau.id, 'lb-2')).toBe(true);
      expect(storage.attachLorebook(bureau.id, 'lb-1')).toBe(true);
      expect(storage.attachLorebook(bureau.id, 'lb-2')).toBe(false);

      expect(storage.listLorebookIds(bureau.id)).toEqual(['lb-2', 'lb-1']);

      expect(storage.detachLorebook(bureau.id, 'lb-2')).toBe(true);
      expect(storage.detachLorebook(bureau.id, 'lb-2')).toBe(false);
      expect(storage.listLorebookIds(bureau.id)).toEqual(['lb-1']);
    });

    it('removes lorebook links with the Bureau', () => {
      storage.attachLorebook(bureau.id, 'lb-1');

      storage.deleteBureau(bureau.id);

      expect(storage.db.prepare('SELECT COUNT(*) AS n FROM bureau_lorebooks').get().n).toBe(0);
    });
  });
});
