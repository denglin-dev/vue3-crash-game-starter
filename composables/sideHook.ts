import { ref, computed } from "vue"
import { useRoute } from "#imports"
import Storage from "~/utils/ts/storage"
import { deviceAdvanced } from "~/utils/hook/hook"
import { useLayoutStore } from "~/stores/layout"
import { switchAppLanguage } from "~/utils/switchAppLanguage"

// 接口定义
export interface ResponseData {
	success: boolean
	message: string
	code: number
	data: any
	timestamp: number
}

export interface sideType {
	id: string
	typeName: string
	imgUrl: string
	parentId: string
	children: sideTypeChildren[]
}

export interface sideTypeChildren {
	id: string
	typeName: string
	imgUrl: string
	parentId: string
	children: any[]
}

export const useLayoutState = () => {
	const router = useRoute()
	const layoutStore = useLayoutStore()

	// ========= 侧边栏控制 =========
	const mobileSideStatus = ref(true)
	const leftIsClose = ref(false)
	const rightIsClose = ref(false)

	const changeMobileSideStatus = () => {
		mobileSideStatus.value = !mobileSideStatus.value
	}

	const changeLeft = (bol: boolean) => {
		leftIsClose.value = bol
		if (import.meta.client) {
			const isProfilePage = false // router.path === '/profile' 可根据实际改
			const isWideScreen = window.innerWidth > 1400
			if (deviceAdvanced.value === "pc") {
				if (!isProfilePage || (isProfilePage && isWideScreen)) return
			}
			if (!leftIsClose.value) rightIsClose.value = true
		}
	}

	const changeRight = (bol: boolean) => {
		rightIsClose.value = bol
		if (import.meta.client && router) {
			const isProfilePage = router?.path === "/profile"
			const isWideScreen = window.innerWidth > 1400
			if (deviceAdvanced.value === "pc") {
				if (!isProfilePage || (isProfilePage && isWideScreen)) return
			}
			if (!rightIsClose.value) leftIsClose.value = true
		}
	}

	// ========= 菜单子项状态 =========
	const sideChildActiveId = ref("")
	if (import.meta.client) {
		const savedId = Storage.getItem("sideChildActiveId")
		if (savedId) sideChildActiveId.value = savedId
		const name = Storage.getItem("sideChildActiveName")
		layoutStore.updateSideChildActiveName(name)
	}

	const changeSideChildActiveId = (item: any) => {
		const id = item?.id || ""
		const name = item?.typeName || ""
		layoutStore.updateSideChildActiveName(name)
		layoutStore.updateSideChildActiveId(id)
	}

	// ========= 获取侧边菜单接口 =========
	const sideArray = ref<sideType[]>([])
	// ========= 多语言 =========
	const languageList = [
		{ text: "English", value: "en_US", icon: "/img/country/en_us.svg" },
		{ text: "中文", value: "zh_CN", icon: "/img/country/zhIcon.webp" },
		{ text: "Español", value: "es_ES", icon: "/img/country/esIcon.webp" },
		{ text: "Français", value: "fr_FR", icon: "/img/country/frIcon.webp" }
		// ...可继续补充
	]

	const languageId = ref("en_US")
	const languageName = ref("English")
	const languageImg = ref("")

	if (import.meta.client) {
		const savedLang = Storage.getItem("language") || "en_US"
		const match = languageList.find((item) => item.value === savedLang)
		if (match) {
			languageId.value = match.value
			languageName.value = match.text
			languageImg.value = match.icon
		}
	}

	const showLanguage = ref(false)
	const changeLanguage = () => {
		showLanguage.value = !showLanguage.value
	}

	const clickLang = (item: { value: string; text: string; icon: string }) => {
		if (item.value === languageId.value) {
			showLanguage.value = false
			return
		}

		languageId.value = item.value
		languageName.value = item.text
		languageImg.value = item.icon
		showLanguage.value = false

		switchAppLanguage(item)
	}

	// ========= 页面偏移等 =========
	const MainOffsetLeft = ref(0)
	const MainDistanceLeft = ref("")

	// ========= 导出 =========
	return {
		// 状态
		mobileSideStatus,
		leftIsClose,
		rightIsClose,
		sideChildActiveId: computed(() => layoutStore.sideChildActiveId),
		sideArray,
		languageId,
		languageName,
		languageList,
		languageImg,
		showLanguage,
		MainOffsetLeft,
		MainDistanceLeft,
		sideChildActiveName: computed(() => layoutStore.sideChildActiveName),
		// 方法
		changeMobileSideStatus,
		changeLeft,
		changeRight,
		changeSideChildActiveId,
		changeLanguage,
		clickLang
	}
}
