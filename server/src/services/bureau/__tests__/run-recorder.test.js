import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RunRecorder } from '../run-recorder.js';
import { BureauStorage } from '../bureau-storage.js';
import { closeBureauDb } from '../bureau-db.js';

describe('RunRecorder', () => {
  let tempDir;
  let storage;
  let bureau;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-recorder-'));
    storage = new BureauStorage(tempDir);
    bureau = storage.createBureau({ name: 'Harbor' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts a running run and numbers its steps in order', () => {
    const recorder = new RunRecorder(storage, {
      bureauId: bureau.id,
      purpose: 'turn',
      targetType: 'story',
      targetId: 'story-1',
    });
    expect(storage.getRun(bureau.id, recorder.runId)).toMatchObject({
      status: 'running',
      finished: null,
    });

    recorder.recordStep({ role: 'director', kind: 'model', response: { content: '' } });
    recorder.recordStep({ role: 'director', kind: 'tool', request: { name: 'recall' } });
    recorder.complete();

    const run = storage.getRun(bureau.id, recorder.runId);
    expect(run).toMatchObject({ status: 'completed', targetType: 'story', targetId: 'story-1' });
    expect(run.steps.map((step) => [step.position, step.kind])).toEqual([
      [0, 'model'],
      [1, 'tool'],
    ]);
  });

  it('record() completes the run and returns the result', async () => {
    const result = await RunRecorder.record(
      storage,
      { bureauId: bureau.id, purpose: 'turn' },
      async (recorder) => {
        recorder.recordStep({ role: 'writer', kind: 'model' });
        return 'prose';
      },
    );

    expect(result).toBe('prose');
    expect(storage.listRuns(bureau.id)[0]).toMatchObject({ status: 'completed', stepCount: 1 });
  });

  it('record() marks the run failed and rethrows', async () => {
    const failure = new Error('Model unavailable');

    await expect(
      RunRecorder.record(storage, { bureauId: bureau.id, purpose: 'turn' }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(storage.listRuns(bureau.id)[0]).toMatchObject({
      status: 'failed',
      error: 'Model unavailable',
    });
  });

  it('record() marks an aborted run as cancelled', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';

    await expect(
      RunRecorder.record(storage, { bureauId: bureau.id, purpose: 'turn' }, async () => {
        throw abort;
      }),
    ).rejects.toBe(abort);
    expect(storage.listRuns(bureau.id)[0].status).toBe('cancelled');
  });

  it('logs a failed step write instead of throwing', () => {
    const recorder = new RunRecorder(storage, { bureauId: bureau.id, purpose: 'turn' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(storage, 'addStep').mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => recorder.recordStep({ role: 'writer', kind: 'model' })).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
  });

  it('only finishes a run once', () => {
    const recorder = new RunRecorder(storage, { bureauId: bureau.id, purpose: 'turn' });

    recorder.fail(new Error('first'));
    recorder.complete();

    expect(storage.getRun(bureau.id, recorder.runId)).toMatchObject({
      status: 'failed',
      error: 'first',
    });
  });
});
