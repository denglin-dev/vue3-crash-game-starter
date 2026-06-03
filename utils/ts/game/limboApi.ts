import { useAxiosServer } from "~/composables/axiosServer"

// ===== Limbo 游戏 API =====
export const useLimboApi = () => {
  const AxiosServer = useAxiosServer()
  return {
    // 下注
    bet: (params: {}) => {
      return new Promise((resolve, reject) => {
        AxiosServer(
          '/cybet/bet/limbo',
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
