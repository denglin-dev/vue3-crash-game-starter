import { getSimpleFingerprint } from "~/utils/fingerprint/index"

type FingerprintResult = NonNullable<Awaited<ReturnType<typeof getSimpleFingerprint>>>

let cached: FingerprintResult | null = null

/** 仅在改密 / 2FA / 踢设备等敏感操作前调用，避免进入安全页即采集指纹 */
export const ensureSecurityFingerprint = async (): Promise<FingerprintResult> => {
	if (!import.meta.client) {
		throw new Error("Security fingerprint is only available on the client")
	}
	if (cached) {
		return cached
	}
	const fp = await getSimpleFingerprint()
	if (!fp?.fingerprintHash) {
		throw new Error("Failed to resolve device fingerprint")
	}
	cached = fp
	return fp
}

