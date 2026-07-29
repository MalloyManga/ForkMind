import type { ConversationCard } from "./types"

/**
 * 领域规则函数（Domain Rule）：筛出所有根节点。
 * 纯函数设计便于未来直接复用于 Zustand selector 或 Go 侧校验。
 */
export function getRootCards(cards: readonly ConversationCard[]): ConversationCard[] {
    return cards.filter((card) => card.parentId === null) // 根节点的父卡片id为null
}
