/**
 * Crash 爆炸使用独立 HTMLAudio 池，需在用户手势栈内先「静音 play」解锁（尤其 iOS）。
 * 监听器若在 `initGame` 之后才挂，用户先点侧栏/Tab 再进局会错过解锁；此处由 GameCanvas 注册，
 * 在任意 `playClickSoundOnce` 同步路径中顺带调用，与是否先点「下注」解耦。
 */
type GestureUnlockFn = () => void

let registeredUnlock: GestureUnlockFn | null = null

/** GameCanvas `onMounted` 注册，`onUnmounted` 传 `null` 释放，避免泄漏与误触其它页 */
export function registerCrashBoomPoolGestureUnlock(fn: GestureUnlockFn | null): void {
	registeredUnlock = fn
}

/** 在 `playClickSoundOnce` 内同步调用：与全局点击音同一手势栈 */
export function notifyCrashBoomPoolUserGestureIfRegistered(): void {
	registeredUnlock?.()
}
