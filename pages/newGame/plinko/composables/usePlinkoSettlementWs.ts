/**
 * Plinko 弹珠落槽后通知服务端（WebSocket）。
 * type 需与后端约定；若后端暂未处理，可忽略或扩展 switch。
 */
import { sendMsg, isNotificationWebSocketReady } from '~/utils/ts/notificationWs'

/** 与 notificationWs 入站协议区分：出站「Plinko 落槽确认」 */
const WS_TYPE_PLINKO_BALL_LANDED = 9527

export type PlinkoSettlementPayload = {
	/** 局 id，与 HTTP bet 返回一致 */
	bet_id?: string
	round_id?: string
	bin_index: number
	multiplier: number
	/** 游戏配置 id */
	game_code?: string
	/** 原始派彩（微单位或接口原样），可选 */
	payout?: number
}

export function sendPlinkoBallLandedWs(payload: PlinkoSettlementPayload) {
	if (!import.meta.client) return
	if (!isNotificationWebSocketReady()) {
		console.warn('[Plinko] notification WS not open, skip ball landed ack (9527)', payload.bet_id ?? payload.round_id)
		return
	}
	try {
		sendMsg({
			type: WS_TYPE_PLINKO_BALL_LANDED,
			data: {
				betIds: [payload.bet_id ?? payload.round_id],
				// game_code: payload.game_code ?? '10002',
				// bet_id: payload.bet_id ?? payload.round_id,
				// round_id: payload.round_id ?? payload.bet_id,
				// bin_index: payload.bin_index,
				// multiplier: payload.multiplier,
				// payout: payload.payout
			}
		})
	} catch (e) {
		console.warn('[Plinko] settlement ws send failed', e)
	}
}
