import type { ForkMindWorkspaceDocument } from "../domain/workspace"
import type {
    BridgeErrorPayload,
    DataDirectoryBridgeResponse,
    ForkMindAppBridge,
    OperationBridgeResponse,
    WorkspaceLoadBridgeResponse,
} from "./contracts"

const BRIDGE_UNAVAILABLE_ERROR: BridgeErrorPayload = {
    code: "bridge_unavailable",
    message: "Wails Bridge 当前不可用 请在 ForkMind 桌面应用中运行",
    retryable: false,
}

function getAppBridge(): ForkMindAppBridge | null {
    return window.go?.main?.App ?? null
}

function normalizeBridgeException(error: unknown): BridgeErrorPayload {
    return {
        code: "bridge_exception",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
    }
}

/**
 * 通过 Wails 读取本地工作区
 * 返回的 workspace 仍是 unknown 调用方必须执行领域 validate normalize
 */
export async function loadWorkspaceFromBridge(): Promise<WorkspaceLoadBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { exists: false, error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.LoadWorkspace()
    } catch (error) {
        return { exists: false, error: normalizeBridgeException(error) }
    }
}

/**
 * 通过 Wails 保存已经完成领域校验的工作区快照
 */
export async function saveWorkspaceToBridge(
    document: ForkMindWorkspaceDocument,
): Promise<OperationBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.SaveWorkspace(document)
    } catch (error) {
        return { error: normalizeBridgeException(error) }
    }
}

/**
 * 查询 ForkMind 本地数据目录
 */
export async function getDataDirectoryFromBridge(): Promise<DataDirectoryBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { path: "", error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.GetDataDirectory()
    } catch (error) {
        return { path: "", error: normalizeBridgeException(error) }
    }
}
