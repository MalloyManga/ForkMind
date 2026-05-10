import { assertNever } from "@/lib/utils"
import type { BaseNode, ConversationCard } from "./types"

/**
 * 克隆一张业务卡片
 * card 是当前 Store 中已经存在的节点对象
 * 返回字段值一致但 position size referenceNodeIds 都是已断开引用的新节点对象
 */
export function cloneConversationCard(card: ConversationCard): ConversationCard {
    const clonedBaseNode: BaseNode = {
        ...card,
        position: { ...card.position },
        size: { ...card.size },
        referenceNodeIds: card.referenceNodeIds ? [...card.referenceNodeIds] : undefined,
    }

    switch (card.cardType) {
        case "chat":
            return {
                ...clonedBaseNode,
                cardType: "chat",
                userPrompt: card.userPrompt,
                aiResponse: card.aiResponse,
            }
        case "note":
            return {
                ...clonedBaseNode,
                cardType: "note",
                noteContent: card.noteContent,
            }
    }

    return assertNever(card)
}
