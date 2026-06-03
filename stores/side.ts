// stores/side.ts — 侧栏展示态；数据加载与 hgame 对称逻辑在 homeData（gameTypeListData）
import { defineStore } from "pinia"

export const useSideStore = defineStore("side", () => {
	const sideList = ref<unknown[]>([])
	const firstId = ref<string | null>(null)
	const loading = ref(false)
	const error = ref<unknown>(null)

	return {
		sideList,
		firstId,
		loading,
		error
	}
})
