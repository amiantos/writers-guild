<template>
  <Modal title="Welcome to Bureau" max-width="680px" @close="$emit('close')">
    <div class="intro">
      <p class="lead">
        <span class="experimental-badge">Experimental</span>
        A Bureau is a home for a cast and an ongoing story, written in chapters. Characters remember
        what happened, change over time, and can be written to between chapters. It's separate from
        story mode: nothing here changes your stories or your library.
      </p>

      <section>
        <h3>Getting started</h3>
        <ol class="steps">
          <li>
            Create a Bureau and give it a DeepSeek API key. Each Bureau has its own key, and
            DeepSeek V4.1 Flash is the default model.
          </li>
          <li>
            Add characters from your library, or generate new ones. Mark one as your
            <strong>reader's character</strong>: the one you write for.
          </li>
          <li>Attach lorebooks if you like, then start a chapter.</li>
        </ol>
      </section>

      <section>
        <h3>What things are called</h3>
        <dl class="terms">
          <div v-for="term in TERMS" :key="term.name" class="term">
            <dt>{{ term.name }}</dt>
            <dd>{{ term.description }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <template #footer>
      <button class="btn btn-primary" @click="$emit('close')">Got it</button>
    </template>
  </Modal>
</template>

<script setup>
import Modal from '../Modal.vue';

defineEmits(['close']);

const TERMS = [
  {
    name: 'Cast',
    description:
      "The Bureau's characters. Each keeps its own copy of their card, so what happens in a Bureau never changes your library.",
  },
  {
    name: 'Chapters',
    description:
      "Installments of the Bureau's ongoing story, each with its own title, start time, and cast. Chapters happen in order, and later chapters remember earlier ones.",
  },
  {
    name: 'Turns',
    description:
      'A chapter is written in turns: Write adds your passage and the Writer continues from it, Direct tells the Writer what should happen next, and Continue lets it keep going.',
  },
  {
    name: 'Seams',
    description:
      'Hover between turns to see how a passage was written: the plan, what was looked up, the prompt, and any fixes.',
  },
  {
    name: 'Director, Writer, Editor, Archivist',
    description:
      "The Director plans each passage from the characters' memories and your lorebooks, the Writer writes it, the Editor fixes what the style checks catch (like two characters speaking in one paragraph), and the Archivist commits what happened to memory.",
  },
  {
    name: 'Memories',
    description:
      "Each character remembers what they know, what happened from their point of view, and how they've changed. Every memory shows where it came from, and you can edit, pin, or retire any of them.",
  },
  {
    name: 'How they’ve changed',
    description:
      'When a chapter changes someone, the Archivist proposes a note for you to accept or reject. The card itself never changes; accepted notes add to it.',
  },
  {
    name: 'Messages',
    description:
      "Between chapters, write to cast members as your reader's character. Replies know their memories, their routine, and the time of day, and conversations become memories too.",
  },
  {
    name: 'Bureau time',
    description:
      'One clock for the Bureau, and only you move it: let time pass between messages or within a chapter, set it in settings, or choose when a chapter starts and ends. Messages happen at Bureau time, in any year from 1 to 9999. A chapter only remembers what came before its start, so starting earlier works as a flashback.',
  },
  {
    name: 'Offscreen life',
    description:
      'When time moves on without a character, they get a short, mostly ordinary account of what they did meanwhile, shaped by their routine.',
  },
  {
    name: 'Drafts',
    description:
      'Characters generated in a Bureau, by you or by the Director when someone new walks into a chapter. They stay out of your library until you save them.',
  },
];
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.intro {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  line-height: 1.5;
}

.lead {
  margin: 0;
}

.lead .experimental-badge {
  margin-right: 0.375rem;
}

h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.steps {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.terms {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.term dt {
  font-weight: 600;
}

.term dd {
  margin: 0.125rem 0 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}
</style>
