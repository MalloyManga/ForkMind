import type {
    ConversationCard,
    ConversationCardPosition,
    ConversationCardSize,
    ConversationNodeType,
    ConversationThread,
} from "../../domain/conversation/types"
export type { DistributiveOmit } from "../../types/typeUtils"
import type { DistributiveOmit } from "../../types/typeUtils"

/**
 * 按节点 type 从 ConversationCard 联合类型中取出具体节点 接口对象
 * NodeByType<"note">
 */
type NodeByType<T extends ConversationNodeType> = Extract<ConversationCard, { cardType: T }>

/**
 * 创建节点时由 Store 负责生成的身份字段
 * copy paste fork 手动创建都不能复用旧节点 id 和时间戳
 */
type StoreGeneratedNodeKeys = "id" | "createdAt" | "updatedAt"

/**
 * 单独一种 Node 类型的完整新增节点入参
 * 去除 ConversationCard 对应类型 当中的 StoreGeneratedNodeKeys 字段
 */
export type AddNodeInput<T extends ConversationNodeType> = Omit<NodeByType<T>, StoreGeneratedNodeKeys>

/**
 * 所有 Node 类型的完整新增入参联合
 */
export type AddConversationNodeInput = {
    // 借用泛型 T 及 in 的遍历 得到 AddNodeInput<...ConversationNodeType> 的联合类型
    [T in ConversationNodeType]: AddNodeInput<T>
}[ConversationNodeType]

/**
 * 单独一种新增 Node 的草稿入参(UI 提供部分字段)
 * 其余字段由 Store 默认值补齐
 */
export type AddNodeDraftInput<T extends ConversationNodeType> =
    Partial<Omit<AddNodeInput<T>, "position" | "size">> & {
        position?: Partial<ConversationCardPosition>
        size?: Partial<ConversationCardSize>
    }

/**
 * 所有 Node 类型的草稿新增入参联合
 */
export type AddConversationNodeDraftInput = {
    [T in ConversationNodeType]: AddNodeDraftInput<T> & { cardType: T }
}[ConversationNodeType]

/**
 * 多节点剪贴板里的单节点快照
 */
export type ClipboardNodeSnapshot =
    DistributiveOmit<ConversationCard, StoreGeneratedNodeKeys> & {
        originalNodeId: string
    }

/**
 * 画布剪贴板 payload
 */
export interface CanvasClipboardPayload {
    nodes: ClipboardNodeSnapshot[]
    sourceTopLeft: ConversationCardPosition // paste 时计算整体偏移量
}

/**
 * 从剪贴板粘贴 nodes 的 Store 入参
 */
export interface PasteNodesFromClipboardInput {
    payload: CanvasClipboardPayload
    pastePoint: ConversationCardPosition // 右键位置或当前视口中心
}

/**
 * Paste to replace 的 Store 入参
 */
export interface ReplaceNodesFromClipboardInput {
    payload: CanvasClipboardPayload
    targetNodeIds: string[]
}

/**
 * 从现有节点 Fork 新 chat 节点的入参
 * sourceNodeId 必填 用于确定父节点和默认偏移位置
 */
export interface ForkChatNodeInput {
    sourceNodeId: string
    userPrompt?: string
    aiResponse?: string
    referenceNodeIds?: string[]
}

/**
 * 从现有节点 Fork 新 note 节点的入参
 */
export interface ForkNoteNodeInput {
    sourceNodeId: string
    noteContent?: string
    referenceNodeIds?: string[]
}

/**
 * 历史快照 用于 undo redo
 * 同时保存 thread 和 activeNodeId 避免回滚后内容变了 但右侧编辑目标没跟着回滚
 */
export interface ConversationSnapshot {
    thread: ConversationThread
    activeNodeId: string | null
}

/**
 * 右侧编辑栏可修改的文本字段
 * 该联合类型用于把 focus blur 生命周期和具体 Store 字段绑定
 */
export type ConversationTextField = "userPrompt" | "aiResponse" | "noteContent"

/**
 * 当前连续文本编辑事务
 * hasChanges 为 false 表示已经 focus 但用户还没有真正修改内容
 */
export interface ConversationTextEditSession {
    nodeId: string
    field: ConversationTextField
    hasChanges: boolean
}

/**
 * Store 状态与行为定义
 * 组件层应只依赖这些语义化方法 不直接拼装底层节点数组
 */
export interface ConversationStoreState {
    activeThread: ConversationThread
    activeNodeId: string | null
    pastSnapshots: ConversationSnapshot[]
    futureSnapshots: ConversationSnapshot[]
    textEditSession: ConversationTextEditSession | null

    setActiveThread: (thread: ConversationThread) => void
    setActiveNodeId: (nodeId: string | null) => void
    setActiveThreadCards: (cards: ConversationCard[]) => void

    addNode: (input: AddConversationNodeDraftInput) => string
    forkChatNode: (input: ForkChatNodeInput) => string | null
    forkNoteNode: (input: ForkNoteNodeInput) => string | null

    updateChatPrompt: (nodeId: string, userPrompt: string) => void
    updateChatResponse: (nodeId: string, aiResponse: string) => void
    updateNoteContent: (nodeId: string, noteContent: string) => void
    beginTextEdit: (nodeId: string, field: ConversationTextField) => void
    endTextEdit: () => void
    pasteNodesFromClipboard: (input: PasteNodesFromClipboardInput) => string[]
    replaceNodesFromClipboard: (input: ReplaceNodesFromClipboardInput) => string[]

    moveNode: (nodeId: string, nextPosition: ConversationCardPosition) => void
    resizeNode: (nodeId: string, nextSize: ConversationCardSize) => void
    setNodeParent: (nodeId: string, parentId: string | null) => void
    setNodeReferences: (nodeId: string, referenceNodeIds: string[]) => void

    deleteNodes: (nodeIds: string[]) => void

    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
}
