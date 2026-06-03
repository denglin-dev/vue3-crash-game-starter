// composables/useScrollPrevent.ts
import { ref } from 'vue'

interface ScrollPreventOptions {
  /**
   * 是否启用（默认为 true）
   */
  enabled?: boolean
  /**
   * 是否仅在移动端生效（默认为 true）
   */
  mobileOnly?: boolean
  /**
   * 自定义判断是否允许滚动的回调
   */
  shouldPrevent?: (event: TouchEvent, element: HTMLElement) => boolean
}

/**
 * 防止滚动穿透的 composable
 * 用于处理移动端弹窗、抽屉等组件内的滚动事件
 */
export function useScrollPrevent(options: ScrollPreventOptions = {}) {
  const {
    enabled = true,
    mobileOnly = true,
    shouldPrevent
  } = options

  const startY = ref(0)
  const { deviceAdvanced } = useDeviceAdvanced()

  /**
   * 处理触摸开始事件
   */
  const handleTouchStart = (event: TouchEvent) => {
    if (!enabled) return
    if (mobileOnly && deviceAdvanced.value !== 'mobile') return
    
    startY.value = event.touches[0].clientY
  }

  /**
   * 处理触摸移动事件
   */
  const handleTouchMove = (event: TouchEvent) => {
    if (!enabled) return
    if (mobileOnly && deviceAdvanced.value !== 'mobile') return

    const targetElement = event.currentTarget as HTMLElement

    // 如果提供了自定义判断函数，优先使用
    if (shouldPrevent) {
      if (shouldPrevent(event, targetElement)) {
        event.stopPropagation()
        event.preventDefault()
      }
      return
    }

    // 默认逻辑
    const scrollHeight = targetElement.scrollHeight
    const clientHeight = targetElement.clientHeight
    const scrollTop = targetElement.scrollTop

    // 如果内容高度小于等于容器高度，没有滚动空间，阻止事件冒泡
    if (scrollHeight <= clientHeight) {
      event.stopPropagation()
      event.preventDefault()
      return
    }

    // 检测是否在边界
    const isAtTop = scrollTop <= 0
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1
    const currentY = event.touches[0].clientY
    const isScrollingUp = currentY > startY.value
    const isScrollingDown = currentY < startY.value

    // 在顶部继续向上滑动，或在底部继续向下滑动，阻止事件
    if ((isAtTop && isScrollingUp) || (isAtBottom && isScrollingDown)) {
      event.stopPropagation()
      event.preventDefault()
    }
  }

  return {
    startY,
    handleTouchStart,
    handleTouchMove
  }
}
