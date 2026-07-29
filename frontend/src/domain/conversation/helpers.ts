import { assertNever } from "@/lib/utils"
import { DEFAULT_THREAD_TITLE, THREAD_TITLE_MAX_LENGTH } from "./constants"
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
        sourceAnchor: card.sourceAnchor ? { ...card.sourceAnchor } : undefined,
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
        case "image":
            return {
                ...clonedBaseNode,
                cardType: "image",
                asset: card.asset ? { ...card.asset } : null,
                caption: card.caption,
                altText: card.altText,
            }
        case "link":
            return {
                ...clonedBaseNode,
                cardType: "link",
                url: card.url,
                title: card.title,
                description: card.description,
            }
        case "file":
            return {
                ...clonedBaseNode,
                cardType: "file",
                asset: card.asset ? { ...card.asset } : null,
                description: card.description,
            }
    }

    return assertNever(card)
}

/**
 * 根据首次用户 Prompt 生成会话标题
 * @param prompt 入参来自当前会话第一张 chat 卡片的用户输入
 * @returns 返回单行且已限制长度的标题 空白输入返回默认标题
 * 用户第一次输入内容时触发 后续手动改名后不会再次覆盖
 */
export function deriveThreadTitleFromPrompt(prompt: string): string {
    const normalizedTitle = prompt.replace(/\s+/g, " ").trim()
    if (normalizedTitle.length === 0) {
        return DEFAULT_THREAD_TITLE
    }

    return normalizedTitle.length > THREAD_TITLE_MAX_LENGTH
        ? `${normalizedTitle.slice(0, THREAD_TITLE_MAX_LENGTH)}...`
        : normalizedTitle
}
