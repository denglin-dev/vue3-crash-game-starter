type AxiosServerFn = (
	url: string,
	sendData: any,
	callback: Function,
	type?: string,
	isUpload?: boolean,
	isGame?: boolean,
	showMessage?: boolean
) => Promise<void>

export const useAxiosServer = (): AxiosServerFn => {
	const { $axiosServer } = useNuxtApp()
	return $axiosServer as AxiosServerFn
}
