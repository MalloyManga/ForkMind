import type { ConversationThread } from "../conversation/types"
import {
    FORKMIND_WORKSPACE_FORMAT,
    FORKMIND_WORKSPACE_VERSION,
} from "./constants"

/**
 * 可持久化的 OpenAI-compatible 设置
 * API Key 明确不属于该对象 只保留在运行时内存
 */
export interface PersistedOpenAISettings {
    baseUrl: string
    model: string
}

/**
 * ForkMind 工作区主格式
 * Wails Go 层会把 index 与 thread 文件拆开保存 但 Bridge 传输保持一个完整领域快照
 */
export interface ForkMindWorkspaceDocument {
    format: typeof FORKMIND_WORKSPACE_FORMAT
    version: typeof FORKMIND_WORKSPACE_VERSION
    activeThreadId: string
    threads: ConversationThread[]
    settings: PersistedOpenAISettings
    lastModified: string
}

export interface WorkspaceValidationError {
    code: string
    message: string
    path: string
}

export type WorkspaceValidationResult =
    | {
        ok: true
        value: ForkMindWorkspaceDocument
      }
    | {
        ok: false
        error: WorkspaceValidationError
      }
