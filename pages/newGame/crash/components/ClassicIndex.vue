<template>
  <div class="classic">
    <TabBar v-model="tabbarActive" :tabbar-data="tabbarData" type="tabTag" class="crashClassic"
      :tabbar-can-change="tabbarChangeLocked">
      <template #tab-0>
        <ManualComponent :panel-active="tabbarActive === 0" />
      </template>
      <template #tab-1>
        <AutoComponent :panel-active="tabbarActive === 1" />
      </template>
    </TabBar>
  </div>
</template>

<script setup lang="ts">
/**
 * 经典模式外壳：Manual / Auto 两个子 Tab，使用全局 `~/components/GameComponents/TabBar.vue`。
 * 滚动由 TabBar 的 `.tabContent`（overflow:auto）承担，整块 `classicContent` 随内容增高后在外层滚动。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import TabBar from '~/components/GameComponents/TabBar.vue'
import { isBetting, cashoutRequestPending, isStart } from '../composables/useCrashState'
import ManualComponent from './classic/ManualComponent.vue'
import AutoComponent from './classic/AutoComponent.vue'

const { t: $t } = useI18n()

const tabbarActive = ref(0)
const tabbarData = ref([
  { label: $t('game.tabs.manual'), value: 'Manual' },
  { label: $t('game.tabs.auto'), value: 'Auto' },
])

/** 本局已下注/兑现中/自动投注序列：禁止切换经典手动、自动 Tab */
const tabbarChangeLocked = computed(
  () => isBetting.value || cashoutRequestPending.value || isStart.value,
)
</script>

<style lang="scss" scoped>
.classic {
  height: 100%;
  overflow: hidden;
  scrollbar-width: none;

  /* tabContent 默认是 block，子面板不会吃满剩余高度 → TotalBet 下方长期留白 */
  :deep(.tabBarPanel) {
    flex: 1 1 0%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  :deep(.classicContent) {
    flex: 1 1 0%;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;

    &::-webkit-scrollbar {
      width: 0;
      height: 0;
    }
  }

  @media screen and (max-width: 768px) {
    height: unset;
    overflow: unset;

    /* H5：仅放宽裁切，派彩仍用子组件内 top:-55，不改下注区排版 */
    :deep(.tabbar) {
      overflow: visible;
    }

    :deep(.tabBarPanel) {
      flex: unset;
      min-height: unset;
      display: block;
      overflow: unset;
    }

    :deep(.classicContent) {
      flex: unset;
      min-height: unset;
      /* 与桌面不同：窄屏若继承 overflow-y:auto，会把绝对定位上提的派彩裁掉 */
      overflow-y: visible;
      overflow-x: hidden;
    }
  }
}

.crashClassic {

  /*
	 * 去掉 TabBar 默认左右 10px，避免与 `.crashBox .crashLeft` 左右各 10px 叠成 20px。
	 * 底部单独留 10px：滚到底时与左右留白量级一致（unset 时底边为 0，会贴星标栏）。
	 */
  :deep(.tabContent) {
    box-sizing: border-box;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 0;
  }

  @media screen and (max-width: 768px) {
    display: flex;
    flex-direction: column-reverse;

    :deep(.tabContent) {
      display: flex;
      flex-direction: column;
    }
  }
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter {
  transform: translateX(-100%);
}

.slide-leave-to {
  transform: translateX(100%);
}
</style>
