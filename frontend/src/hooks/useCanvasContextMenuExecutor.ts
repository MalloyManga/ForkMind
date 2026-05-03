import { useCallback } from "react"
import type { Editor } from "tldraw"
import { cloneConversationCard } from "../domain/conversation/helpers"
import type { ConversationCard } from "../domain/conversation/types"
import type {
    CanvasClipboardPayload,
    ClipboardNodeSnapshot,
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
    clipboardPayload: CanvasClipboardPayload | null
    setClipboardPayload: (clipboardPayload: CanvasClipboardPayload | null) => void
    setIsCanvasUiHidden: (nextHidden: boolean | ((previousValue: boolean) => boolean)) => void
    cards: ConversationCard[]
    pasteNodesFromClipboard: (input: PasteNodesFromClipboardInput) => string[]
    replaceNodesFromClipboard: (input: ReplaceNodesFromClipboardInput) => string[]
    setActiveNodeId: (nodeId: string | null) => void
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
 * 从业务卡片生成剪贴板单节点快照
 */
function createClipboardNodeSnapshot(card: ConversationCard): ClipboardNodeSnapshot {
    const clonedCard = cloneConversationCard(card)
    const { id, createdAt, updatedAt, ...clipboardNode } = clonedCard

    return {
        ...clipboardNode,
        originalNodeId: id,
    }
}

/**
 * 从复制目标卡片集合生成剪贴板 payload
 */
function buildCanvasClipboardPayload(targetCards: ConversationCard[]): CanvasClipboardPayload | null {
    if (targetCards.length === 0) {
        return null
    }

    const sourceTopLeft = targetCards.reduce(
        (currentTopLeft, card) => ({
            x: Math.min(currentTopLeft.x, card.position.x),
            y: Math.min(currentTopLeft.y, card.position.y),
        }),
        { x: targetCards[0].position.x, y: targetCards[0].position.y },
    )

    return {
        nodes: targetCards.map((card) => createClipboardNodeSnapshot(card)),
        sourceTopLeft,
    }
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
    clipboardPayload,
    setClipboardPayload,
    setIsCanvasUiHidden,
    cards,
    pasteNodesFromClipboard,
    replaceNodesFromClipboard,
    setActiveNodeId,
}: UseCanvasContextMenuExecutorParams) {
    const executeCanvasCommand = useCallback((
        commandId: CanvasCommandId,
        context?: CanvasContextMenuContext,
    ) => {
        switch (commandId) {
            case "toggle-ui":
                // 这里用函数式更新 避免右键菜单和快捷键连续触发时读到旧闭包值
                setIsCanvasUiHidden((previousHiddenState) => !previousHiddenState)
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

                setClipboardPayload(buildCanvasClipboardPayload(targetCards))
                return
            }
            case "paste-here": {
                if (!clipboardPayload) {
                    return
                }

                // 右键菜单时使用当次右键的 pagePoint 键盘粘贴时退化到当前视口中心
                const pastePoint = context?.pagePoint ?? (canvasEditor ? getViewportCenterPagePoint(canvasEditor) : null)
                if (!pastePoint) {
                    return
                }

                const pastedNodeIds = pasteNodesFromClipboard({
                    payload: clipboardPayload,
                    pastePoint,
                })
                setActiveNodeId(pastedNodeIds[0] ?? null)
                return
            }
            case "paste-to-replace": {
                if (!clipboardPayload) {
                    return
                }

                const targetNodeIds = resolveTargetNodeIds(canvasEditor, context, activeNodeId)
                if (targetNodeIds.length === 0) {
                    return
                }

                const pastedNodeIds = replaceNodesFromClipboard({
                    payload: clipboardPayload,
                    targetNodeIds,
                })
                if (pastedNodeIds.length > 0) {
                    setActiveNodeId(pastedNodeIds[0])
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
        clipboardPayload,
        pasteNodesFromClipboard,
        replaceNodesFromClipboard,
        setActiveNodeId,
        setClipboardPayload,
        setIsCanvasUiHidden,
    ])

    return {
        executeCanvasCommand,
    }
}
