import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  InterviewChangedError,
  ProfileChangedError,
  WRITE_PROFILE_TOOL,
  acceptProposal,
  askQuestion,
  buildQuestionMessages,
  buildWriteUpMessages,
  proposalFrom,
  writeUp,
} from '../interview.js';
import { profileOf } from '../bureau-storage.js';
import { getBureauStores } from '../stores.js';
import { closeBureauDb } from '../bureau-db.js';
import { DeepSeekError, assertStrictSchema } from '../deepseek-client.js';
import { ImagePreserver } from '../../image-preserver.js';

const LIGHT = '![the light](https://example.com/light.png)';
const COAT = '![her coat](https://example.com/coat.png)';

const WRITTEN = {
  description: 'Mara keeps the lighthouse her father kept.',
  personality: 'Dry, and kinder than she lets on.',
  routine: 'Keeps the light from dusk to dawn.',
  changes: 'Adds her father and her nights.',
  relationships: [
    { name: 'ines', addition: 'Ines keeps a stool at the bar for Mara on Fridays.' },
    { name: 'Nobody', addition: 'Not in the cast.' },
    { name: 'Theo', addition: '' },
    { name: 'Ines', addition: 'They were at school together.' },
  ],
};

function card(name, fields = {}) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name, ...fields } };
}

/** Streams `question` for questions; answers write-ups with a write_profile call with `args`. */
function interviewClient({
  question = 'Who taught Mara the light?',
  args = WRITTEN,
  failWith,
} = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async *chatStream(options) {
      client.calls.push(options);
      if (failWith) throw failWith;
      yield { type: 'content', text: question.slice(0, 5) };
      yield { type: 'content', text: question.slice(5) };
      yield { type: 'done', finishReason: 'stop', usage: null, model: 'deepseek-flash' };
    },
    async chat(options) {
      client.calls.push(options);
      if (failWith) throw failWith;
      return {
        content: '',
        reasoning: '',
        finishReason: 'tool_calls',
        model: 'deepseek-flash',
        usage: { prompt_tokens: 900, completion_tokens: 300 },
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'write_profile',
              arguments: typeof args === 'string' ? args : JSON.stringify(args),
            },
          },
        ],
      };
    },
  };
  return client;
}

describe('interviews', () => {
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let theo;
  let ines;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-interview-'));
    stores = getBureauStores(tempDir);
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-interview' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara', {
        description: '{{char}} keeps the lighthouse for {{user}}.',
        personality: 'Dry.',
      }),
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo', { description: 'A ferryman.' }),
      isPersona: true,
    });
    ines = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Ines', { description: 'Runs the harbor pub.' }),
    });
  });

  afterEach(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const current = (member) => stores.bureaus.getCastMember(bureau.id, member.id);

  function startWith(messages) {
    let interview = stores.interviews.startInterview(bureau.id, mara.id, { focus: 'flesh_out' });
    for (const [source, content] of messages) {
      interview = stores.interviews.addMessage(bureau.id, interview.id, { source, content });
    }
    return interview;
  }

  describe('buildQuestionMessages', () => {
    it('grounds the interviewer in the profile, the focus, and the rest of the cast', () => {
      const [system, first, ...rest] = buildQuestionMessages({
        member: current(mara),
        interview: { focus: 'routine', note: ' Her nights ', messages: [] },
        cast: [current(theo), current(ines)],
        persona: current(theo),
        memories: {
          knowledge: [{ content: 'Theo hates the cold.' }],
          episodes: [],
          offscreen: { content: 'Took the ferry to the mainland for parts.' },
        },
        arcNotes: [{ content: 'Sleeps better now.' }],
        world: ['Harbor lore: the light'],
      });

      expect(system.role).toBe('system');
      expect(system.content).toContain('Focus on their routine');
      expect(system.content).toContain('Mara lately: Took the ferry to the mainland for parts.');
      expect(system.content).toContain("The author's note: Her nights");
      expect(system.content).toContain('Description: Mara keeps the lighthouse for Theo.');
      expect(system.content).toContain('Usual routine: (not described yet)');
      expect(system.content).toContain('How Mara has changed:\n- Sleeps better now.');
      expect(system.content).toContain('Mara knows:\n- Theo hates the cold.');
      expect(system.content).toContain("- Theo (the reader's character): A ferryman.");
      expect(system.content).toContain('- Ines: Runs the harbor pub.');
      expect(system.content).toContain('- Harbor lore: the light');
      expect(first).toEqual({ role: 'user', content: 'Ask your first question.' });
      expect(rest).toEqual([]);
    });

    it('carries the conversation, asking for something other than a question set aside', () => {
      const messages = buildQuestionMessages({
        member: current(mara),
        interview: {
          focus: 'flesh_out',
          note: '',
          messages: [
            { source: 'generated', content: 'Who taught her?' },
            { source: 'user', content: 'Her father.' },
          ],
        },
        setAside: 'Why the harbor?',
      });

      expect(messages.slice(1)).toEqual([
        { role: 'user', content: 'Ask your first question.' },
        { role: 'assistant', content: 'Who taught her?' },
        { role: 'user', content: 'Her father.\n\n(Ask something other than: "Why the harbor?")' },
      ]);
    });
  });

  describe('askQuestion', () => {
    it('streams the next question, saves it, and records the run', async () => {
      const interview = startWith([]);
      const client = interviewClient();
      const events = [];

      const saved = await askQuestion({
        stores,
        bureau,
        interview,
        member: current(mara),
        client,
        onEvent: (event) => events.push(event),
      });

      expect(events.map((event) => event.type)).toEqual(['run', 'content', 'content']);
      expect(saved.messages).toEqual([
        expect.objectContaining({
          source: 'generated',
          content: 'Who taught Mara the light?',
          runId: events[0].runId,
        }),
      ]);
      expect(client.calls[0]).toMatchObject({ thinking: false });
      expect(client.calls[0].messages[0].content).toContain('- Ines: Runs the harbor pub.');
      const run = stores.bureaus.getRun(bureau.id, events[0].runId);
      expect(run).toMatchObject({
        purpose: 'interview',
        targetType: 'interview',
        targetId: interview.id,
        status: 'completed',
      });
      expect(run.steps.map((step) => step.role)).toEqual(['interviewer']);
    });

    it('replaces the latest question when asked again', async () => {
      const interview = startWith([['generated', 'Why the harbor?']]);
      const client = interviewClient({ question: 'What does she do on Fridays?' });

      const saved = await askQuestion({
        stores,
        bureau,
        interview,
        member: current(mara),
        client,
        replace: true,
      });

      expect(saved.messages.map((message) => message.content)).toEqual([
        'What does she do on Fridays?',
      ]);
      expect(client.calls[0].messages.at(-1).content).toContain(
        '(Ask something other than: "Why the harbor?")',
      );
    });

    it('saves nothing and fails the run when the model fails', async () => {
      const interview = startWith([]);
      const client = interviewClient({ failWith: new DeepSeekError('DeepSeek API error 500') });

      await expect(
        askQuestion({ stores, bureau, interview, member: current(mara), client }),
      ).rejects.toThrow('DeepSeek API error 500');

      expect(stores.interviews.getInterview(bureau.id, interview.id).messages).toEqual([]);
      expect(stores.bureaus.listRuns(bureau.id)[0].status).toBe('failed');
    });
  });

  describe('write-up', () => {
    it('has a strict schema', () => {
      expect(() => assertStrictSchema(WRITE_PROFILE_TOOL.parameters)).not.toThrow();
    });

    it('gives the write-up the profile, the cast, and the interview, with images as markers', () => {
      stores.bureaus.updateProfile(bureau.id, mara.id, {
        description: `Keeps the light. ${LIGHT}`,
      });
      const imagePreserver = new ImagePreserver();

      const [system, user] = buildWriteUpMessages({
        member: current(mara),
        interview: {
          focus: 'routine',
          note: '',
          messages: [
            { source: 'generated', content: 'When does she sleep?' },
            { source: 'user', content: 'Mornings.' },
          ],
        },
        cast: [current(theo), current(ines)],
        persona: current(theo),
        imagePreserver,
      });

      expect(system.content).toContain('Call write_profile once');
      expect(system.content).toContain('Keep each image marker');
      expect(system.content).not.toContain('{{user}}');
      expect(user.content).toContain('Description: Keeps the light. [WG_IMAGE_0]');
      expect(user.content).toContain('Usual routine: (empty)');
      expect(user.content).toContain('- Ines: Runs the harbor pub.');
      expect(user.content).toContain(
        'Focus: Daily routine\n\nInterviewer: When does she sleep?\nAuthor: Mornings.',
      );
      expect(imagePreserver.saved).toEqual([
        expect.objectContaining({ source: 'description', original: LIGHT }),
      ]);
    });

    it("keeps card placeholders as written, since the reader's character can change", () => {
      const [system, user] = buildWriteUpMessages({
        member: current(mara),
        interview: { focus: 'flesh_out', note: '', messages: [] },
        persona: current(theo),
      });

      expect(system.content).toContain(
        "The profile writes {{char}} for Mara and {{user}} for the reader's character (now Theo).",
      );
      expect(user.content).toContain('Description: {{char}} keeps the lighthouse for {{user}}.');
    });

    it('puts images back, keeps any left out, and matches relationship lines to the cast', () => {
      const imagePreserver = new ImagePreserver();
      imagePreserver.preserve(LIGHT, 'description');
      imagePreserver.preserve(COAT, 'personality');

      const proposal = proposalFrom(
        { ...WRITTEN, description: `${WRITTEN.description} [WG_IMAGE_0]` },
        {
          member: current(mara),
          cast: [current(theo), current(ines)],
          imagePreserver,
          runId: 'run-1',
          now: new Date('2026-09-14T12:00:00Z'),
        },
      );

      expect(proposal).toEqual({
        description: `Mara keeps the lighthouse her father kept. ${LIGHT}`,
        personality: `Dry, and kinder than she lets on.\n\n${COAT}`,
        routine: 'Keeps the light from dusk to dawn.',
        changes: 'Adds her father and her nights.',
        relationships: [
          {
            castId: ines.id,
            name: 'Ines',
            addition:
              'Ines keeps a stool at the bar for Mara on Fridays. They were at school together.',
          },
        ],
        base: {
          description: '{{char}} keeps the lighthouse for {{user}}.',
          personality: 'Dry.',
          routine: '',
        },
        runId: 'run-1',
        created: '2026-09-14T12:00:00.000Z',
      });
    });

    it('keeps what the profile had in a field the write-up left empty', () => {
      stores.bureaus.updateProfile(bureau.id, mara.id, { routine: 'Nights at the light.' });

      const proposal = proposalFrom(
        { ...WRITTEN, description: ' ', routine: '' },
        { member: current(mara), cast: [] },
      );

      expect(proposal).toMatchObject({
        description: '{{char}} keeps the lighthouse for {{user}}.',
        personality: WRITTEN.personality,
        routine: 'Nights at the light.',
      });
    });

    it('saves the write-up as a proposal and records the run', async () => {
      const interview = startWith([
        ['generated', 'Who taught her?'],
        ['user', 'Her father.'],
      ]);
      const client = interviewClient();

      const saved = await writeUp({ stores, bureau, interview, member: current(mara), client });

      expect(client.calls[0]).toMatchObject({
        strict: true,
        toolChoice: { name: 'write_profile' },
        thinking: false,
      });
      expect(saved.proposal).toMatchObject({
        description: WRITTEN.description,
        relationships: [expect.objectContaining({ castId: ines.id })],
      });
      const run = stores.bureaus.getRun(bureau.id, saved.proposal.runId);
      expect(run).toMatchObject({ purpose: 'interview_write_up', status: 'completed' });
      expect(run.steps.map((step) => step.kind)).toEqual(['model', 'tool']);
    });

    it('saves no proposal when the write-up is cut off', async () => {
      const interview = startWith([['user', 'Her father.']]);
      const client = interviewClient({ args: '{"description": "Mara' });

      await expect(
        writeUp({ stores, bureau, interview, member: current(mara), client }),
      ).rejects.toThrow("wasn't valid JSON");

      expect(stores.interviews.getInterview(bureau.id, interview.id).proposal).toBeNull();
      expect(stores.bureaus.listRuns(bureau.id)[0].status).toBe('failed');
    });

    it("won't save a write-up that misses answers given while it was being written", async () => {
      const interview = startWith([
        ['generated', 'Who taught her?'],
        ['user', 'Her father.'],
      ]);
      const client = interviewClient();
      const writeProfile = client.chat;
      client.chat = async (options) => {
        stores.interviews.addMessage(bureau.id, interview.id, {
          source: 'generated',
          content: 'And her mother?',
        });
        stores.interviews.addMessage(bureau.id, interview.id, { source: 'user', content: 'Gone.' });
        return writeProfile(options);
      };

      await expect(
        writeUp({ stores, bureau, interview, member: current(mara), client }),
      ).rejects.toThrow(InterviewChangedError);

      expect(stores.interviews.getInterview(bureau.id, interview.id).proposal).toBeNull();
    });
  });

  describe('acceptProposal', () => {
    function proposed() {
      const interview = startWith([['user', 'Her father.']]);
      const proposal = proposalFrom(WRITTEN, {
        member: current(mara),
        cast: [current(theo), current(ines)],
      });
      return stores.interviews.setProposal(bureau.id, interview.id, proposal);
    }

    it('updates the profile and adds the lines kept to other descriptions, each as a version', () => {
      const interview = proposed();

      const accepted = acceptProposal({
        stores,
        bureau,
        interview,
        member: current(mara),
        edits: {
          description: '  Mara keeps the light.  ',
          personality: 'Dry.',
          routine: 'Nights.',
          relationships: [
            { castId: ines.id, addition: ' At school together. ' },
            { castId: theo.id, addition: 'Never proposed.' },
          ],
        },
      });

      expect(profileOf(accepted.castMember)).toMatchObject({
        description: 'Mara keeps the light.',
        personality: 'Dry.',
        routine: 'Nights.',
      });
      expect(accepted.updated.map((member) => member.id)).toEqual([ines.id]);
      expect(profileOf(current(ines)).description).toBe(
        'Runs the harbor pub.\n\nAt school together.',
      );
      expect(profileOf(current(theo)).description).toBe('A ferryman.');
      expect(accepted.interview).toMatchObject({
        status: 'accepted',
        proposal: {
          description: 'Mara keeps the light.',
          relationships: [{ castId: ines.id, name: 'Ines', addition: 'At school together.' }],
        },
      });
      expect(
        stores.bureaus
          .listProfileVersions(bureau.id, mara.id)
          .map((version) => [version.source, version.sourceId]),
      ).toEqual([
        ['original', null],
        ['interview', interview.id],
      ]);
      expect(stores.bureaus.listProfileVersions(bureau.id, ines.id).at(-1)).toMatchObject({
        source: 'interview',
        sourceId: interview.id,
        changed: ['description'],
      });
    });

    it("refuses once the character's profile has changed since the write-up", () => {
      const interview = proposed();
      stores.bureaus.updateProfile(bureau.id, mara.id, { routine: 'Days now.' });

      expect(() =>
        acceptProposal({ stores, bureau, interview, member: current(mara), edits: {} }),
      ).toThrow(ProfileChangedError);
      expect(stores.interviews.getInterview(bureau.id, interview.id).status).toBe('open');
    });
  });
});
