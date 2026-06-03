<template>
  <div class="demo-layout">
    <header class="demo-header">
      <NuxtLink to="/" class="demo-logo">Cy Games Demo</NuxtLink>
      <nav class="demo-nav">
        <NuxtLink to="/game/mines">Mines</NuxtLink>
        <NuxtLink to="/game/plinko">Plinko</NuxtLink>
        <NuxtLink to="/game/crash">Crash</NuxtLink>
      </nav>
    </header>
    <main class="demo-main">
      <slot />
    </main>
  </div>
</template>

<style scoped lang="scss">
.demo-layout {
  min-height: 100vh;
  width: 100%;
  max-width: var(--center-width);
  margin-inline: auto;
  background: #0b1220;
  color: #fff;
  box-sizing: border-box;
}

.demo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid #1c2a46;
  background: #111933;
}

.demo-logo {
  font-weight: 700;
  color: #fff;
  text-decoration: none;
}

.demo-nav {
  display: flex;
  gap: 16px;

  a {
    color: #6a89ad;
    text-decoration: none;
    font-size: 14px;

    &.router-link-active {
      color: #fff;
    }
  }
}

.demo-main {
  padding: 16px;
}
</style>
