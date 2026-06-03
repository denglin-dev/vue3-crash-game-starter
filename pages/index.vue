<template>
  <div class="home">
    <h1>Cybet Original Games — Demo</h1>
    <p class="desc">
      Nuxt 3 + Vue 3 showcase. All games run with local mock hooks — no backend required.
    </p>
    <div class="cards">
      <NuxtLink v-for="game in games" :key="game.path" :to="game.path" class="card">
        <h2>{{ game.title }}</h2>
        <p>{{ game.desc }}</p>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
const games = [
  { title: 'Mines', path: '/game/mines', desc: 'Grid-based minesweeper betting game' },
  { title: 'Plinko', path: '/game/plinko', desc: 'Pixi.js ball physics plinko' },
  { title: 'Crash', path: '/game/crash', desc: 'Multiplier curve crash game' },
]
</script>

<style scoped lang="scss">
.home {
  width: 100%;
  padding: 48px 15px;
  box-sizing: border-box;
}

h1 {
  font-size: 28px;
  margin-bottom: 8px;
}

.desc {
  color: #6a89ad;
  margin-bottom: 32px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.card {
  display: block;
  padding: 24px;
  border-radius: 12px;
  background: #111933;
  border: 1px solid #1c2a46;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s;

  &:hover {
    border-color: #456c99;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 20px;
  }

  p {
    margin: 0;
    color: #6a89ad;
    font-size: 14px;
  }
}
</style>
