<template>
  <div
    class="character-card"
    :class="{ clickable: clickable }"
    @click="handleClick"
  >
    <div
      class="character-avatar"
      :style="avatarStyle"
    >
      <div v-if="!character.imageUrl" class="character-initial">
        {{ characterInitial }}
      </div>
      <div class="character-name-overlay">
        {{ character.name || 'Unknown' }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  character: {
    type: Object,
    required: true
  },
  clickable: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click'])

const characterInitial = computed(() => {
  const name = props.character.name || 'U'
  return name.charAt(0).toUpperCase()
})

const avatarStyle = computed(() => {
  if (props.character.imageUrl) {
    return {
      backgroundImage: `url(${props.character.imageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center top'
    }
  }
  return {}
})

function handleClick() {
  if (props.clickable) {
    emit('click', props.character)
  }
}
</script>

<style scoped>
.character-card {
  width: 100%;
}

.character-card.clickable {
  cursor: pointer;
  transition: transform 0.2s;
}

.character-card.clickable:hover {
  transform: translateY(-2px);
}

.character-avatar {
  width: 100%;
  aspect-ratio: 2 / 3;
  background-color: var(--bg-tertiary);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.character-initial {
  color: var(--text-secondary);
  font-size: 3rem;
  font-weight: 600;
}

.character-name-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  padding: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  border-bottom-left-radius: 8px;
  border-top-right-radius: 4px;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
