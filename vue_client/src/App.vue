<template>
  <div id="app">
    <header class="app-header">
      <h1>Úrscéal</h1>
    </header>

    <main class="app-main">
      <LandingPage />
    </main>
  </div>
</template>

<script setup>
import LandingPage from './views/LandingPage.vue'
</script>

<style scoped>
.app-header {
  background-color: #2c3e50;
  color: white;
  padding: 1rem 2rem;
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.app-main {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}
</style>
