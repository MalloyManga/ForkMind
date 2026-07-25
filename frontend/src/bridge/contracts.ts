import type { ForkMindWorkspaceDocument } from "../domain/workspace"

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

export interface ForkMindAppBridge {
    LoadWorkspace: () => Promise<WorkspaceLoadBridgeResponse>
    SaveWorkspace: (document: ForkMindWorkspaceDocument) => Promise<OperationBridgeResponse>
    GetDataDirectory: () => Promise<DataDirectoryBridgeResponse>
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
