/**
 * Editor
 *
 * Has the Writer revise the paragraphs style lint flagged (see "Style lint and Editor" in
 * docs/bureau-design.md). The revision continues the Writer's own conversation: the prompt it was
 * sent, with the chapter, the cast, and the house style, then the passage it wrote, then the
 * flagged paragraphs and what's wrong with each. A fix is written with the whole chapter in view,
 * not by a model that only sees the passage, and DeepSeek has the Writer's prompt cached, so the
 * extra call costs little. One forced call to a strict edit_paragraphs tool returns the rewrites.
 * Each fix keeps the paragraph it replaced, so the turn's seam can show it and a bad fix can be
 * reverted.
 */

import { labelImages } from './images.js';
import { joinParagraphs, splitParagraphs } from './style-lint.js';

export const EDITOR_MAX_TOKENS = 4000;

export const EDIT_PARAGRAPHS_TOOL = {
  name: 'edit_paragraphs',
  description: 'Return a rewrite of each flagged paragraph.',
  parameters: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            paragraph: { type: 'integer', description: 'Number of the flagged paragraph.' },
            replacement: {
              type: 'string',
              description:
                'The rewritten text. Put a blank line between paragraphs when splitting one.',
            },
          },
          required: ['paragraph', 'replacement'],
          additionalProperties: false,
        },
      },
    },
    required: ['edits'],
    additionalProperties: false,
  },
};

function guidanceFor(rule) {
  switch (rule) {
    case 'multiple_speakers':
      return "multiple_speakers: split the paragraph so each character's dialogue, with that character's own actions, is in a paragraph of its own. Keep every line of dialogue.";
    case 'first_person_narration':
      return 'first_person_narration: rewrite the narration in the third person, using names. Leave dialogue as it is.';
    case 'repeated_phrase':
      return "repeated_phrase: the narration repeats wording from earlier in the chapter. Write that sentence a different way, or cut it if the passage doesn't need it, rather than swapping in synonyms.";
    case 'banned_phrase':
      return 'banned_phrase: rewrite without the banned phrase.';
    default:
      return null;
  }
}

/**
 * The Writer's conversation, continued with the passage it wrote and a request to revise the
 * flagged paragraphs.
 *
 * @param {Object} params
 * @param {Array<{role: string, content: string}>} params.writerMessages - What the Writer was sent.
 * @param {string} params.text - The passage it wrote.
 * @param {string} [params.reasoning] - Its reasoning, which goes back with its turn.
 * @param {Array<{ paragraph: number, rule: string, reason: string }>} params.findings
 * @returns {Array<Object>}
 */
export function buildEditorMessages({ writerMessages, text, reasoning = '', findings }) {
  const { paragraphs } = splitParagraphs(text);
  const reasons = new Map();
  for (const finding of findings) {
    if (!reasons.has(finding.paragraph)) reasons.set(finding.paragraph, []);
    reasons.get(finding.paragraph).push(`${finding.rule}: ${finding.reason}`);
  }
  // Lint never flags a paragraph with an image, so images only need to show as labels.
  const flagged = [...reasons].map(
    ([number, why]) =>
      `[Paragraph ${number}] ${why.join('; ')}\n${labelImages((paragraphs[number] ?? '').trim())}`,
  );
  const guidance = [...new Set(findings.map((finding) => finding.rule))]
    .map((rule) => guidanceFor(rule))
    .filter(Boolean)
    .map((line) => `- ${line}`);

  const passage = { role: 'assistant', content: labelImages(text) };
  if (reasoning) passage.reasoning_content = reasoning;

  const request = [
    '=== REVISE ===',
    'A few paragraphs of your passage need another pass. Rewrite only the paragraphs below so they fit the chapter and the rest of your passage: keep what happens, who says what, and the voice, and change only what the problem needs. Call edit_paragraphs once, with the new text for each paragraph below.',
    flagged.join('\n\n'),
    `How to fix each problem:\n${guidance.join('\n')}`,
  ].join('\n\n');

  return [...writerMessages, passage, { role: 'user', content: request }];
}

/**
 * Apply the rewrites to flagged paragraphs. Rewrites of paragraphs that weren't flagged, empty
 * ones, unchanged ones, and repeats are ignored.
 *
 * @returns {{ text: string, edits: Array<{ paragraph: number, rules: string[], reason: string,
 *   original: string, replacement: string }> }}
 */
export function applyEdits(text, findings, edits) {
  const split = splitParagraphs(text);
  const flagged = new Map();
  for (const finding of findings) {
    if (!flagged.has(finding.paragraph)) flagged.set(finding.paragraph, []);
    flagged.get(finding.paragraph).push(finding);
  }

  const applied = [];
  for (const edit of Array.isArray(edits) ? edits : []) {
    const number = edit?.paragraph;
    const replacement =
      typeof edit?.replacement === 'string'
        ? edit.replacement.trim().replace(/\n[ \t]*(?:\n[ \t]*)*/g, '\n\n')
        : '';
    const original = split.paragraphs[number];
    if (!flagged.has(number) || !replacement || replacement === original.trim()) continue;
    if (applied.some((fix) => fix.paragraph === number)) continue;

    split.paragraphs[number] = replacement;
    const reasons = flagged.get(number);
    applied.push({
      paragraph: number,
      rules: [...new Set(reasons.map((finding) => finding.rule))],
      reason: reasons.map((finding) => finding.reason).join('; '),
      original,
      replacement,
    });
  }
  return { text: joinParagraphs(split), edits: applied };
}

/**
 * Have the Writer revise the flagged paragraphs, and apply its rewrites.
 *
 * @param {Object} params
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {import('./run-recorder.js').RunRecorder} params.recorder
 * @param {Array<Object>} params.writerMessages - What the Writer was sent.
 * @param {Array<Object>} [params.recordedWriterMessages] - The same as its run recorded them, with
 *   the chapter text trimmed.
 * @param {string} params.text - The passage it wrote.
 * @param {string} [params.reasoning] - Its reasoning.
 * @param {Array<Object>} params.findings - From lintProse; at least one.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ text: string, edits: Array<Object> }>}
 */
export async function runEditor({
  client,
  recorder,
  writerMessages,
  recordedWriterMessages = writerMessages,
  text,
  reasoning = '',
  findings,
  signal,
}) {
  const messages = buildEditorMessages({ writerMessages, text, reasoning, findings });
  const recordedRequest = {
    model: client.model,
    thinking: false,
    maxTokens: EDITOR_MAX_TOKENS,
    messages: [...recordedWriterMessages, ...messages.slice(writerMessages.length)],
  };

  const started = Date.now();
  let response;
  try {
    response = await client.chat({
      messages,
      tools: [EDIT_PARAGRAPHS_TOOL],
      strict: true,
      toolChoice: { name: EDIT_PARAGRAPHS_TOOL.name },
      thinking: false,
      maxTokens: EDITOR_MAX_TOKENS,
      signal,
    });
  } catch (error) {
    recorder.recordStep({
      role: 'editor',
      kind: 'model',
      request: recordedRequest,
      error: error.message,
      durationMs: Date.now() - started,
    });
    throw error;
  }
  recorder.recordStep({
    role: 'editor',
    kind: 'model',
    request: recordedRequest,
    response: { finishReason: response.finishReason, model: response.model },
    toolCalls: response.toolCalls,
    usage: response.usage,
    durationMs: Date.now() - started,
  });

  const call = response.toolCalls.find(
    (toolCall) => toolCall.function?.name === EDIT_PARAGRAPHS_TOOL.name,
  );
  if (!call) {
    throw new Error("The Editor didn't return any edits");
  }
  let args;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    throw new Error("The Editor's edits weren't valid JSON");
  }

  const result = applyEdits(text, findings, args.edits);
  recorder.recordStep({
    role: 'editor',
    kind: 'tool',
    request: { id: call.id, name: EDIT_PARAGRAPHS_TOOL.name, arguments: args },
    response: { findings, edits: result.edits },
  });
  return result;
}
