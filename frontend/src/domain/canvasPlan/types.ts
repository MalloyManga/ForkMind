import type {
    ChatNode,
    FileNode,
    ImageNode,
    LinkNode,
    NoteNode,
} from "../conversation/types"

/**
 * AI 画布提案中每种卡片允许出现的内容字段
 * interface 作为 cardType 到 content 的唯一映射源 映射类型会据此生成判别联合
 */
export interface CanvasPlanContentMap {
    chat: Pick<ChatNode, "userPrompt" | "aiResponse">
    note: Pick<NoteNode, "noteContent">
    image: Pick<ImageNode, "caption" | "altText">
    link: Pick<LinkNode, "url" | "title" | "description">
    file: Pick<FileNode, "description">
}

export type CanvasPlanCardType = keyof CanvasPlanContentMap

interface CanvasPlanNodeRelationFields {
    tempId: string
    parentTempId: string | null
    referenceTempIds: string[]
}

/**
 * 根据 CanvasPlanContentMap 生成 cardType content 同步收窄的判别联合
 * 新增卡片类型时 TypeScript 会要求映射表 Parser 和 Store switch 同时补齐
 */
export type CanvasPlanNode = {
    [CardType in CanvasPlanCardType]: CanvasPlanNodeRelationFields & {
        cardType: CardType
        content: CanvasPlanContentMap[CardType]
    }
}[CanvasPlanCardType]

export interface CanvasPlan {
    nodes: CanvasPlanNode[]
}

export interface PendingCanvasPlan {
    requestId: string
    threadId: string
    sourceNodeId: string
    schemaVersion: 1
    plan: CanvasPlan
}
