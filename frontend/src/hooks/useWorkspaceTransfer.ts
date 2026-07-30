import { useCallback, useEffect, useState } from "react"
import type { Editor } from "tldraw"
import {
    exportWorkspaceFromBridge,
    importWorkspaceFromBridge,
    type BridgeErrorPayload,
} from "../bridge"
import { createCanvasClipboardPayload } from "../domain/clipboard"
import type { ConversationCardPosition } from "../domain/conversation/types"
import { validateAndNormalizeWorkspace } from "../domain/workspace"
import { useConversationStore } from "../stores/useConversationStore"
import { toCanvasNodeShapeId } from "./canvasNodeIds"
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

interface UseWorkspaceTransferParams {
    canvasEditor: Editor | null
}

function createTransferError(code: string, message: string): BridgeErrorPayload {
    return {
        code,
        message,
        retryable: false,
    }
}

/**
 * 读取当前 tldraw 视口中心对应的 page 坐标
 * @param canvasEditor 入参来自 App 保存的已挂载 tldraw Editor
 * @returns 返回导入卡片组左上角使用的画布坐标
 * 用户完成工作区文件选择并准备追加 cards 时触发
 */
function getImportPastePoint(canvasEditor: Editor): ConversationCardPosition {
    const canvasRect = canvasEditor.getContainer().getBoundingClientRect()
    return canvasEditor.screenToPage({
        x: canvasRect.left + canvasRect.width / 2,
        y: canvasRect.top + canvasRect.height / 2,
    })
}

/**
 * 管理完整工作区导出和卡片追加导入
 * @param params.canvasEditor 入参来自 App 用于计算导入落点并在投影完成后选中新卡片
 * @returns 返回两个命令以及当前进度和用户可读结果
 * 左侧栏按钮触发 Go 系统文件对话框 导入数据通过领域校验后追加到当前 Zustand thread
 */
export function useWorkspaceTransfer({ canvasEditor }: UseWorkspaceTransferParams) {
    const [transferState, setTransferState] = useState<WorkspaceTransferState>(INITIAL_TRANSFER_STATE)
    const [pendingImportedNodeIds, setPendingImportedNodeIds] = useState<string[]>([])

    useEffect(() => {
        if (!canvasEditor || pendingImportedNodeIds.length === 0) {
            return
        }

        // Store 更新后 React effect 与 tldraw projection 在同一轮执行
        // 下一帧再选中可以保证所有新 shape 已经由 canvasSync 创建
        const selectionFrame = window.requestAnimationFrame(() => {
            const importedShapeIds = pendingImportedNodeIds
                .map((nodeId) => toCanvasNodeShapeId(nodeId))
                .filter((shapeId) => canvasEditor.getShape(shapeId) !== undefined)

            if (importedShapeIds.length !== pendingImportedNodeIds.length) {
                setTransferState({
                    status: "error",
                    message: null,
                    error: createTransferError("import_selection_failed", "导入成功 但部分新卡片尚未投影到画布"),
                })
                setPendingImportedNodeIds([])
                return
            }

            canvasEditor.setSelectedShapes(importedShapeIds)
            setPendingImportedNodeIds([])
        })

        return () => window.cancelAnimationFrame(selectionFrame)
    }, [canvasEditor, pendingImportedNodeIds])

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
     * 导入文件 active thread 的 cards 并追加到当前画布
     * @returns Promise 在文件读取 JSON 解析 领域校验和 Store 粘贴事务全部完成后结束
     * 用户点击 Import cards 时触发 任一边界失败都不会修改当前工作区
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
        const importedThread = document.threads.find(
            (thread) => thread.id === document.activeThreadId,
        ) ?? document.threads[0]
        const clipboardPayload = createCanvasClipboardPayload(importedThread.cards)
        if (!clipboardPayload) {
            setTransferState({
                status: "error",
                message: null,
                error: createTransferError("empty_import", "导入文件的当前会话没有可追加卡片"),
            })
            return
        }
        if (!canvasEditor) {
            setTransferState({
                status: "error",
                message: null,
                error: createTransferError("canvas_unavailable", "画布尚未完成初始化 请稍后重试"),
            })
            return
        }

        const importedNodeIds = useConversationStore.getState().pasteNodesFromClipboard({
            payload: clipboardPayload,
            pastePoint: getImportPastePoint(canvasEditor),
        })
        setPendingImportedNodeIds(importedNodeIds)

        setTransferState({
            status: "success",
            message: response.path
                ? `已从 ${response.path} 追加 ${importedNodeIds.length} 张卡片`
                : `已追加 ${importedNodeIds.length} 张卡片`,
            error: null,
        })
    }, [canvasEditor])

    return {
        ...transferState,
        isBusy: transferState.status === "exporting" || transferState.status === "importing",
        exportWorkspace,
        importWorkspace,
        clearTransferMessage: () => setTransferState(INITIAL_TRANSFER_STATE),
    }
}
