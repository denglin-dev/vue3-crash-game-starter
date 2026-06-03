import { userInfo } from "~/utils/hook/hook"

/**
 * `loginStatus` 可从 storage 立即为 true，而 `userInfo.id` 需等 `getMyInfo` 回调。
 * 调需要 userId 的接口（如第三方游戏 launch）前 await 本函数，避免空 id 早退。
 */
const hydrateUserIdFromStorage = (): string | null => {
	if (!import.meta.client) return null
	const cached = useStorage().getItem("userInfo") as { id?: string } | null
	if (!cached?.id) return null
	userInfo.value = { ...userInfo.value, ...cached }
	return String(cached.id)
}

export async function waitForUserInfoId(
	maxMs = 5000,
	intervalMs = 100
): Promise<string | null> {
	if (userInfo.value?.id) return String(userInfo.value.id)

	const fromStorage = hydrateUserIdFromStorage()
	if (fromStorage) return fromStorage

	const deadline = Date.now() + maxMs
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, intervalMs))
		if (userInfo.value?.id) return String(userInfo.value.id)
		const hydrated = hydrateUserIdFromStorage()
		if (hydrated) return hydrated
	}
	return userInfo.value?.id ? String(userInfo.value.id) : null
}
