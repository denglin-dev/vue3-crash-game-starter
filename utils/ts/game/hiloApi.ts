import { useAxiosServer } from "~/composables/axiosServer"

export const useHiloApi = () => {
	const AxiosServer = useAxiosServer()
	return {
		bet: (params: Record<string, unknown>) => {
			return new Promise((resolve, reject) => {
				AxiosServer(
					"/cybet/bet/hilo",
					params,
					(res) => {
						if (res) resolve(res.result)
						else reject(new Error(res?.msg))
					},
					"POST",
					false,
					true
				)
			})
		},

		getHistory: (params = {}) => {
			return new Promise((resolve, reject) => {
				AxiosServer(
					"/cybet/history",
					params,
					(res) => {
						if (res) resolve(res.result)
						else reject(new Error(res?.msg))
					},
					"POST",
					false,
					true
				)
			})
		}
	}
}
