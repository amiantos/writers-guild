import { describe, it, expect } from 'vitest';
import { EDIT_PARAGRAPHS_TOOL, applyEdits, buildEditorMessages, runEditor } from '../editor.js';
import { assertStrictSchema } from '../deepseek-client.js';

const TEXT = 'The lamp was lit.\n\n"Coming?" Mara asked. "No," Theo said.\n\nRain fell.';
const FINDINGS = [
  { paragraph: 1, rule: 'multiple_speakers', reason: 'Mara and Theo both speak in one paragraph' },
];
const SPLIT = '"Coming?" Mara asked.\n\n"No," Theo said.';

// What the Writer was sent for the passage: its prompt, with the house style and the chapter.
const WRITER_MESSAGES = [
  {
    role: 'system',
    content: 'You are the Writer.\n\n=== HOUSE STYLE ===\nThird person, past tense.',
  },
  {
    role: 'user',
    content: '=== CHAPTER SO FAR ===\nThe harbor was quiet.\n\n=== NEXT ===\nContinue the story.',
  },
];

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

  it('ignores rewrites of unflagged paragraphs, empty or unchanged ones, image stand-ins, and repeats', () => {
    const { text, edits } = applyEdits(TEXT, FINDINGS, [
      { paragraph: 0, replacement: 'The lamp went out.' },
      { paragraph: 1, replacement: '  ' },
      { paragraph: 1, replacement: '"Coming?" Mara asked. "No," Theo said.' },
      { paragraph: 1, replacement: `[WG_IMAGE_0]\n\n${SPLIT}` },
      { paragraph: 1, replacement: `${SPLIT} [image: the lamp]` },
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
  it("continues the Writer's conversation with its passage, then the flagged paragraphs", () => {
    const messages = buildEditorMessages({
      writerMessages: WRITER_MESSAGES,
      text: TEXT,
      reasoning: 'Keep it short.',
      // A retired rule, as in an old run, gets no guidance.
      findings: [...FINDINGS, { paragraph: 1, rule: 'speaking_for_reader', reason: 'Theo speaks' }],
    });

    expect(messages.slice(0, 2)).toEqual(WRITER_MESSAGES);
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: TEXT,
      reasoning_content: 'Keep it short.',
    });
    const request = messages[3];
    expect(request.role).toBe('user');
    expect(request.content).toContain('=== REVISE ===');
    expect(request.content).toContain(
      '[Paragraph 1] multiple_speakers: Mara and Theo both speak in one paragraph; speaking_for_reader: Theo speaks\n"Coming?" Mara asked. "No," Theo said.',
    );
    expect(request.content).toContain('- multiple_speakers: split the paragraph');
    expect(request.content).not.toContain('- speaking_for_reader:');
    expect(request.content).not.toContain('The lamp was lit.');
  });

  it('asks for repeated wording to be rewritten, not swapped for synonyms, with images as labels', () => {
    const text =
      'Mara unrolled the chart.\n\n![the harbor chart](/api/assets/lorebooks/lb-1/chart.webp)\n\nShe traced the coast the way she always did.';
    const messages = buildEditorMessages({
      writerMessages: WRITER_MESSAGES,
      text,
      findings: [{ paragraph: 2, rule: 'repeated_phrase', reason: 'Repeats an earlier passage' }],
    });

    expect(messages[2].content).toContain('[image: the harbor chart]');
    expect(messages[2]).not.toHaveProperty('reasoning_content');
    expect(messages[3].content).toContain(
      '[Paragraph 2] repeated_phrase: Repeats an earlier passage\nShe traced the coast the way she always did.',
    );
    expect(messages[3].content).toContain('rather than swapping in synonyms');
    expect(JSON.stringify(messages.slice(2))).not.toContain('/api/assets/');
  });
});

describe('runEditor', () => {
  it('uses a schema that strict mode accepts', () => {
    expect(() => assertStrictSchema(EDIT_PARAGRAPHS_TOOL.parameters)).not.toThrow();
  });

  it("forces the edit tool on the Writer's conversation, applies the rewrites, and records both steps", async () => {
    const client = editorClient({ edits: [{ paragraph: 1, replacement: SPLIT }] });
    const runRecorder = recorder();
    const recordedWriterMessages = [WRITER_MESSAGES[0], { role: 'user', content: '[trimmed]' }];

    const result = await runEditor({
      client,
      recorder: runRecorder,
      writerMessages: WRITER_MESSAGES,
      recordedWriterMessages,
      text: TEXT,
      findings: FINDINGS,
    });

    expect(result.text).toBe(`The lamp was lit.\n\n${SPLIT}\n\nRain fell.`);
    expect(client.calls[0]).toMatchObject({
      strict: true,
      thinking: false,
      toolChoice: { name: 'edit_paragraphs' },
    });
    expect(client.calls[0].messages.slice(0, 2)).toEqual(WRITER_MESSAGES);
    expect(runRecorder.steps.map((step) => [step.role, step.kind])).toEqual([
      ['editor', 'model'],
      ['editor', 'tool'],
    ]);
    // The run keeps the chapter as the Writer's step recorded it, not another whole copy.
    expect(runRecorder.steps[0].request.messages.slice(0, 2)).toEqual(recordedWriterMessages);
    expect(runRecorder.steps[0].request.messages).toHaveLength(4);
    expect(runRecorder.steps[1].response.edits).toHaveLength(1);
  });

  it('fails when the Editor returns no edits or invalid JSON', async () => {
    const run = (client) =>
      runEditor({
        client,
        recorder: recorder(),
        writerMessages: WRITER_MESSAGES,
        text: TEXT,
        findings: FINDINGS,
      });

    await expect(run(editorClient(null))).rejects.toThrow("didn't return any edits");
    await expect(run(editorClient('{"edits": ['))).rejects.toThrow('valid JSON');
  });
});
