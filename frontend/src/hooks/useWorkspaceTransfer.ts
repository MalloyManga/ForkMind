import { useCallback, useState } from "react"
import {
    exportWorkspaceFromBridge,
    importWorkspaceFromBridge,
    type BridgeErrorPayload,
} from "../bridge"
import { validateAndNormalizeWorkspace } from "../domain/workspace"
import { useAISettingsStore } from "../stores/useAISettingsStore"
import { useConversationStore } from "../stores/useConversationStore"
import { useWorkspaceStore } from "../stores/useWorkspaceStore"
import { createWorkspaceDocumentSnapshot } from "./useWorkspacePersistence"

export type WorkspaceTransferStatus = "idle" | "exporting" | "importing" | "success" | "error"

interface WorkspaceTransferState {
    status: WorkspaceTransferStatus
    message: string | null
    error: BridgeErrorPayload | null
}

const INITIAL_TRANSFER_STATE: WorkspaceTransferState = {
    status: "idle",
    message: null,
    error: null,
}

function createTransferError(code: string, message: string): BridgeErrorPayload {
    return {
        code,
        message,
        retryable: false,
    }
}

/**
 * 管理完整工作区单文件导入导出
 * @returns 返回两个命令以及当前进度和用户可读结果
 * 左侧栏按钮触发 Go 系统文件对话框 导入数据通过领域校验后才整体替换 Zustand 工作区
 */
export function useWorkspaceTransfer() {
    const [transferState, setTransferState] = useState<WorkspaceTransferState>(INITIAL_TRANSFER_STATE)

    /**
     * 导出当前完整工作区
     * @returns Promise 在系统保存对话框结束且文件写入完成后结束
     * 用户点击 Export 时触发 快照会先同步当前高频编辑中的 activeThread
     */
    const exportWorkspace = useCallback(async (): Promise<void> => {
        setTransferState({ status: "exporting", message: null, error: null })
        const response = await exportWorkspaceFromBridge(createWorkspaceDocumentSnapshot())

        if (response.cancelled) {
            setTransferState(INITIAL_TRANSFER_STATE)
            return
        }
        if (response.error) {
            setTransferState({ status: "error", message: null, error: response.error })
            return
        }

        setTransferState({
            status: "success",
            message: response.path ? `已导出到 ${response.path}` : "工作区导出完成",
            error: null,
        })
    }, [])

    /**
     * 导入并替换当前完整工作区
     * @returns Promise 在文件读取 JSON 解析 领域校验和 Store 水化全部完成后结束
     * 用户确认替换后触发 任一边界失败都不会修改当前工作区
     */
    const importWorkspace = useCallback(async (): Promise<void> => {
        setTransferState({ status: "importing", message: null, error: null })
        const response = await importWorkspaceFromBridge()

        if (response.cancelled) {
            setTransferState(INITIAL_TRANSFER_STATE)
            return
        }
        if (response.error) {
            setTransferState({ status: "error", message: null, error: response.error })
            return
        }
        if (!response.content) {
            setTransferState({
                status: "error",
                message: null,
                error: createTransferError("empty_import", "导入文件没有可读取的内容"),
            })
            return
        }

        let parsedWorkspace: unknown
        try {
            parsedWorkspace = JSON.parse(response.content) as unknown
        } catch (error) {
            setTransferState({
                status: "error",
                message: null,
                error: createTransferError(
                    "invalid_json",
                    error instanceof Error ? `JSON 解析失败: ${error.message}` : "JSON 解析失败",
                ),
            })
            return
        }

        const validationResult = validateAndNormalizeWorkspace(parsedWorkspace)
        if (!validationResult.ok) {
            setTransferState({
                status: "error",
                message: null,
                error: createTransferError(
                    validationResult.error.code,
                    `${validationResult.error.message} (${validationResult.error.path})`,
                ),
            })
            return
        }

        const document = validationResult.value
        useAISettingsStore.getState().hydratePersistedSettings(document.settings)
        useConversationStore.getState().resetThreadRuntimes()
        const activeThread = useWorkspaceStore
            .getState()
            .hydrateWorkspace(document.threads, document.activeThreadId)
        useConversationStore.getState().setActiveThread(activeThread)

        setTransferState({
            status: "success",
            message: response.path ? `已导入 ${response.path}` : "工作区导入完成",
            error: null,
        })
    }, [])

    return {
        ...transferState,
        isBusy: transferState.status === "exporting" || transferState.status === "importing",
        exportWorkspace,
        importWorkspace,
        clearTransferMessage: () => setTransferState(INITIAL_TRANSFER_STATE),
    }
}
