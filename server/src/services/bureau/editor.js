/**
 * Editor
 *
 * Rewrites only the paragraphs style lint flagged (see "Style lint and Editor"
 * in docs/bureau-design.md), with one forced call to a strict edit_paragraphs
 * tool. Each fix keeps the paragraph it replaced, so the turn's seam can show
 * it and a bad fix can be reverted.
 */

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

function guidanceFor(rule, readerName) {
  switch (rule) {
    case 'multiple_speakers':
      return "multiple_speakers: split the paragraph so each character's dialogue, with that character's own actions, is in a paragraph of its own. Keep every line of dialogue.";
    case 'first_person_narration':
      return 'first_person_narration: rewrite the narration in the third person, using names. Leave dialogue as it is.';
    case 'speaking_for_reader':
      return `speaking_for_reader: remove ${readerName ?? "the reader's character"}'s dialogue and decisions, ending the paragraph where they would respond.`;
    case 'repeated_phrase':
      return "repeated_phrase: reword the repeated narration so it doesn't echo earlier passages.";
    case 'banned_phrase':
      return 'banned_phrase: rewrite without the banned phrase.';
    default:
      return null;
  }
}

/**
 * @param {Object} params
 * @param {string} params.houseStyle
 * @param {string} params.text - The generated passage.
 * @param {Array<{ paragraph: number, rule: string, reason: string }>} params.findings
 * @param {string|null} [params.readerName]
 */
export function buildEditorMessages({ houseStyle, text, findings, readerName = null }) {
  const rules = [...new Set(findings.map((finding) => finding.rule))];
  const system = [
    'You are the Editor for an ongoing story. Fix only the problems flagged in the numbered paragraphs, changing as little as possible: keep every event, line of dialogue, and detail, and keep the voice and tense. Call edit_paragraphs once, with a replacement for each flagged paragraph.',
    `=== HOUSE STYLE ===\n${houseStyle}`,
    `=== HOW TO FIX EACH PROBLEM ===\n${rules
      .map((rule) => guidanceFor(rule, readerName))
      .filter(Boolean)
      .join('\n')}`,
  ];

  const passage = splitParagraphs(text)
    .paragraphs.map((paragraph, number) =>
      paragraph.trim() ? `[Paragraph ${number}]\n${paragraph.trim()}` : null,
    )
    .filter(Boolean);
  const flagged = findings.map(
    (finding) => `- Paragraph ${finding.paragraph} (${finding.rule}): ${finding.reason}`,
  );

  return [
    { role: 'system', content: system.join('\n\n') },
    {
      role: 'user',
      content: `=== PASSAGE ===\n${passage.join('\n\n')}\n\n=== FLAGGED ===\n${flagged.join('\n')}`,
    },
  ];
}

/**
 * Apply the Editor's rewrites to flagged paragraphs. Rewrites of paragraphs
 * that weren't flagged, empty ones, unchanged ones, and repeats are ignored.
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
 * Ask the Editor to fix flagged paragraphs and apply its rewrites.
 *
 * @param {Object} params
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {import('./run-recorder.js').RunRecorder} params.recorder
 * @param {string} params.houseStyle
 * @param {string} params.text
 * @param {Array<Object>} params.findings - From lintProse; at least one.
 * @param {string|null} [params.readerName]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ text: string, edits: Array<Object> }>}
 */
export async function runEditor({
  client,
  recorder,
  houseStyle,
  text,
  findings,
  readerName = null,
  signal,
}) {
  const messages = buildEditorMessages({ houseStyle, text, findings, readerName });
  const recordedRequest = {
    model: client.model,
    thinking: false,
    maxTokens: EDITOR_MAX_TOKENS,
    messages,
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
