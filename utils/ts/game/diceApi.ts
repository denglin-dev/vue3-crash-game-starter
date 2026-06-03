import { useAxiosServer } from "~/composables/axiosServer"

// ===== Dice 游戏 API =====
export const useDiceApi = () => {
  const AxiosServer = useAxiosServer()
  return {
    // 下注
    bet: (params) => {
      // AxiosServer("/cybet/bet/dice", params, callback, "POST", false, true)
      return new Promise((resolve, reject) => {
        AxiosServer(
          '/cybet/bet/dice',
          params,
          (res) => {
            if (res) resolve(res.result)
            else reject(new Error(res?.msg))
          },
          'POST',
          false,
          true
        )
      })
    },

    // 获取游戏历史
    getHistory: (params = {}) => {
      return new Promise((resolve, reject) => {
        AxiosServer(
          '/cybet/history',
          params,
          (res) => {
            if (res) resolve(res.result)
            else reject(new Error(res?.msg))
          },
          'POST',
          false,
          true
        )
      })
    }
  }
}

