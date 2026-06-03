/**
 * Crash WebSocket 握手 URL（鉴权 query）公共构造。
 *
 * 业务上拆成两条 TCP 连接时：
 * - **房间主链路**：join / room_state / flying_tick / bet / cashout / kick 等（默认端口 26581）
 * - **玩家广播专线**：仅 `s2c_broadcast_player_bet` 与 `s2c_broadcast_player_cashout`（默认端口 26582）
 *
 * 两条线 **鉴权规则相同**（登录 `Game_User_Token`；游客 `guest=1` + `Crash_Temporary_Token`），
 * 仅网关端口不同；具体 host/端口可通过环境变量覆盖，便于联调/部署。
 */

import { loginStatus } from "~/utils/hook/hook"

/** 默认与现有联调环境一致；部署时可在 `.env` 中覆盖 */
function crashWsHost(): string {
  const config = useRuntimeConfig()
  return config.public.crashWsUrl as string
}

/** 房间主链路端口（`defaultCrashWsUrl` 使用） */
export const CRASH_WS_PORT_ROOM = (() => {
  const n = Number(import.meta.env.VITE_CRASH_WS_PORT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 26581
})()

/** 玩家下注/兑现广播专线端口（`defaultCrashWsBroadcastUrl` 使用） */
export const CRASH_WS_PORT_BROADCAST = (() => {
  const n = Number(import.meta.env.VITE_CRASH_WS_BROADCAST_PORT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 26582
})()

/**
 * 按当前登录态从 `sessionStorage` 读取票据，拼出带鉴权 query 的 `ws://` URL。
 * 每次调用都会重新读 token（自动重连前 `CrashWsClient` 会再次调用），避免过期票据。
 */
export function buildCrashWsSessionUrl(port: number): string {
  if (import.meta.dev) {
    const host = crashWsHost()
    //开发环境
    if (loginStatus.value) {
      const token = sessionStorage.getItem("Game_User_Token")
      return `ws://${host}:${port}?token=${encodeURIComponent(token || "")}`
    }
    const sticket = sessionStorage.getItem("Crash_Temporary_Token")
    return `ws://${host}:${port}?guest=1&sticket=${sticket}`
  } else {
    const host = window.location.hostname
    //生产环境
    if (loginStatus.value) {
      const token = sessionStorage.getItem("Game_User_Token")
      return `wss://${host}/ws/${port}?token=${encodeURIComponent(token || "")}`
    }
    const sticket = sessionStorage.getItem("Crash_Temporary_Token")
    return `wss://${host}/ws/${port}?guest=1&sticket=${sticket}`
  }

}
