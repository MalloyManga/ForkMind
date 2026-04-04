import type {
    ConversationCard,
    ConversationCardPosition,
    ConversationCardSize,
    ConversationNodeStatus,
    ConversationThread,
} from "../../domain/conversation/types"

/**
 * 新增节点的公共入参
 */
export interface AddNodeBaseInput {
    parentId?: string | null
    referenceNodeIds?: string[]
    position?: Partial<ConversationCardPosition>
    size?: Partial<ConversationCardSize>
    status?: ConversationNodeStatus
}

/**
 * 新增 chat 节点入参。
 * userPrompt/aiResponse 都是可选，便于先创建空节点再逐步编辑。
 */
export interface AddChatNodeInput extends AddNodeBaseInput {
    userPrompt?: string
    aiResponse?: string
}

/**
 * 新增 note 节点入参。
 * noteContent 可空，支持创建后再输入内容。
 */
export interface AddNoteNodeInput extends AddNodeBaseInput {
    noteContent?: string
}

/**
 * 从现有节点 Fork 新 chat 节点的入参。
 * sourceNodeId 必填，用于确定父节点与默认偏移位置。
 */
export interface ForkChatNodeInput {
    sourceNodeId: string
    userPrompt?: string
    aiResponse?: string
    referenceNodeIds?: string[]
}

/**
 * 从现有节点 Fork 新 note 节点的入参。
 * 业务场景：用户从某张卡片分叉出“补充笔记”分支，而不是 AI 对话分支。
 */
export interface ForkNoteNodeInput {
    sourceNodeId: string
    noteContent?: string
    referenceNodeIds?: string[]
}

/**
 * 历史快照：用于 undo/redo。
 * 注意这里同时保存 thread + activeNodeId，避免“内容回滚了但选中态没回滚”的不一致。
 */
export interface ConversationSnapshot {
    thread: ConversationThread
    activeNodeId: string | null
}

/**
 * Store 状态与行为定义
 * 这里是阶段二核心契约，组件层只依赖这些语义化方法。
 */
export interface ConversationStoreState {
    activeThread: ConversationThread
    activeNodeId: string | null
    pastSnapshots: ConversationSnapshot[]
    futureSnapshots: ConversationSnapshot[]

    setActiveThread: (thread: ConversationThread) => void
    setActiveNodeId: (nodeId: string | null) => void
    setActiveThreadCards: (cards: ConversationCard[]) => void

    addChatNode: (input?: AddChatNodeInput) => string
    addNoteNode: (input?: AddNoteNodeInput) => string
    forkChatNode: (input: ForkChatNodeInput) => string | null
    forkNoteNode: (input: ForkNoteNodeInput) => string | null

    updateChatPrompt: (nodeId: string, userPrompt: string) => void
    updateChatResponse: (nodeId: string, aiResponse: string) => void
    updateNoteContent: (nodeId: string, noteContent: string) => void

    moveNode: (nodeId: string, nextPosition: ConversationCardPosition) => void
    setNodeParent: (nodeId: string, parentId: string | null) => void
    setNodeReferences: (nodeId: string, referenceNodeIds: string[]) => void

    deleteNodes: (nodeIds: string[]) => void

    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
}
