import { mainContent } from "~/utils/ts/api"
import { ssrMainContent, ssrUserApi } from "~/utils/ts/ssrApi"
import {
	HOME_HGAME_LIST_REQUEST,
	normalizeMegaWinsList,
	useHomeDataStore,
	type HomeBannerItem,
	type HomeGameModuleListData,
	type HomeGameModuleProviderData
} from "~/stores/homeData"
import { useSideStore } from "~/stores/side"
import { useHomeChatStore, type HomeChatMessage } from "~/stores/homeChat"
import { buildGetChatListBody } from "~/utils/fingerprint/ssrDeviceFingerprint"
import {
	HOME_INDEX_SSR_API_IDS,
	type HomeIndexSsrApiId
} from "~/server/utils/homeIndexSsrManifest"
import {
	isHomeSsrPayloadUsable,
	type HomeSsrCachedPayload
} from "~/server/utils/homeSsrCachePayload"
const INDEX_GAME_PROVIDER_PARAMS = {
	pageSize: 20,
	pageNum: 1
}

export type HomeIndexSsrPayload = {
	sidebar: unknown[]
	banner: HomeBannerItem[]
	megaWins: unknown[]
	gameModuleList: HomeGameModuleListData | null
	gameModuleProvider: HomeGameModuleProviderData | null
	chatList: HomeChatMessage[]
}

const unwrapData = <T>(res: { data?: T } | T | null): T | null => {
	if (res == null) return null
	if (typeof res === "object" && "data" in (res as object)) {
		return (res as { data?: T }).data ?? null
	}
	return res as T
}

const isHomeIndexPayloadUsable = (payload: HomeIndexSsrPayload | null | undefined) => {
	if (!payload) return false
	return isHomeSsrPayloadUsable(
		{
			sidebar: payload.sidebar,
			banner: payload.banner,
			megaWins: payload.megaWins,
			gameModuleList: payload.gameModuleList,
			gameModuleProvider: payload.gameModuleProvider,
			chatList: payload.chatList
		},
		HOME_INDEX_SSR_API_IDS
	)
}

const cachedPayloadToHomeIndex = (
	cached: HomeSsrCachedPayload
): HomeIndexSsrPayload => ({
	sidebar: Array.isArray(cached.sidebar) ? cached.sidebar : [],
	banner: Array.isArray(cached.banner) ? cached.banner : [],
	megaWins: Array.isArray(cached.megaWins) ? cached.megaWins : [],
	gameModuleList: cached.gameModuleList ?? null,
	gameModuleProvider: cached.gameModuleProvider ?? null,
	chatList: Array.isArray(cached.chatList) ? cached.chatList : []
})

/** 浏览器与 hgame 一致走 mainContent；SSR Node 走 ssrMainContent */
const fetchGameTypeAllForHome = async (): Promise<unknown[]> => {
	if (import.meta.client) {
		const raw = await mainContent.gameTypeAll()
		return Array.isArray(raw) ? raw : []
	}
	const res = await ssrMainContent.gameTypeAll({ t: Date.now() })
	const raw = unwrapData<unknown[]>(res)
	return Array.isArray(raw) ? raw : []
}

const fetchHgameForHome = async (): Promise<HomeGameModuleListData | null> => {
	if (import.meta.client) {
		const raw = await mainContent.getAllGameListNew({ ...HOME_HGAME_LIST_REQUEST })
		return (raw as HomeGameModuleListData) ?? null
	}
	const res = await ssrMainContent.getAllGameListNew(HOME_HGAME_LIST_REQUEST)
	return unwrapData<HomeGameModuleListData>(res)
}

/** 按接口 id 并行拉取（用于缓存未命中字段） */
export const fetchHomeSsrApis = async (
	apiIds: HomeIndexSsrApiId[]
): Promise<HomeSsrCachedPayload> => {
	const result: HomeSsrCachedPayload = {}
	const chatListBody = buildGetChatListBody()

	await Promise.all(
		apiIds.map(async (apiId) => {
			switch (apiId) {
				case "gameTypeAll": {
					result.sidebar = await fetchGameTypeAllForHome()
					break
				}
				case "selectAllActivity": {
					const res = await ssrMainContent.selectAllActivity()
					const raw = unwrapData<unknown>(res)
					result.banner = Array.isArray(raw) ? (raw as HomeBannerItem[]) : []
					break
				}
				case "getLiveVictory": {
					const res = await ssrMainContent.getLiveVictory({})
					const megaRaw = unwrapData<Record<string, unknown>[]>(res)
					result.megaWins = Array.isArray(megaRaw)
						? normalizeMegaWinsList(megaRaw)
						: []
					break
				}
				case "getAllGameListNew": {
					result.gameModuleList = await fetchHgameForHome()
					break
				}
				case "getGameProviderList": {
					const res = await ssrMainContent.getGameProviderList(
						INDEX_GAME_PROVIDER_PARAMS
					)
					result.gameModuleProvider =
						unwrapData<HomeGameModuleProviderData>(res)
					break
				}
				case "getChatList": {
					const res = await ssrUserApi.getChatList(chatListBody)
					const raw = unwrapData<HomeChatMessage[]>(res)
					result.chatList = Array.isArray(raw) ? raw : []
					break
				}
			}
		})
	)

	return result
}

const buildHomeIndexPayloadFromPinia = (): HomeIndexSsrPayload | null => {
	const sideStore = useSideStore()
	const homeData = useHomeDataStore()
	const homeChat = useHomeChatStore()

	if (
		!homeData.loaded &&
		!homeData.megaWinsLoaded &&
		!homeData.gameModuleLoaded &&
		!homeData.gameTypeLoaded
	) {
		return null
	}

	const payload: HomeIndexSsrPayload = {
		sidebar: homeData.gameTypeListData?.length
			? homeData.gameTypeListData
			: sideStore.sideList ?? [],
		banner: homeData.bannerList,
		megaWins: homeData.megaWinsList,
		gameModuleList: homeData.gameModuleListData,
		gameModuleProvider: homeData.gameModuleProviderData,
		chatList: homeChat.chatListLoaded ? homeChat.messageList : []
	}

	return isHomeIndexPayloadUsable(payload) ? payload : null
}

const fetchHomeIndexPayloadForSsr = async (): Promise<HomeIndexSsrPayload> => {
	if (!import.meta.server) {
		const fromPinia = buildHomeIndexPayloadFromPinia()
		if (fromPinia) return fromPinia
		return cachedPayloadToHomeIndex(await fetchHomeSsrApis([...HOME_INDEX_SSR_API_IDS]))
	}

	const config = useRuntimeConfig()
	const i18nLang = useCookie("i18n_language")
	const lang = i18nLang.value ?? "en_US"
	const ttlMs = Number(config.homeSsrCacheTtlMs) || 3_600_000

	if (!config.homeSsrCacheEnabled) {
		return cachedPayloadToHomeIndex(
			await fetchHomeSsrApis([...HOME_INDEX_SSR_API_IDS])
		)
	}

	const { getOrSetHomeIndexSsrCache } = await import("~/server/lib/homeSsrCache")
	const cached = await getOrSetHomeIndexSsrCache(lang, ttlMs, fetchHomeSsrApis)
	return cachedPayloadToHomeIndex(cached)
}

/** 同步 Nuxt payload，避免 getCachedData / watch 用旧 sidebar 冲掉 WS 刚拉的数据 */
export const patchHomeIndexPayloadSidebar = (sidebar: unknown[]) => {
	if (!import.meta.client) return
	const nuxtApp = useNuxtApp()
	const lang = useCookie("i18n_language").value ?? "en_US"
	const key = `home-index-${lang}`
	const slot =
		(nuxtApp.payload.data[key] as HomeIndexSsrPayload | undefined) ??
		(nuxtApp.static.data[key] as HomeIndexSsrPayload | undefined)
	if (slot && typeof slot === "object") {
		slot.sidebar = sidebar
	}
}

const applyHomeIndexSsrPayload = (payload: HomeIndexSsrPayload | null) => {
	if (!payload) return

	const homeData = useHomeDataStore()
	const sidebar = Array.isArray(payload.sidebar) ? payload.sidebar : []

	// 客户端：SSR 水合里 sidebar 为空时不要写入（常见为进程缓存了 []），否则 WS 拉对也会被冲掉
	if (import.meta.server || sidebar.length > 0) {
		homeData.hydrateGameTypeFromSsr(sidebar)
	}

	homeData.hydrateBannerFromSsr(payload.banner)
	homeData.hydrateMegaWinsFromSsr(payload.megaWins)

	if (payload.gameModuleList && payload.gameModuleProvider) {
		homeData.hydrateGameModuleFromSsr(payload.gameModuleList, payload.gameModuleProvider)
	}

	const homeChat = useHomeChatStore()
	if (payload.chatList.length > 0) {
		homeChat.hydrateChatListFromSsr(payload.chatList)
	}
}

/**
 * 首页 SSR：6 接口；大奖/聊天每次刷新拉新，其余 4 个走 1h 进程内缓存
 */
export const useHomeIndexSsr = () => {
	const i18nLang = useCookie("i18n_language")
	const clientEmptyRetried = ref(false)

	const homeIndexDataKey = () => `home-index-${i18nLang.value ?? "en_US"}`

	const asyncState = useAsyncData(
		homeIndexDataKey,
		fetchHomeIndexPayloadForSsr,
		{
			server: true,
			lazy: false,
			watch: [i18nLang],
			getCachedData: (key) => {
				const nuxtApp = useNuxtApp()
				const cached =
					nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]
				if (!isHomeIndexPayloadUsable(cached as HomeIndexSsrPayload)) {
					return undefined
				}
				return cached
			}
		}
	)

	watch(
		asyncState.data,
		(payload) => {
			applyHomeIndexSsrPayload(payload)
			if (
				import.meta.client &&
				!clientEmptyRetried.value &&
				payload &&
				!isHomeIndexPayloadUsable(payload)
			) {
				clientEmptyRetried.value = true
				void asyncState.refresh()
			}
		},
		{ immediate: true }
	)

	watch(i18nLang, () => {
		clientEmptyRetried.value = false
	})

	return asyncState
}
