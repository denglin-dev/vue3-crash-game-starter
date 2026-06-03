/**
 * Crash 房间 Protobuf 根描述加载（`game.proto`）。
 *
 * 设计说明
 * - Nuxt/Vite 通过 `?raw` 把 `.proto` 当字符串打进 bundle，运行时 `protobuf.parse` 得到 `Root`。
 * - 使用完整 `protobufjs` 而非 `protobufjs/light`：`light` 不含 `.proto` 文本解析器（无 `parse`），无法满足本模块需求。
 * - `getCrashProtoRoot()` 单例缓存 Promise，避免重复 parse；`lookupCrashType` 供 `crashWsClient` 按消息名取 `Type` 做 encode/decode。
 *
 * 类型命名：与 `game.proto` 中 `package cybet` 一致，lookup 时使用 `cybet.<messageName>`（如 `cybet.s2c_room_state`）。
 */

import protobuf from "protobufjs"

// Nuxt/Vite：以原始文本形式引入 proto，供 `protobuf.parse` 使用
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite 的 `?raw` 在部分 tsconfig 下无类型声明
import gameProtoText from "./game.proto?raw"

/** 懒加载且只解析一次的根；并发调用 `getCrashProtoRoot` 共享同一 Promise */
let _rootPromise: Promise<protobuf.Root> | null = null

/**
 * 返回解析后的 `protobuf.Root`（全量 schema）。
 * 首次调用时异步 parse；之后复用同一实例。
 */
export function getCrashProtoRoot(): Promise<protobuf.Root> {
  if (_rootPromise) return _rootPromise
  _rootPromise = Promise.resolve().then(() => {
    const parsed = protobuf.parse(gameProtoText, { keepCase: true })
    return parsed.root
  })
  return _rootPromise
}

/**
 * 按完整类型名解析 `protobuf.Type`（用于 `Type.encode` / `Type.decode` / `verify`）。
 * @param typeName 例如 `cybet.s2c_join`、`cybet.c2s_bet`
 */
export async function lookupCrashType(typeName: string): Promise<protobuf.Type> {
  const root = await getCrashProtoRoot()
  const t = root.lookupType(typeName)
  return t as protobuf.Type
}
