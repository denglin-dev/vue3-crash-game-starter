import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { useRouter } from "vue-router"
import {
	changeLoginStatus,
	loginStatus,
	unReadNumber,
	userInfo
} from "~/utils/hook/hook"
import { login } from "~/utils/ts/api"
import { getSimpleFingerprint } from "~/utils/fingerprint/index"
import { useDeviceAdvanced } from "~/composables/useDeviceAdvanced"

export type ProfileMenuGroup = {
	id: string
	show?: boolean
	items: ProfileMenuItem[]
}

export type ProfileMenuItem = {
	icon: string
	text: string
	action: () => void
	badge?: boolean
	activeKey?: string
}

export function useProfileMenuActions(options?: { onAfterMenuAction?: () => void }) {
	const { t: $t } = useI18n()
	const router = useRouter()
	const bus = useEventBus()
	const { deviceAdvanced } = useDeviceAdvanced()

	const runMenuAction = (action: () => void) => {
		action()
		options?.onAfterMenuAction?.()
	}

	const goNotify = () => {
		bus.emit("openGlobalDialog", {
			type: "mobileNotifications"
		})
	}

	const goProfile = (val: string) => {
		router.push({ path: "/profile", query: { type: val } })
		bus.emit("openProfile", val)
	}

	const changeServiceBox = async () => {
		const ready = await ensureZendeskSnippet()
		if (!ready || typeof window.zE !== "function") return
		const userId = loginStatus.value ? userInfo.value.id : "Not logged in"
		window.zE("messenger:set", "conversationFields", [{ id: "49573748313241", value: userId }], () => {})
		window.zE("messenger", "show")
		window.zE("messenger", "open")
	}

	const clearThirdId = () => {
		localStorage.removeItem("tothirdAPI")
		if (localStorage.getItem("googleId")) {
			localStorage.removeItem("googleId")
			return
		}
		if (localStorage.getItem("twitchId")) {
			localStorage.removeItem("twitchId")
			return
		}
		if (localStorage.getItem("facebookId")) {
			localStorage.removeItem("facebookId")
		}
	}

	const logOut = async () => {
		const result = await getSimpleFingerprint()
		changeLoginStatus(false)
		router.push("/")
		login.userOnClose(
			{ deviceCode: result.fingerprintHash, deviceInfo: JSON.stringify(result.details) },
			() => {
				MessageService.success($t("success.Exit"))
				clearThirdId()
				useStorage().clear()
				useCookie("stag").value = ""
				sessionStorage.removeItem("Game_User_Token")
			}
		)
	}

	const menuGroups = computed<ProfileMenuGroup[]>(() => [
		{
			id: "notification",
			show: deviceAdvanced.value === "mobile",
			items: [
				{
					icon: "/img/newHeader/message.svg",
					text: $t("main.notify"),
					badge: true,
					action: () => goNotify()
				}
			]
		},
		{
			id: "profile",
			items: [
				{
					icon: "/img/Profile/header/new-info/menu_1.svg",
					text: $t("login.account"),
					activeKey: "account",
					action: () => goProfile("account")
				},
				{
					icon: "/img/Profile/header/new-info/menu_2.svg",
					text: $t("Profile.Security"),
					activeKey: "security",
					action: () => goProfile("security")
				},
				{
					icon: "/img/Profile/header/new-info/menu_3.svg",
					text: $t("components.Redeem"),
					activeKey: "redeem",
					action: () =>
						bus.emit("openNewGlobalDialog", {
							type: "WalletIndex",
							params: { type: 3 }
						})
				},
				{
					icon: "/img/Profile/header/new-info/menu_4.svg",
					text: $t("Profile.Transactions"),
					activeKey: "transactions",
					action: () => goProfile("transactions")
				},
				{
					icon: "/img/Profile/header/new-info/menu_5.svg",
					text: $t("Profile.GameHistory"),
					activeKey: "history",
					action: () => goProfile("history")
				},
				{
					icon: "/img/Profile/header/new-info/menu_6.svg",
					text: $t("Profile.CustomerService"),
					activeKey: "customer-service",
					action: () => changeServiceBox()
				}
			]
		},
		{
			id: "logout",
			items: [
				{
					icon: "/img/Profile/header/new-info/menu_7.svg",
					text: $t("main.logout"),
					action: () => logOut()
				}
			]
		}
	])

	const handleMenuAction = (action: () => void) => {
		runMenuAction(action)
	}

	return {
		menuGroups,
		handleMenuAction,
		goProfile,
		goNotify,
		unReadNumber
	}
}
