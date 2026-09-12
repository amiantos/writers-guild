import { describe, it, expect } from 'vitest';
import { EDIT_PARAGRAPHS_TOOL, applyEdits, buildEditorMessages, runEditor } from '../editor.js';
import { assertStrictSchema } from '../deepseek-client.js';

const TEXT = 'The lamp was lit.\n\n"Coming?" Mara asked. "No," Theo said.\n\nRain fell.';
const FINDINGS = [
  { paragraph: 1, rule: 'multiple_speakers', reason: 'Mara and Theo both speak in one paragraph' },
];
const SPLIT = '"Coming?" Mara asked.\n\n"No," Theo said.';

function recorder() {
  return {
    runId: 'run-1',
    steps: [],
    recordStep(step) {
      this.steps.push(step);
    },
  };
}

/** A client whose chat returns an edit_paragraphs call with `args` (or raw text). */
function editorClient(args) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async chat(options) {
      client.calls.push(options);
      return {
        content: '',
        reasoning: '',
        finishReason: 'tool_calls',
        model: 'deepseek-flash',
        usage: { prompt_tokens: 300, completion_tokens: 40 },
        toolCalls: args
          ? [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'edit_paragraphs',
                  arguments: typeof args === 'string' ? args : JSON.stringify(args),
                },
              },
            ]
          : [],
      };
    },
  };
  return client;
}

describe('applyEdits', () => {
  it('replaces flagged paragraphs and keeps the rest of the text as it was', () => {
    const { text, edits } = applyEdits(TEXT, FINDINGS, [
      { paragraph: 1, replacement: '"Coming?" Mara asked.\n \n\n"No," Theo said.\n' },
    ]);

    expect(text).toBe(`The lamp was lit.\n\n${SPLIT}\n\nRain fell.`);
    expect(edits).toEqual([
      {
        paragraph: 1,
        rules: ['multiple_speakers'],
        reason: 'Mara and Theo both speak in one paragraph',
        original: '"Coming?" Mara asked. "No," Theo said.',
        replacement: SPLIT,
      },
    ]);
  });

  it('ignores rewrites of unflagged paragraphs, empty or unchanged ones, and repeats', () => {
    const { text, edits } = applyEdits(TEXT, FINDINGS, [
      { paragraph: 0, replacement: 'The lamp went out.' },
      { paragraph: 1, replacement: '  ' },
      { paragraph: 1, replacement: '"Coming?" Mara asked. "No," Theo said.' },
      { paragraph: 1, replacement: SPLIT },
      { paragraph: 1, replacement: 'Something else.' },
      { paragraph: 9, replacement: 'Nowhere.' },
    ]);

    expect(edits.map((edit) => edit.replacement)).toEqual([SPLIT]);
    expect(text).toContain('The lamp was lit.');
    expect(applyEdits(TEXT, FINDINGS, null)).toEqual({ text: TEXT, edits: [] });
  });
});

describe('buildEditorMessages', () => {
  it('numbers the passage and explains each flagged problem', () => {
    const [system, user] = buildEditorMessages({
      houseStyle: 'Third person, past tense.',
      text: TEXT,
      findings: [...FINDINGS, { paragraph: 1, rule: 'speaking_for_reader', reason: 'Theo speaks' }],
      readerName: 'Theo',
    });

    expect(system.content).toContain('=== HOUSE STYLE ===\nThird person, past tense.');
    expect(system.content).toContain('multiple_speakers: split the paragraph');
    expect(system.content).toContain("remove Theo's dialogue");
    expect(user.content).toContain('[Paragraph 1]\n"Coming?" Mara asked. "No," Theo said.');
    expect(user.content).toContain(
      '- Paragraph 1 (multiple_speakers): Mara and Theo both speak in one paragraph',
    );
  });
});

describe('runEditor', () => {
  it('uses a schema that strict mode accepts', () => {
    expect(() => assertStrictSchema(EDIT_PARAGRAPHS_TOOL.parameters)).not.toThrow();
  });

  it('forces the edit tool, applies the rewrites, and records both steps', async () => {
    const client = editorClient({ edits: [{ paragraph: 1, replacement: SPLIT }] });
    const runRecorder = recorder();

    const result = await runEditor({
      client,
      recorder: runRecorder,
      houseStyle: 'Third person.',
      text: TEXT,
      findings: FINDINGS,
    });

    expect(result.text).toBe(`The lamp was lit.\n\n${SPLIT}\n\nRain fell.`);
    expect(client.calls[0]).toMatchObject({
      strict: true,
      thinking: false,
      toolChoice: { name: 'edit_paragraphs' },
    });
    expect(runRecorder.steps.map((step) => [step.role, step.kind])).toEqual([
      ['editor', 'model'],
      ['editor', 'tool'],
    ]);
    expect(runRecorder.steps[1].response.edits).toHaveLength(1);
  });

  it('fails when the Editor returns no edits or invalid JSON', async () => {
    const run = (client) =>
      runEditor({
        client,
        recorder: recorder(),
        houseStyle: '',
        text: TEXT,
        findings: FINDINGS,
      });

    await expect(run(editorClient(null))).rejects.toThrow("didn't return any edits");
    await expect(run(editorClient('{"edits": ['))).rejects.toThrow('valid JSON');
  });
});
