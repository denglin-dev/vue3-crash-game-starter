// stores/searchGame.ts
import { profileApi } from "~/utils/ts/api"

export const useVipStore = defineStore("vip", {
	state: () => ({
		levelList: []
	}),
	actions: {
		setVipLevel() {
			profileApi.levelPrivilegeList({}, (res: ResponseData) => {
				if (!res) return []
				this.levelList = res?.data ?? []
			})
		}
	}
})
