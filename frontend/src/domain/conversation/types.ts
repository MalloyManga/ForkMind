import {
    NODE_STATUS_DONE,
    NODE_STATUS_ERROR,
    NODE_STATUS_IDLE,
    NODE_STATUS_STREAMING,
} from "./constants"

// 对话节点状态(卡片状态)
export type ConversationNodeStatus =
    | typeof NODE_STATUS_IDLE
    | typeof NODE_STATUS_STREAMING
    | typeof NODE_STATUS_DONE
    | typeof NODE_STATUS_ERROR

// 卡片画布坐标
export interface ConversationCardPosition {
    x: number
    y: number
}

/**
 * 卡片尺寸策略
 * - auto: 高度随 Markdown 内容增长 宽度使用预设值
 * - fixed: 手动调整宽高
 */
export type ConversationCardSizingMode = "auto" | "fixed"

/**
 * 卡片宽高
 */
export interface ConversationCardSize {
    mode: ConversationCardSizingMode
    width: number
    minHeight: number
}

/**
 * 可被编辑器或画布 Markdown 选区引用的业务文本字段
 */
export type ConversationTextField = "userPrompt" | "aiResponse" | "noteContent"

/**
 * 子 Chat 对源卡片文本选区的稳定引用
 * editor 来源保留精确 offset canvas 来源只保证 quote 快照可复现
 */
export interface ConversationTextAnchor {
    sourceNodeId: string
    field: ConversationTextField
    quote: string
    startOffset: number | null
    endOffset: number | null
    origin: "editor" | "canvas"
}

/**
 * 全局唯一卡片类型源
 * key->NodeType value: Node obj interface
 */
interface CardNodeRegistry {
    "chat": ChatNode
    "note": NoteNode
}

/**
 * NodeType节点类型
 */
export type ConversationNodeType = keyof CardNodeRegistry

/**
 * BaseNode 所有节点共享字段
 */
export interface BaseNode {
    id: string
    cardType: ConversationNodeType // 限制子节点type
    // 当前版本只使用单父链路构造上下文（可预测、可复现）。
    parentId: string | null
    /**
     * 未来预留：跨分支“参考关联”节点集合（不参与主链向上遍历）。
     * 主链继续使用 parentId；参考节点在提示词里作为“补充参考资料”注入。
     */
    referenceNodeIds?: string[]
    // 用户基于某段文本创建追问时 子节点保存该选区快照
    sourceAnchor?: ConversationTextAnchor
    // 画布布局数据：卡片渲染依赖此字段 不依赖数组顺序
    position: ConversationCardPosition
    size: ConversationCardSize
    status: ConversationNodeStatus
    createdAt: string
    updatedAt: string
}

/**
 * ChatNode AI 对话节点
 */
export interface ChatNode extends BaseNode {
    cardType: "chat"
    userPrompt: string
    aiResponse: string
}

/**
 * NoteNode：纯笔记节点
 */
export interface NoteNode extends BaseNode {
    cardType: "note"
    noteContent: string
}

/**
 * 节点类型接口对象集合
 */
export type ConversationCard = CardNodeRegistry[ConversationNodeType]

// 一个对话(画布) 内部持有多张卡片
export interface ConversationThread {
    id: string
    title: string
    cards: ConversationCard[]
    createdAt: string
    updatedAt: string
}
