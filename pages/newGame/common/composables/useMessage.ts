import { MessageService } from "~/utils/MessageService"

/**
 * 注意：`useI18n()` 只能在组件的 setup 顶层调用。
 * 这里的错误提示可能在请求/工具函数中被调用，因此改用 NuxtApp 注入的 i18n 实例获取 t。
 */
function getT() {
    // Nuxt3 自动注入（在非 setup 场景也可调用），这里不直接 import "#app" 避免 TS 找不到模块
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nuxtApp = (globalThis as any).useNuxtApp?.()
    const i18n = (nuxtApp as any).$i18n
    const t = i18n?.t
    return typeof t === "function" ? t.bind(i18n) : ((key: string) => key)
}

/**
 * 游戏相关错误提示
 * 根据后端返回的错误码显示对应的警告信息
 * @param data - 后端返回的数据对象，包含 is_suc 错误码
 */
export const gameMessages = (data: any) => {
    const t = getT()
    const code = data.is_suc || data.code
    switch (code) {
        case 1001:
        // 1001：游戏 ID 不存在（前端传入 game_id 错误/后端未配置该游戏）
        case 6001:
        // 6001：投注金额不符合规则（超出最小/最大、精度不合法、或不在可下注范围）
        case 1006:
        // 1006：未找到用户（token 失效/用户不存在）
        case 4001:
        // 4001：玩家限制超出（投注/游戏限制，例如地区、等级、风控限制等）
        case 5001:
        // 5001：玩家自我排除限制（Self Exclusion 期间不可游戏/不可下注）
        case 1007:
        // 1007：投注已存在（重复下注/同一局重复提交）
        case 1005:
            // 1005：余额不足
            MessageService.warning(data.msg || data.message)
            break;
        /**以下是 游戏方的错误码 *******************************************************/
        case 2099:
            // 2099：无效的请求方法（接口要求 POST）
            MessageService.warning(t("game.messages.invalidRequestMethodPostRequired"))
            break;
        case 2098:
            // 2098：服务器内部错误（服务端异常）
            MessageService.warning(t("game.messages.internalServerError"))
            break;
        case 2000:
            // 2000：缺少必要参数（token、bet 等）
            MessageService.warning(t("game.messages.missingRequiredParameters"))
            break;
        case 2001:
            // 2001：Limbo 游戏倍数超范围（必须在 1.01～9900）
            MessageService.warning(t("game.messages.limboMultiplierRange"))
            break;
        case 2002:
            // 2002：自营游戏投注金额无效（金额/精度/范围不合法）
            MessageService.warning(t("game.messages.invalidInHouseBetAmount"))
            break;
        case 2003:
            // 2003：Dice 数字无效（范围：1～9800）
            MessageService.warning(t("game.messages.invalidDiceNumberRange1_9800"))
            break;
        case 2004:
            // 2004：Dice 数字无效（范围：200～9999）
            MessageService.warning(t("game.messages.invalidDiceNumberRange200_9999"))
            break;
        case 2005:
            // 2005：Dice 参数 under_over 无效（仅允许：0、1、2）
            MessageService.warning(t("game.messages.invalidDiceUnderOver"))
            break;
        case 2010:
            // 2010：获取历史记录过于频繁（同一账户需间隔 2 秒）
            MessageService.warning(t("game.messages.historyRateLimit"))
            break;
        case 2011:
            // 2011：获取历史记录时 Token 验证失败（登录态失效/签名不通过）
            MessageService.warning(t("game.messages.historyTokenValidationFailed"))
            break;
        case 2012:
            // 2012：游戏 ID 无效（必须为数字）
            MessageService.warning(t("game.messages.invalidGameIdNumeric"))
            break;
        case 2999:
            // 2999：HTTP 状态码错误（常见为 404；可能是路由/接口路径配置错误）
            MessageService.warning(t("game.messages.httpStatus404"))
            break
        case 2050:
            // 2050：会话异常（例如会话过期、房间状态不同步、或需要重新进入房间）
            MessageService.warning(t("game.messages.sessionException"))
            break
        case 2051:
            // 2051：非下注阶段（当前不允许下注/取消等操作）
            MessageService.warning(t("game.messages.notInBettingPhase"))
            break
        case 2052:
            // 2052：金额非法（金额格式/范围/精度不合法）
            MessageService.warning(t("game.messages.invalidAmount"))
            break
        case 2053:
            // 2053：本局已下过注（同一局不能重复下注）
            MessageService.warning(t("game.messages.alreadyBetThisRound"))
            break
        case 2054:
            // 2054：非飞行阶段（仅飞行阶段允许兑现 cashout 等操作）
            MessageService.warning(t("game.messages.notInFlyingPhase"))
            break
        case 2055:
            // 2055：无有效下注或已兑现（无可兑现的注单）
            MessageService.warning(t("game.messages.noValidBetOrAlreadyCashedOut"))
            break
        case 2056:
            // 2056：按服务端计算已触达或超过爆点，无法兑现（crash 已发生或已到达爆点）
            MessageService.warning(t("game.messages.cannotCashoutReachedOrExceededCrashPoint"))
            break
        case 2022:
            // 2022：网格参数错误（grid_num 不合法；常用于 mines 等需要格子数量的游戏）
            MessageService.warning(t("game.messages.gridNumError"))
            break
        case 2080:
            // 2080：存在未结束对局，不允许修改种子（公平性/种子修改需在无进行中回合时）
            MessageService.warning(t("game.messages.unfinishedRoundCannotChangeSeed"))
            break
        case 2024:   //mines在爆炸后 在点击 取消提示
        case 2027:   //mines点击已经翻开的格子
            break
        case 2014:
            //新版游戏更新后对旧数据查询公平性的提示
            MessageService.warning(t("game.messages.historicalDataArchivedForFairness"))
            break
        case 2041:
        case 2042:
            // 2041：金额为 0 时下注过于频繁（服务端限流）
            MessageService.warning(t("game.messages.zeroBetTooFrequent"))
            break
        default:
            // 未收录/未知错误码：统一兜底提示，避免静默
            MessageService.warning(t("game.messages.unknownError"))
            break
    }
}