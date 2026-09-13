/**
 * Bureau Tool-Loop Smoke Test
 *
 * Runs a small tool-calling conversation with a Bureau's DeepSeek key and
 * model, records it like any other run, then reads the run back from
 * bureau.db to confirm every step was stored. This is phase 1's "done when"
 * check in docs/bureau-design.md.
 *
 * Usage, from the repo root:
 *   node server/scripts/bureau-smoke.js <bureauId>
 *   DEEPSEEK_API_KEY=sk-... node server/scripts/bureau-smoke.js --create
 *
 * Options:
 *   --create        First create a "Smoke test" Bureau with DEEPSEEK_API_KEY
 *   --no-thinking   Run with thinking mode off
 *   --data-root     Data directory (default: data.root from server/config.yaml)
 *
 * This calls the real API, so it spends a small number of tokens.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import yaml from 'yaml';
import { closeBureauDb } from '../src/services/bureau/bureau-db.js';
import { BureauStorage } from '../src/services/bureau/bureau-storage.js';
import { DeepSeekClient } from '../src/services/bureau/deepseek-client.js';
import { RunRecorder } from '../src/services/bureau/run-recorder.js';
import { runToolLoop } from '../src/services/bureau/tool-loop.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TOOLS = [
  {
    name: 'recall',
    description: "Search a character's memories.",
    parameters: {
      type: 'object',
      properties: {
        character: { type: 'string', description: 'Whose memories to search' },
        query: { type: 'string', description: 'What to look for' },
      },
      required: ['character', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_lore',
    description: 'Search world information: places, history, customs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic to look up' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

const HANDLERS = {
  recall: ({ character, query }) => ({
    character,
    query,
    memories: [
      'Mara and the persona repainted the lighthouse door blue last spring.',
      'Mara avoids the lighthouse stairs since she slipped on them as a child.',
    ],
  }),
  lookup_lore: ({ query }) => ({
    query,
    entries: ['The Greywater lighthouse was decommissioned in 1971 and is kept by volunteers.'],
  }),
};

const MESSAGES = [
  {
    role: 'system',
    content:
      'You are the Director in a story-writing pipeline. Gather facts with your tools before ' +
      'answering. Never invent memories or lore.',
  },
  {
    role: 'user',
    content:
      'The next scene is at the Greywater lighthouse. What does Mara remember about it, and ' +
      'what is its history? Use both tools, then answer in two sentences.',
  },
];

function defaultDataRoot() {
  const config = yaml.parse(fs.readFileSync(path.join(serverDir, 'config.yaml'), 'utf8'));
  return path.resolve(serverDir, config.data.root);
}

function oneLine(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function createSmokeBureau(storage) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('--create needs DEEPSEEK_API_KEY set in the environment');
  }
  const bureau = storage.createBureau({
    name: 'Smoke test',
    description: 'Created by server/scripts/bureau-smoke.js',
    apiKey,
  });
  console.log(`Created Bureau "${bureau.name}" (${bureau.id})`);
  return bureau.id;
}

function printRun(run) {
  console.log(`\nRun ${run.id}: ${run.status}${run.error ? ` (${run.error})` : ''}`);
  for (const step of run.steps) {
    const error = step.error ? `  ERROR: ${step.error}` : '';
    if (step.kind === 'model') {
      const usage = step.usage
        ? `${step.usage.prompt_tokens} in (${step.usage.prompt_cache_hit_tokens ?? 0} cached), ` +
          `${step.usage.completion_tokens} out`
        : 'no usage';
      const calls = step.toolCalls?.map((call) => call.function.name).join(', ');
      console.log(
        `  ${step.position}. model  ${step.durationMs}ms  ${usage}${calls ? `  → ${calls}` : ''}${error}`,
      );
      if (step.reasoning) {
        console.log(`     reasoning: ${oneLine(step.reasoning, 160)}`);
      }
    } else {
      console.log(
        `  ${step.position}. tool   ${step.request.name}(${step.request.arguments})  ${step.durationMs}ms${error}`,
      );
    }
  }
}

/** Confirm the stored run matches what the loop actually did. */
function verify(run, result) {
  const modelSteps = run.steps.filter((step) => step.kind === 'model');
  const toolSteps = run.steps.filter((step) => step.kind === 'tool');
  const requestedCalls = modelSteps.reduce((sum, step) => sum + (step.toolCalls?.length ?? 0), 0);

  const problems = [];
  if (run.status !== 'completed') problems.push(`run status is "${run.status}"`);
  if (modelSteps.length !== result.iterations) {
    problems.push(`expected ${result.iterations} model steps, found ${modelSteps.length}`);
  }
  if (toolSteps.length !== requestedCalls) {
    problems.push(`model requested ${requestedCalls} tool calls, ${toolSteps.length} recorded`);
  }
  if (toolSteps.length === 0) problems.push('the model never called a tool');

  if (problems.length > 0) {
    console.error(`\n✗ Smoke test failed:\n  - ${problems.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n✓ Recorded ${run.steps.length} steps (${modelSteps.length} model calls, ` +
      `${toolSteps.length} tool calls) in bureau.db`,
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      create: { type: 'boolean', default: false },
      'no-thinking': { type: 'boolean', default: false },
      'data-root': { type: 'string' },
    },
  });

  const dataRoot = values['data-root'] ? path.resolve(values['data-root']) : defaultDataRoot();
  const storage = new BureauStorage(dataRoot);

  try {
    const bureauId = values.create ? createSmokeBureau(storage) : positionals[0];
    if (!bureauId) {
      throw new Error(
        'Usage: node server/scripts/bureau-smoke.js <bureauId>  (or --create with DEEPSEEK_API_KEY)',
      );
    }

    const bureau = storage.getBureau(bureauId);
    if (!bureau) {
      throw new Error(`No Bureau with id ${bureauId} in ${dataRoot}`);
    }
    const credentials = storage.getBureauCredentials(bureauId);
    if (!credentials.apiKey) {
      throw new Error(`Bureau "${bureau.name}" has no API key`);
    }

    const thinking = !values['no-thinking'];
    console.log(`Bureau:   ${bureau.name} (${bureau.id})`);
    console.log(`Model:    ${credentials.model}, thinking ${thinking ? 'on' : 'off'}`);
    console.log(`Database: ${path.join(dataRoot, 'bureau.db')}`);

    const client = new DeepSeekClient(credentials);
    let runId = null;
    let result;
    try {
      result = await RunRecorder.record(
        storage,
        { bureauId, purpose: 'smoke_test' },
        (recorder) => {
          runId = recorder.runId;
          return runToolLoop({
            client,
            role: 'director',
            messages: MESSAGES,
            tools: TOOLS,
            handlers: HANDLERS,
            recorder,
            options: { thinking, strict: true, maxTokens: 8000 },
          });
        },
      );
    } finally {
      if (runId) printRun(storage.getRun(bureauId, runId));
    }

    console.log(`\nAnswer: ${result.content}`);
    verify(storage.getRun(bureauId, runId), result);
  } finally {
    closeBureauDb(dataRoot);
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
