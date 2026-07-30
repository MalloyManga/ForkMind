import { useCallback } from "react"
import type { Editor } from "tldraw"
import type { ConversationCard } from "../domain/conversation/types"
import {
    createCanvasClipboardPayload,
    parseSystemClipboardContent,
    readSystemClipboardText,
    serializeForkMindClipboard,
    writeSystemClipboardText,
} from "../domain/clipboard"
import type {
    CanvasClipboardPayload,
    PasteNodesFromClipboardInput,
    ReplaceNodesFromClipboardInput,
} from "../stores/conversationStore"
import type { CanvasCommandId } from "./canvasCommands"
import type { CanvasContextMenuContext } from "./canvasContextMenuTypes"
import { parseNodeIdFromShapeId } from "./canvasNodeIds"
import type { Point } from "./useCanvasBridge.helpers"

interface UseCanvasContextMenuExecutorParams {
    canvasEditor: Editor | null
    activeNodeId: string | null
    setIsCanvasUiHidden: (nextHidden: boolean | ((previousValue: boolean) => boolean)) => void
    setAreSidebarsHidden: (nextHidden: boolean | ((previousValue: boolean) => boolean)) => void
    cards: ConversationCard[]
    pasteNodesFromClipboard: (input: PasteNodesFromClipboardInput) => string[]
    replaceNodesFromClipboard: (input: ReplaceNodesFromClipboardInput) => string[]
    setActiveNodeId: (nodeId: string | null) => void
}

/**
 * 从系统剪贴板读取并验证 ForkMind JSON
 * @returns 成功时返回可交给 Zustand paste action 的 CanvasClipboardPayload
 * @throws 系统剪贴板不可用或内容不是合法 ForkMind JSON 时抛出用户可读错误
 * Paste Here 与 Paste to Replace 每次执行时调用 保证系统剪贴板是唯一事实源
 */
async function readSystemClipboardPayload(): Promise<CanvasClipboardPayload> {
    const clipboardContent = await readSystemClipboardText()
    const parseResult = parseSystemClipboardContent(clipboardContent)
    if (!parseResult.ok) {
        throw new Error(parseResult.error)
    }

    return parseResult.value
}

/**
 * 读取 tldraw 当前选中的业务节点 id
 * 返回 string(id)[]
 */
function getSelectedNodeIdsFromEditor(canvasEditor: Editor): string[] {
    return canvasEditor
        .getSelectedShapeIds()
        .map((shapeId) => parseNodeIdFromShapeId(shapeId))
        .filter((nodeId): nodeId is string => nodeId !== null)
}

/**
 * 根据右键上下文和画布 selection 解析命令目标
 * Copy 和 Paste to replace 都是在处理当前目标节点集合
 * 返回 nodeid(string)[]
 */
function resolveTargetNodeIds(
    canvasEditor: Editor | null,
    context: CanvasContextMenuContext | undefined,
    activeNodeId: string | null,
): string[] {
    const selectedNodeIds = canvasEditor ? getSelectedNodeIdsFromEditor(canvasEditor) : []
    if (selectedNodeIds.length > 0) { // 多选
        return selectedNodeIds
    }
    else if (context?.kind === "node") {
        return [context.nodeId]
    }

    return activeNodeId ? [activeNodeId] : []
}

/**
 * 根据画布容器中心点兜底生成粘贴落点
 * 直接按 Ctrl Cmd V 时没有右键位置 新卡片落在当前视口中心
 */
function getViewportCenterPagePoint(canvasEditor: Editor): Point {
    const canvasRect = canvasEditor.getContainer().getBoundingClientRect()
    return canvasEditor.screenToPage({
        x: canvasRect.left + canvasRect.width / 2,
        y: canvasRect.top + canvasRect.height / 2,
    })
}

/**
 * 右键菜单 executor
 * ContextMenu 点击 和 键盘快捷键 最终都走这里 保证 copy paste toggle 等只有一个执行业务源
 */
export function useCanvasContextMenuExecutor({
    canvasEditor,
    activeNodeId,
    setIsCanvasUiHidden,
    setAreSidebarsHidden,
    cards,
    pasteNodesFromClipboard,
    replaceNodesFromClipboard,
    setActiveNodeId,
}: UseCanvasContextMenuExecutorParams) {
    const executeCanvasCommand = useCallback(async (
        commandId: CanvasCommandId,
        context?: CanvasContextMenuContext,
    ): Promise<void> => {
        switch (commandId) {
            case "toggle-ui":
                // 这里用函数式更新 避免右键菜单和快捷键连续触发时读到旧闭包值
                setIsCanvasUiHidden((previousHiddenState) => !previousHiddenState)
                return
            case "toggle-panels":
                setAreSidebarsHidden((previousHiddenState) => !previousHiddenState)
                return
            case "copy-node": {
                const targetNodeIds = resolveTargetNodeIds(canvasEditor, context, activeNodeId)
                if (targetNodeIds.length === 0) {
                    return
                }

                const cardById = new Map(cards.map((card) => [card.id, card]))
                const targetCards = targetNodeIds
                    .map((nodeId) => cardById.get(nodeId))
                    .filter((card): card is ConversationCard => card !== undefined)

                const nextClipboardPayload = createCanvasClipboardPayload(targetCards)
                if (!nextClipboardPayload) {
                    return
                }

                try {
                    await writeSystemClipboardText(serializeForkMindClipboard(nextClipboardPayload))
                } catch (error) {
                    window.alert(error instanceof Error ? error.message : "系统剪贴板写入失败")
                }
                return
            }
            case "paste-here": {
                // 右键菜单时使用当次右键的 pagePoint 键盘粘贴时退化到当前视口中心
                const pastePoint = context?.pagePoint ?? (canvasEditor ? getViewportCenterPagePoint(canvasEditor) : null)
                if (!pastePoint) {
                    return
                }

                try {
                    const clipboardPayload = await readSystemClipboardPayload()
                    const pastedNodeIds = pasteNodesFromClipboard({
                        payload: clipboardPayload,
                        pastePoint,
                    })
                    setActiveNodeId(pastedNodeIds[0] ?? null)
                } catch (error) {
                    window.alert(error instanceof Error ? error.message : "系统剪贴板读取失败")
                }
                return
            }
            case "paste-to-replace": {
                const targetNodeIds = resolveTargetNodeIds(canvasEditor, context, activeNodeId)
                if (targetNodeIds.length === 0) {
                    return
                }

                try {
                    const clipboardPayload = await readSystemClipboardPayload()
                    const pastedNodeIds = replaceNodesFromClipboard({
                        payload: clipboardPayload,
                        targetNodeIds,
                    })
                    if (pastedNodeIds.length > 0) {
                        setActiveNodeId(pastedNodeIds[0])
                    }
                } catch (error) {
                    window.alert(error instanceof Error ? error.message : "系统剪贴板读取失败")
                }
                return
            }
            default:
                return
        }
    }, [
        activeNodeId,
        canvasEditor,
        cards,
        pasteNodesFromClipboard,
        replaceNodesFromClipboard,
        setActiveNodeId,
        setAreSidebarsHidden,
        setIsCanvasUiHidden,
    ])

    return {
        executeCanvasCommand,
    }
}
