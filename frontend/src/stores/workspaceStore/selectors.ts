import type { ConversationThread } from "../../domain/conversation/types"
import type { WorkspaceStoreState } from "./contracts"

/**
 * 返回工作区全部会话文档
 */
export const selectWorkspaceThreads = (
    state: WorkspaceStoreState,
): ConversationThread[] => state.threads

/**
 * 返回工作区当前会话 id
 */
export const selectWorkspaceActiveThreadId = (
    state: WorkspaceStoreState,
): string => state.activeThreadId
