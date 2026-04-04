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
 * 卡片尺寸策略：
 * - auto: 高度随 Markdown 内容增长，宽度使用预设值。
 * - fixed: 用户手动调整宽高（后续阶段可接入）。
 */
export type ConversationCardSizingMode = "auto" | "fixed"

export interface ConversationCardSize {
    mode: ConversationCardSizingMode
    width: number
    minHeight: number
}

// NodeType节点类型：目前支持 chat / note，后续可扩展 image / file / code。
export type ConversationNodeType = "chat" | "note"

/**
 * BaseNode：所有节点共享字段。
 * 这里是扩展的核心锚点，后续新类型节点统一从这里继承。
 */
export interface BaseNode {
    id: string
    type: ConversationNodeType // 限制子节点type
    // 当前版本只使用单父链路构造上下文（可预测、可复现）。
    parentId: string | null
    /**
     * 未来预留：跨分支“参考关联”节点集合（不参与主链向上遍历）。
     * 主链继续使用 parentId；参考节点在提示词里作为“补充参考资料”注入。
     */
    referenceNodeIds?: string[]
    // 画布布局数据：卡片渲染依赖此字段 不依赖数组顺序
    position: ConversationCardPosition
    size: ConversationCardSize
    status: ConversationNodeStatus
    createdAt: string
    updatedAt: string
}

/**
 * ChatNode：AI 对话节点。
 * 右侧栏表现为“上输入、下输出”双 Markdown 编辑区。
 */
export interface ChatNode extends BaseNode {
    type: "chat"
    userPrompt: string
    aiResponse: string
}

/**
 * NoteNode：纯笔记节点。
 * 右侧栏只展示一个 Markdown 编辑区。
 */
export interface NoteNode extends BaseNode {
    type: "note"
    noteContent: string
}

// 兼容已有命名：ConversationCard 现在是可扩展联合类型。
export type ConversationCard = ChatNode | NoteNode

// 一个对话(画布) 内部持有多张卡片
export interface ConversationThread {
    id: string
    title: string
    cards: ConversationCard[]
}
