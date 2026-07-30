import type { ForkMindWorkspaceDocument } from "../domain/workspace"
import type {
    BridgeErrorPayload,
    DataDirectoryBridgeResponse,
    ForkMindAppBridge,
    OperationBridgeResponse,
    WorkspaceLoadBridgeResponse,
    WorkspaceExportBridgeResponse,
    WorkspaceImportBridgeResponse,
    StartChatCompletionInput,
    CancelChatCompletionInput,
    ManagedAssetDataBridgeResponse,
    ManagedAssetImportBridgeResponse,
    ManagedAssetKind,
    ClipboardImageImportBridgeResponse,
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

/**
 * 通过系统保存对话框导出完整 ForkMind 工作区
 * document 来自已经同步当前 activeThread 的前端快照且不包含 API Key
 */
export async function exportWorkspaceFromBridge(
    document: ForkMindWorkspaceDocument,
): Promise<WorkspaceExportBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { cancelled: false, error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.ExportWorkspace(document)
    } catch (error) {
        return { cancelled: false, error: normalizeBridgeException(error) }
    }
}

/**
 * 通过系统打开对话框读取 ForkMind JSON 原文
 * 返回 content 仍属于 unknown 边界 调用方必须 JSON.parse 后执行领域校验
 */
export async function importWorkspaceFromBridge(): Promise<WorkspaceImportBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { cancelled: false, error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.ImportWorkspace()
    } catch (error) {
        return { cancelled: false, error: normalizeBridgeException(error) }
    }
}

/**
 * 通过系统对话框把图片或文件复制到 ForkMind 管理目录
 * @param kind 入参来自 image 或 file 卡片编辑器 用于应用不同文件过滤与 MIME 约束
 * @returns 返回取消态或稳定资产元数据 Bridge 异常会被归一化
 * 用户点击选择本地资产时触发
 */
export async function importManagedAssetFromBridge(
    kind: ManagedAssetKind,
): Promise<ManagedAssetImportBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { cancelled: false, error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.ImportManagedAsset(kind)
    } catch (error) {
        return { cancelled: false, error: normalizeBridgeException(error) }
    }
}

/**
 * 从桌面系统剪贴板导入真实图片到 Managed Asset Repository
 * @returns available=false 表示没有图片 调用方应继续文本粘贴
 * 用户在画布执行 Paste Here 或 Paste to Replace 时优先触发
 */
export async function importClipboardImagesFromBridge(): Promise<ClipboardImageImportBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        // Web 页面没有 Win32 Bridge 不是错误 保留浏览器文本剪贴板降级路径
        return { available: false }
    }

    try {
        return await appBridge.ImportClipboardImages()
    } catch (error) {
        return { available: false, error: normalizeBridgeException(error) }
    }
}

/**
 * 读取 ForkMind 管理图片的临时 data URL
 * @param assetId 入参来自节点持久化的内容哈希 id
 * @returns 返回仅用于当前渲染进程的 data URL 不写回 Zustand
 * 图片卡片挂载或资产变更时触发
 */
export async function readManagedAssetDataURLFromBridge(
    assetId: string,
): Promise<ManagedAssetDataBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.ReadManagedAssetDataURL(assetId)
    } catch (error) {
        return { error: normalizeBridgeException(error) }
    }
}

/**
 * 确认最终工作区保存完成并允许 Wails 真正退出
 */
export async function completeAppCloseFromBridge(): Promise<OperationBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.CompleteAppClose()
    } catch (error) {
        return { error: normalizeBridgeException(error) }
    }
}

/**
 * 最终保存失败时取消本轮关闭握手
 */
export async function abortAppCloseFromBridge(): Promise<OperationBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.AbortAppClose()
    } catch (error) {
        return { error: normalizeBridgeException(error) }
    }
}

/**
 * 启动 OpenAI-compatible 流式请求
 * 成功返回只表示后台任务已经开始 后续结果通过 Wails Events 发送
 */
export async function startChatCompletionFromBridge(
    input: StartChatCompletionInput,
): Promise<OperationBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.StartChatCompletion(input)
    } catch (error) {
        return { error: normalizeBridgeException(error) }
    }
}

/**
 * 取消指定 OpenAI-compatible 流式请求
 */
export async function cancelChatCompletionFromBridge(
    input: CancelChatCompletionInput,
): Promise<OperationBridgeResponse> {
    const appBridge = getAppBridge()
    if (!appBridge) {
        return { error: BRIDGE_UNAVAILABLE_ERROR }
    }

    try {
        return await appBridge.CancelChatCompletion(input)
    } catch (error) {
        return { error: normalizeBridgeException(error) }
    }
}
