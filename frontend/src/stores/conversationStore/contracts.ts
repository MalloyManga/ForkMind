import type {
    ConversationCard,
    ConversationCardPosition,
    ConversationCardSize,
    ConversationNodeType,
    ConversationThread,
} from "../../domain/conversation/types"

/**
 * 按节点 type 从 ConversationCard 联合类型中取出具体节点 接口对象
 * NodeByType<"note">
 */
type NodeByType<T extends ConversationNodeType> = Extract<ConversationCard, { type: T }>

/**
 * 创建节点时由 Store 负责生成的身份字段
 * copy paste fork 手动创建都不能复用旧节点 id 和时间戳
 */
type StoreGeneratedNodeKeys = "id" | "createdAt" | "updatedAt"

/**
 * 对联合类型逐个成员执行 Omit
 * K 必须为合法的对象 key
 * T extends unknown 自动遍历 T(联合类型) 同时永远为 true
 * 从 T 接口当中删去 K(key) 字段
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, Extract<keyof T, K>> : never

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
    [T in ConversationNodeType]: AddNodeDraftInput<T> & { type: T }
}[ConversationNodeType]

/**
 * 剪贴板里存放的节点内容快照
 * copy paste 和 paste to replace 保存旧节点内容和关系 但粘贴时必须重新计算 position
 * parentId 先保留 后续粘贴时由业务逻辑判断目标画布是否存在该父节点
 * ConversationCard 的所有类型删去 StoreGeneratedNodeKeys | "position" 再联合
 */
export type ClipboardNodeInput = DistributiveOmit<ConversationCard, StoreGeneratedNodeKeys | "position">

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
 * Store 状态与行为定义
 * 组件层应只依赖这些语义化方法 不直接拼装底层节点数组
 */
export interface ConversationStoreState {
    activeThread: ConversationThread
    activeNodeId: string | null
    pastSnapshots: ConversationSnapshot[]
    futureSnapshots: ConversationSnapshot[]

    setActiveThread: (thread: ConversationThread) => void
    setActiveNodeId: (nodeId: string | null) => void
    setActiveThreadCards: (cards: ConversationCard[]) => void

    addNode: (input: AddConversationNodeDraftInput) => string
    addChatNode: (input?: AddNodeDraftInput<"chat">) => string
    addNoteNode: (input?: AddNodeDraftInput<"note">) => string
    forkChatNode: (input: ForkChatNodeInput) => string | null
    forkNoteNode: (input: ForkNoteNodeInput) => string | null

    updateChatPrompt: (nodeId: string, userPrompt: string) => void
    updateChatResponse: (nodeId: string, aiResponse: string) => void
    updateNoteContent: (nodeId: string, noteContent: string) => void
    replaceNodeFromClipboard: (nodeId: string, clipboardNode: ClipboardNodeInput) => void

    moveNode: (nodeId: string, nextPosition: ConversationCardPosition) => void
    setNodeParent: (nodeId: string, parentId: string | null) => void
    setNodeReferences: (nodeId: string, referenceNodeIds: string[]) => void

    deleteNodes: (nodeIds: string[]) => void

    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
}
