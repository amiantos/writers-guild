/**
 * Run Recorder
 *
 * Writes a pipeline run and its steps to bureau.db. Turn seams read these
 * records to show how a turn was made.
 *
 * Once a run has started, recording is best-effort: a failed write is logged,
 * never thrown, so bookkeeping can't break a generation.
 */

export class RunRecorder {
  /**
   * Start a run.
   * @param {import('./bureau-storage.js').BureauStorage} storage
   * @param {Object} run
   * @param {string} run.bureauId
   * @param {string} run.purpose - What the run is for, e.g. 'smoke_test' or 'turn'.
   * @param {string|null} [run.targetType]
   * @param {string|null} [run.targetId]
   */
  constructor(storage, { bureauId, purpose, targetType = null, targetId = null }) {
    this.storage = storage;
    this.runId = storage.createRun({ bureauId, purpose, targetType, targetId });
    this.nextPosition = 0;
    this.finished = false;
  }

  /**
   * @param {Object} step
   * @param {string} step.role
   * @param {'model'|'tool'} step.kind
   * @param {*} [step.request]
   * @param {*} [step.response]
   * @param {string} [step.reasoning]
   * @param {Array<Object>} [step.toolCalls]
   * @param {Object} [step.usage]
   * @param {number} [step.durationMs]
   * @param {string|null} [step.error]
   */
  recordStep(step) {
    try {
      this.storage.addStep(this.runId, { ...step, position: this.nextPosition });
      this.nextPosition += 1;
    } catch (error) {
      console.error(`[Bureau] Failed to record a step for run ${this.runId}:`, error);
    }
  }

  complete() {
    this.finish('completed');
  }

  fail(error) {
    const status = error?.name === 'AbortError' ? 'cancelled' : 'failed';
    this.finish(status, error?.message ?? String(error));
  }

  finish(status, error = null) {
    if (this.finished) return;
    this.finished = true;
    try {
      this.storage.finishRun(this.runId, { status, error });
    } catch (storageError) {
      console.error(`[Bureau] Failed to finish run ${this.runId}:`, storageError);
    }
  }

  /**
   * Run `work` inside a recorded run, marking the run completed, failed, or
   * cancelled when it settles.
   * @template T
   * @param {import('./bureau-storage.js').BureauStorage} storage
   * @param {Object} run - Same fields as the constructor.
   * @param {(recorder: RunRecorder) => Promise<T>} work
   * @returns {Promise<T>}
   */
  static async record(storage, run, work) {
    const recorder = new RunRecorder(storage, run);
    try {
      const result = await work(recorder);
      recorder.complete();
      return result;
    } catch (error) {
      recorder.fail(error);
      throw error;
    }
  }
}
