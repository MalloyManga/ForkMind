import type { ConversationThread } from "../../domain/conversation/types"

/**
 * 工作区 Store 负责管理全部会话文档
 * 当前画布的高频节点编辑仍由 conversationStore 处理
 */
export interface WorkspaceStoreState {
    threads: ConversationThread[]
    activeThreadId: string

    createThread: (title?: string) => ConversationThread
    upsertThread: (thread: ConversationThread) => void
    setActiveThreadId: (threadId: string) => void
    renameThread: (threadId: string, title: string) => void
    removeThread: (threadId: string) => ConversationThread
    hydrateWorkspace: (threads: ConversationThread[], activeThreadId: string | null) => ConversationThread
}
