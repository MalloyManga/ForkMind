import { ROOT_NODE_WARNING_THRESHOLD } from "./constants"
import type { ConversationCard } from "./types"

/**
 * 领域规则函数（Domain Rule）：筛出所有根节点。
 * 纯函数设计便于未来直接复用于 Zustand selector 或 Go 侧校验。
 */
export function getRootCards(cards: readonly ConversationCard[]): ConversationCard[] {
    return cards.filter((card) => card.parentId === null) // 根节点的父卡片id为null
}

/**
 * 当根节点数量过多时返回提示文案；否则返回 null。
 * UI 层只关心“是否有提示”，不用重复关心阈值判断细节。
 */
export function buildRootNodesWarningMessage(
    cards: readonly ConversationCard[],
): string | null {
    const rootCount = getRootCards(cards).length

    if (rootCount <= ROOT_NODE_WARNING_THRESHOLD) {
        return null
    }

    return `当前对话已有 ${rootCount} 个根节点，建议新开一个对话，并把需要的卡片复制过去继续整理。`
}
