// stores/searchGame.ts

import Storage from "~/utils/ts/storage"
export const useSearchStore = defineStore("search", {
	state: () => ({
		gameTag: "",
		provider: "",
		providerName: "",
		column: "",
		gameName: "",
		gameType: ""
	}),
	actions: {
		setSearchParams(params: {
			gameTag?: string
			gameName?: string
			provider?: string
			gameType?: string
			column?: string
			providerName?: string
		}) {
			Object.entries(params).forEach(([key, value]) => {
				if (value !== "" && key in this) {
					this[key] = value
				}
			})
		},
		clearSearchParams() {
			this.gameTag = ""
			this.gameName = ""
			this.provider = ""
			this.providerName = ""
			this.column = ""
			this.gameType = ""
		},
		loadSearchParams() {
			const gameTag = Storage.getItem("gameTag")
			if (gameTag) {
				this.gameTag = Storage.getItem("gameTag")
			}
		}
	}
})
