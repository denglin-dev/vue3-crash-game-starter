// pages/newGame/common/composables/useAutoBet.ts
import { ref } from 'vue'

// 记录 auto 模式的公共状态
export const autoData = ref({
  winMoney: 0, // 每次派奖金额
})

// 自动下注派彩计时器
export const winMoneyTime = () => {
  setTimeout(() => {
    autoData.value.winMoney = 0
  }, 3000)
}

// 更新倍数 - 公共方法
export const handleCarshUpdataDouble = () => {
  if (!import.meta.client) return
    ; (window as any)["carshUpdataDouble"] = () => {
      // 热路径：勿 console（开 F12 时倍数每帧更新会严重卡顿）
    }
}
