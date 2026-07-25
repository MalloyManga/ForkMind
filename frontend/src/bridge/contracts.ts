import type { ForkMindWorkspaceDocument } from "../domain/workspace"
import type { ConversationThread } from "../domain/conversation/types"

export interface BridgeErrorPayload {
    code: string
    message: string
    retryable: boolean
}

export interface OperationBridgeResponse {
    error?: BridgeErrorPayload
}

export interface WorkspaceLoadBridgeResponse {
    exists: boolean
    workspace?: unknown
    error?: BridgeErrorPayload
}

export interface DataDirectoryBridgeResponse {
    path: string
    error?: BridgeErrorPayload
}

export interface OpenAICompletionConfig {
    baseUrl: string
    apiKey: string
    model: string
    systemPrompt: string
    temperature: number
    maxTokens: number
}

export interface StartChatCompletionInput {
    requestId: string
    thread: ConversationThread
    activeNodeId: string
    config: OpenAICompletionConfig
}

export interface CancelChatCompletionInput {
    requestId: string
}

export interface AIStreamChunkEvent {
    requestId: string
    nodeId: string
    delta: string
}

export interface AIStreamDoneEvent {
    requestId: string
    nodeId: string
    finishReason: string
    cancelled: boolean
}

export interface AIStreamErrorEvent {
    requestId: string
    nodeId: string
    error: BridgeErrorPayload
}

export interface ForkMindAppBridge {
    LoadWorkspace: () => Promise<WorkspaceLoadBridgeResponse>
    SaveWorkspace: (document: ForkMindWorkspaceDocument) => Promise<OperationBridgeResponse>
    GetDataDirectory: () => Promise<DataDirectoryBridgeResponse>
    StartChatCompletion: (input: StartChatCompletionInput) => Promise<OperationBridgeResponse>
    CancelChatCompletion: (input: CancelChatCompletionInput) => Promise<OperationBridgeResponse>
}

declare global {
    interface Window {
        go?: {
            main?: {
                App?: ForkMindAppBridge
            }
        }
    }
}
