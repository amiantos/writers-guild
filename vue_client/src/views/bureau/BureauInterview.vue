<template>
  <div class="bureau-interview-page">
    <header class="interview-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small back-button" @click="leave">
          <i class="fas fa-arrow-left"></i>
          <span class="back-label">Back</span>
        </button>
        <img
          v-if="castMember?.libraryCharacterId && !brokenAvatar"
          class="interview-avatar"
          :src="`/api/characters/${castMember.libraryCharacterId}/thumbnail`"
          alt=""
          @error="brokenAvatar = true"
        />
        <h1 class="interview-title">
          {{ castMember ? `Interviewing ${castMember.name}` : 'Interview' }}
        </h1>
      </div>
      <div v-if="interview" class="header-right">
        <button
          v-if="!reviewing"
          class="btn btn-primary btn-small"
          :disabled="!canWriteUp"
          :title="writeUpTitle"
          @click="writeUpAnswers"
        >
          <i class="fas fa-pen-nib"></i>
          <span class="action-label">{{ writingUp ? 'Writing it up...' : 'Write it up' }}</span>
        </button>
        <button class="icon-btn" title="Discard this interview" :disabled="busy" @click="discard">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading interview...</p>
    </div>

    <div v-else-if="loadError" class="loading-container">
      <p>{{ loadError }}</p>
      <button class="btn btn-secondary" @click="leave">Back</button>
    </div>

    <template v-else>
      <main ref="listRef" class="interview-reading">
        <div class="interview-column">
          <section v-if="!interview" class="form">
            <p class="intro">
              Answer questions about {{ castMember.name }}, one at a time. When you've said enough,
              Write it up turns your answers into a new description, personality, and routine for
              you to review. Nothing changes until you accept, and {{ castMember.name }}'s profile
              keeps every earlier version.
            </p>
            <div class="form-group">
              <span class="group-label">What to cover</span>
              <label
                v-for="option in focuses"
                :key="option.key"
                class="focus-option"
                :class="{ selected: focus === option.key }"
              >
                <input v-model="focus" type="radio" name="interview-focus" :value="option.key" />
                <span class="focus-text">
                  <span class="focus-label">{{ option.label }}</span>
                  <span class="focus-description">{{ option.description }}</span>
                </span>
              </label>
            </div>
            <div class="form-group">
              <label for="interview-note">Anything in particular? (optional)</label>
              <textarea
                id="interview-note"
                v-model="note"
                class="textarea-input"
                rows="2"
                maxlength="2000"
                :placeholder="`Say, how ${castMember.name} came to live where they do`"
              ></textarea>
            </div>
            <p v-if="!bureau.hasApiKey" class="composer-warning">
              <i class="fas fa-key"></i> This Bureau has no API key. Add one in the Bureau's
              settings to start an interview.
            </p>
            <div>
              <button class="btn btn-primary" :disabled="busy || !bureau.hasApiKey" @click="start">
                <i class="fas fa-comments"></i> Start the interview
              </button>
            </div>
          </section>

          <section v-else-if="reviewing" class="form review">
            <div>
              <h2 class="review-title">{{ castMember.name }}'s new profile</h2>
              <p v-if="interview.proposal.changes" class="review-changes">
                {{ interview.proposal.changes }}
              </p>
            </div>
            <p class="help-text">
              Edit anything before you accept. Nothing changes until you do, and the current version
              stays in the profile's history.
            </p>

            <div v-for="field in REVIEW_FIELDS" :key="field.key" class="form-group">
              <label :for="`review-${field.key}`">{{ field.label }}</label>
              <textarea
                :id="`review-${field.key}`"
                v-model="drafts[field.key]"
                class="textarea-input"
                :rows="field.rows"
                :maxlength="field.maxLength"
              ></textarea>
              <p v-if="tooLong(field)" class="composer-warning">
                The {{ field.label.toLowerCase() }} is {{ drafts[field.key].length }} characters.
                Trim it to {{ field.maxLength }} characters or fewer to accept.
              </p>
              <details class="current-version">
                <summary>Current {{ field.label.toLowerCase() }}</summary>
                <p>{{ interview.proposal.base[field.key] || 'Empty.' }}</p>
              </details>
            </div>

            <div v-if="relationshipDrafts.length > 0" class="form-group">
              <span class="group-label">Add to other profiles</span>
              <p class="help-text">
                Each line goes at the end of that person's description, so it holds in scenes
                without {{ castMember.name }}.
              </p>
              <div
                v-for="relationship in relationshipDrafts"
                :key="relationship.castId"
                class="relationship"
              >
                <label class="checkbox-label">
                  <input v-model="relationship.include" type="checkbox" />
                  {{ relationship.name }}
                </label>
                <textarea
                  v-model="relationship.addition"
                  class="textarea-input"
                  rows="2"
                  :disabled="!relationship.include"
                  :aria-label="`Add to ${relationship.name}'s description`"
                ></textarea>
              </div>
            </div>

            <div class="review-actions">
              <button class="btn btn-secondary" :disabled="busy" @click="reviewing = false">
                Back to the interview
              </button>
              <button
                class="btn btn-secondary"
                :disabled="busy || !bureau.hasApiKey"
                @click="writeUpAnswers"
              >
                <i class="fas fa-rotate"></i>
                {{ writingUp ? 'Writing it up...' : 'Write it again' }}
              </button>
              <button
                class="btn btn-primary"
                :disabled="busy || REVIEW_FIELDS.some(tooLong)"
                @click="accept"
              >
                <i class="fas fa-check"></i> {{ accepting ? 'Saving...' : 'Accept' }}
              </button>
            </div>
          </section>

          <template v-else>
            <p class="interview-meta">
              {{ focusLabel }}<template v-if="interview.note"> · {{ interview.note }}</template>
            </p>
            <div
              v-for="message in interview.messages"
              :key="message.id"
              class="bubble-row"
              :class="message.source === 'user' ? 'from-reader' : 'from-interviewer'"
            >
              <div class="bubble">{{ message.content }}</div>
            </div>
            <div v-if="pending" class="bubble-row from-interviewer">
              <div class="bubble pending" :class="{ typing: !pending.content }">
                {{ pending.content || 'Thinking of a question...' }}
              </div>
            </div>
            <div v-if="!sending" class="question-actions">
              <button
                class="btn btn-secondary btn-small"
                :disabled="busy || !bureau.hasApiKey"
                @click="askAgain"
              >
                <i class="fas fa-rotate"></i>
                {{ lastMessage?.source === 'generated' ? 'Ask something else' : 'Ask a question' }}
              </button>
            </div>
          </template>
        </div>
      </main>

      <div v-if="interview && !reviewing" class="interview-composer">
        <p v-if="!bureau.hasApiKey" class="composer-warning">
          <i class="fas fa-key"></i> This Bureau has no API key. Add one in the Bureau's settings to
          go on.
        </p>
        <p v-else-if="interview.proposal" class="composer-note">
          A write-up is waiting.
          <button class="link-button" @click="openReview(interview.proposal)">Review it</button>, or
          answer again to set it aside.
        </p>
        <div class="composer-row">
          <textarea
            v-model="text"
            class="composer-input"
            rows="2"
            :disabled="!canAnswer"
            placeholder="Your answer..."
            aria-label="Your answer"
            @keydown="handleKeydown"
          ></textarea>
          <div class="composer-actions">
            <template v-if="!sending">
              <button
                class="btn btn-secondary"
                title="Skip this question"
                :disabled="!canAnswer"
                @click="answerWith(SKIP)"
              >
                Skip
              </button>
              <button
                class="btn btn-secondary"
                title="Let the interviewer choose, and say what it chose"
                :disabled="!canAnswer"
                @click="answerWith(YOU_DECIDE)"
              >
                You decide
              </button>
              <button
                class="btn btn-primary"
                title="Answer (Enter). Shift + Enter starts a new line."
                :disabled="!canAnswer || !text.trim()"
                @click="send"
              >
                <i class="fas fa-paper-plane"></i> Answer
              </button>
            </template>
            <button v-else class="btn btn-danger" @click="stop">
              <i class="fas fa-stop"></i> Stop
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { bureauInterviewsAPI } from '../../services/bureauApi';
import { useNavigation } from '../../composables/useNavigation';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { setPageTitle } from '../../router';

const SKIP = 'Skip this one.';
const YOU_DECIDE = 'You decide.';
const REVIEW_FIELDS = [
  { key: 'description', label: 'Description', rows: 10 },
  { key: 'personality', label: 'Personality', rows: 5 },
  { key: 'routine', label: 'Routine', rows: 4, maxLength: 2000 },
];

const props = defineProps({
  bureauId: { type: String, required: true },
  castId: { type: String, required: true },
});

const { goBack } = useNavigation();
const toast = useToast();
const { confirm } = useConfirm();

const bureau = ref(null);
const castMember = ref(null);
const interview = ref(null);
const focuses = ref([]);
const focus = ref('');
const note = ref('');
const loading = ref(true);
const loadError = ref('');
const brokenAvatar = ref(false);

const text = ref('');
const sending = ref(false);
const pending = ref(null);
let abortController = null;

const reviewing = ref(false);
const drafts = reactive({ description: '', personality: '', routine: '' });
const relationshipDrafts = ref([]);
const writingUp = ref(false);
const accepting = ref(false);

const listRef = ref(null);

const busy = computed(() => sending.value || writingUp.value || accepting.value);
const lastMessage = computed(() => interview.value?.messages.at(-1) ?? null);
const hasAnswers = computed(() =>
  Boolean(interview.value?.messages.some((message) => message.source === 'user')),
);
// Answers go to a question, so there has to be one waiting.
const canAnswer = computed(
  () =>
    Boolean(bureau.value?.hasApiKey) && !busy.value && lastMessage.value?.source === 'generated',
);
const canWriteUp = computed(
  () => Boolean(bureau.value?.hasApiKey) && hasAnswers.value && !busy.value,
);
const writeUpTitle = computed(() =>
  hasAnswers.value
    ? 'Turn your answers into a new profile to review'
    : 'Answer at least one question first',
);
const focusLabel = computed(
  () => focuses.value.find((option) => option.key === interview.value?.focus)?.label ?? '',
);

function leave() {
  goBack({ name: 'bureau', params: { bureauId: props.bureauId } });
}

async function scrollToEnd() {
  await nextTick();
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight;
  }
}

function openReview(proposal) {
  for (const field of REVIEW_FIELDS) {
    drafts[field.key] = proposal[field.key] ?? '';
  }
  relationshipDrafts.value = proposal.relationships.map((relationship) => ({
    ...relationship,
    include: true,
  }));
  reviewing.value = true;
  nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = 0;
  });
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await bureauInterviewsAPI.get(props.bureauId, props.castId);
    bureau.value = data.bureau;
    castMember.value = data.castMember;
    interview.value = data.interview;
    focuses.value = data.focuses;
    focus.value = data.focuses[0]?.key ?? '';
    setPageTitle(`Interviewing ${data.castMember.name}`);
    if (data.interview?.proposal) {
      openReview(data.interview.proposal);
    }
  } catch (error) {
    console.error('Failed to load the interview:', error);
    loadError.value =
      error.status === 404
        ? 'This cast member is no longer in the Bureau.'
        : `Failed to load: ${error.message}`;
  } finally {
    loading.value = false;
  }
  scrollToEnd();
}

async function refresh() {
  try {
    const data = await bureauInterviewsAPI.get(props.bureauId, props.castId);
    interview.value = data.interview;
  } catch (error) {
    toast.error('Failed to refresh the interview: ' + error.message);
  }
}

/**
 * Stream a question. `request` receives the abort signal and returns the event stream. The
 * interview is reloaded afterward so it matches what was saved.
 * @param {Object} [options]
 * @param {string} [options.draft] - An answer the reader typed, given back if it isn't saved.
 */
async function runQuestion(request, { draft = '' } = {}) {
  if (sending.value) return;

  abortController = new AbortController();
  sending.value = true;
  pending.value = { content: '' };
  let answerSaved = false;
  let stopped = false;

  try {
    for await (const event of request(abortController.signal)) {
      if (event.type === 'interview') {
        answerSaved = true;
        interview.value = event.interview;
      } else if (event.type === 'content') {
        pending.value.content += event.text;
      } else if (event.type === 'done') {
        interview.value = event.interview;
      }
      scrollToEnd();
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      stopped = true;
      toast.info('Stopped. Anything already written was kept.');
    } else {
      console.error('Interview question failed:', error);
      toast.error('The question failed: ' + error.message);
      // Nothing was saved, so give the reader their words back.
      if (!answerSaved && draft) {
        text.value = draft;
      }
    }
  } finally {
    sending.value = false;
    pending.value = null;
    abortController = null;
  }

  await refresh();
  scrollToEnd();
  if (stopped) {
    // The server saves the partial question once it notices the disconnect.
    setTimeout(refresh, 1000);
  }
}

function start() {
  if (busy.value || !bureau.value?.hasApiKey) return;
  runQuestion((signal) =>
    bureauInterviewsAPI.start(
      props.bureauId,
      props.castId,
      { focus: focus.value, note: note.value.trim() },
      signal,
    ),
  );
}

/** Answer the latest question. Only a typed answer goes back in the box if it fails, not Skip. */
function answerWith(answer, { typed = false } = {}) {
  if (!answer || !canAnswer.value) return;
  runQuestion(
    (signal) => bureauInterviewsAPI.answer(props.bureauId, props.castId, answer, signal),
    { draft: typed ? answer : '' },
  );
}

function send() {
  const answer = text.value.trim();
  if (!answer || !canAnswer.value) return;
  text.value = '';
  answerWith(answer, { typed: true });
}

function askAgain() {
  if (busy.value || !bureau.value?.hasApiKey) return;
  runQuestion((signal) => bureauInterviewsAPI.askAgain(props.bureauId, props.castId, signal));
}

function stop() {
  abortController?.abort();
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

async function writeUpAnswers() {
  if (busy.value || !hasAnswers.value || !bureau.value?.hasApiKey) return;
  writingUp.value = true;
  try {
    const { interview: updated } = await bureauInterviewsAPI.writeUp(props.bureauId, props.castId);
    interview.value = updated;
    openReview(updated.proposal);
  } catch (error) {
    toast.error('Failed to write it up: ' + error.message);
  } finally {
    writingUp.value = false;
  }
}

/** Whether a reviewed field is longer than the profile holds. */
function tooLong(field) {
  return Boolean(field.maxLength) && drafts[field.key].length > field.maxLength;
}

async function accept() {
  if (busy.value || REVIEW_FIELDS.some(tooLong)) return;
  accepting.value = true;
  try {
    const { updated } = await bureauInterviewsAPI.accept(props.bureauId, props.castId, {
      description: drafts.description,
      personality: drafts.personality,
      routine: drafts.routine,
      relationships: relationshipDrafts.value
        .filter((relationship) => relationship.include)
        .map(({ castId, addition }) => ({ castId, addition })),
    });
    const names = [castMember.value.name, ...updated.map((member) => member.name)];
    toast.success(
      names.length === 1
        ? `Updated ${names[0]}'s profile`
        : `Updated the profiles of ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`,
    );
    leave();
  } catch (error) {
    toast.error('Failed to accept: ' + error.message);
  } finally {
    accepting.value = false;
  }
}

async function discard() {
  const confirmed = await confirm({
    message: `Discard this interview?\n\nIts questions, answers, and any write-up are deleted. ${castMember.value.name}'s profile stays as it is.`,
    confirmText: 'Discard',
    variant: 'danger',
  });
  if (!confirmed) return;

  try {
    await bureauInterviewsAPI.discard(props.bureauId, props.castId);
    interview.value = null;
    reviewing.value = false;
    toast.info('Discarded the interview');
  } catch (error) {
    toast.error('Failed to discard: ' + error.message);
  }
}

onMounted(load);
onBeforeUnmount(() => {
  abortController?.abort();
});
</script>

<style scoped src="../../components/bureau/bureau-ui.css"></style>

<style scoped>
.bureau-interview-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background-color: var(--bg-secondary);
}

.interview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  box-shadow: var(--shadow);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.interview-avatar {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  object-fit: cover;
}

.interview-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 1rem;
  color: var(--text-secondary);
}

.interview-reading {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.interview-column {
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.intro {
  margin: 0;
  line-height: 1.55;
}

.focus-option {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
}

.focus-option.selected {
  border-color: var(--accent-primary);
}

.focus-option input {
  margin-top: 0.2rem;
  accent-color: var(--accent-primary);
}

.focus-text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.focus-label {
  font-weight: 600;
}

.focus-description {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.interview-meta {
  align-self: center;
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.bubble-row {
  display: flex;
}

.bubble-row.from-reader {
  justify-content: flex-end;
}

.bubble {
  max-width: min(36rem, 80%);
  padding: 0.5rem 0.875rem;
  border-radius: 1rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.from-interviewer .bubble {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-bottom-left-radius: 0.25rem;
}

.from-reader .bubble {
  background-color: var(--accent-primary);
  color: var(--text-on-accent, #fff);
  border-bottom-right-radius: 0.25rem;
}

.bubble.pending {
  border-style: dashed;
}

.bubble.typing {
  color: var(--text-secondary);
  font-style: italic;
}

.question-actions {
  display: flex;
}

.review-title {
  margin: 0;
  font-size: 1.125rem;
}

.review-changes {
  margin: 0.375rem 0 0;
  line-height: 1.5;
}

.current-version summary {
  font-size: 0.8rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.current-version p {
  margin: 0.375rem 0 0;
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}

.relationship {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.review-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.interview-composer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem 1rem;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.composer-warning,
.composer-note {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  font-size: 0.85rem;
}

.composer-warning {
  color: var(--warning);
}

.composer-note {
  color: var(--text-secondary);
}

.link-button {
  padding: 0;
  font: inherit;
  color: var(--accent-primary);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
}

.composer-row {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 0.625rem;
}

.composer-input {
  flex: 1;
  box-sizing: border-box;
  padding: 0.625rem 0.875rem;
  font: inherit;
  line-height: 1.5;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  resize: vertical;
  outline: none;
}

.composer-input:focus {
  border-color: var(--accent-primary);
}

.composer-actions {
  display: flex;
  gap: 0.5rem;
}

@media (max-width: 700px) {
  .interview-header,
  .interview-reading,
  .interview-composer {
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }

  .back-label,
  .action-label {
    display: none;
  }

  .composer-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
