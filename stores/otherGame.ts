import { defineStore } from "pinia"

export const useGameStore = defineStore("game", {
	state: () => ({
		gameData: {
			id: "",
			channel: "",
			currency: "",
			gameCode: "",
			gameName: "",
			imgUrl: ""
		}
	}),
	actions: {
		setGameData(data: Record<string, any>) {
			this.gameData = data
		},
		clearGameData() {
			this.gameData = null
		}
	}
})
