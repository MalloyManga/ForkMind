import type { ForkMindWorkspaceDocument } from "../domain/workspace"
import type { ConversationThread } from "../domain/conversation/types"
import type { ManagedAssetReference } from "../domain/conversation/types"

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

export interface WorkspaceExportBridgeResponse {
    cancelled: boolean
    path?: string
    error?: BridgeErrorPayload
}

export interface WorkspaceImportBridgeResponse {
    cancelled: boolean
    path?: string
    content?: string
    error?: BridgeErrorPayload
}

export type ManagedAssetKind = "image" | "file"

export type ManagedAsset = ManagedAssetReference

export interface ManagedAssetImportBridgeResponse {
    cancelled: boolean
    asset?: ManagedAsset
    error?: BridgeErrorPayload
}

export interface ManagedAssetDataBridgeResponse {
    dataUrl?: string
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
    ExportWorkspace: (document: ForkMindWorkspaceDocument) => Promise<WorkspaceExportBridgeResponse>
    ImportWorkspace: () => Promise<WorkspaceImportBridgeResponse>
    ImportManagedAsset: (kind: ManagedAssetKind) => Promise<ManagedAssetImportBridgeResponse>
    ReadManagedAssetDataURL: (assetId: string) => Promise<ManagedAssetDataBridgeResponse>
    CompleteAppClose: () => Promise<OperationBridgeResponse>
    AbortAppClose: () => Promise<OperationBridgeResponse>
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
