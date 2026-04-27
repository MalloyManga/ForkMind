import { useCallback } from "react"
import type { Editor } from "tldraw"
import { cloneConversationCard } from "../domain/conversation/helpers"
import type { ConversationCard } from "../domain/conversation/types"
import type {
    AddConversationNodeInput,
    ClipboardNodeInput,
} from "../stores/conversationStore"
import type { CanvasCommandId } from "./canvasCommands"
import type { CanvasContextMenuContext } from "./canvasContextMenuTypes"
import type { Point } from "./useCanvasBridge.helpers"

interface UseCanvasContextMenuExecutorParams {
    canvasEditor: Editor | null
    activeNodeId: string | null
    clipboardCard: ClipboardNodeInput | null
    setClipboardCard: (clipboardCard: ClipboardNodeInput | null) => void
    setIsCanvasUiHidden: (nextHidden: boolean | ((previousValue: boolean) => boolean)) => void
    cards: ConversationCard[]
    addNode: (input: AddConversationNodeInput) => string
    replaceNodeFromClipboard: (nodeId: string, clipboardCard: ClipboardNodeInput) => void
    setActiveNodeId: (nodeId: string | null) => void
}

/**
 * 从业务卡片生成剪贴板快照
 * Copy 只保存内容和关系 不保存旧 id 旧时间戳和旧位置
 */
function createClipboardNodeInput(card: ConversationCard): ClipboardNodeInput {
    const clonedCard = cloneConversationCard(card)
    const { id, createdAt, updatedAt, position, ...clipboardNode } = clonedCard

    return clipboardNode
}

/**
 * 根据画布容器中心点兜底生成粘贴落点
 * 直接按 Ctrl Cmd+V 时 没有右键位置 新卡片落在当前视口中心
 */
function getViewportCenterPagePoint(canvasEditor: Editor): Point {
    const canvasRect = canvasEditor.getContainer().getBoundingClientRect()
    return canvasEditor.screenToPage({
        x: canvasRect.left + canvasRect.width / 2,
        y: canvasRect.top + canvasRect.height / 2,
    })
}

/**
 * 由 clipboardCard 的 Node 快照 与 粘贴落点 计算完整新增入参
 * Paste here 时旧节点没有旧位置 新节点使用右键落点或视口中心作为新位置
 */
function createNodeInputFromClipboard(
    clipboardCard: ClipboardNodeInput,
    pagePoint: Point,
): AddConversationNodeInput {
    const nextPosition = {
        // 粘贴时 让鼠标落点尽量位于新卡片几何中心附近 而不是左上角
        x: pagePoint.x - clipboardCard.size.width / 2,
        y: pagePoint.y - clipboardCard.size.minHeight / 2,
    }

    const nextNodeInput = {
        ...clipboardCard,
        position: nextPosition,
        size: { ...clipboardCard.size },
        referenceNodeIds: clipboardCard.referenceNodeIds ? [...clipboardCard.referenceNodeIds] : undefined,
    }

    return nextNodeInput
}

/**
 * 右键菜单 executor
 * ContextMenu 点击 和 键盘快捷键 最终都走这里 保证 copy paste toggle 等 只有一个执行业务源
 */
export function useCanvasContextMenuExecutor({
    canvasEditor,
    activeNodeId,
    clipboardCard,
    setClipboardCard,
    setIsCanvasUiHidden,
    cards,
    addNode,
    replaceNodeFromClipboard,
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
                // 右键卡片复制优先使用当前右键命中的 nodeId 退化场景再回落到 activeNodeId
                const targetNodeId = context?.kind === "node" ? context.nodeId : activeNodeId
                if (!targetNodeId) {
                    return
                }

                // 获取 targetCard 对象
                const targetCard = cards.find((card) => card.id === targetNodeId)
                if (!targetCard) {
                    return
                }

                setClipboardCard(createClipboardNodeInput(targetCard))
                return
            }
            case "paste-here": {
                if (!clipboardCard) {
                    return
                }

                // 右键菜单时使用当次右键的 pagePoint 键盘粘贴时退化到当前视口中心
                const pastePoint = context?.pagePoint ?? (canvasEditor ? getViewportCenterPagePoint(canvasEditor) : null)
                if (!pastePoint) {
                    return
                }

                const nextNodeInput = createNodeInputFromClipboard(clipboardCard, pastePoint)
                const createdNodeId = addNode(nextNodeInput)
                setActiveNodeId(createdNodeId)
                // 粘贴新卡片后 立即把焦点交给新卡片 右侧编辑栏就会切到它
                return
            }
            case "paste-to-replace": {
                if (!clipboardCard) {
                    return
                }

                const targetNodeId = context?.kind === "node" ? context.nodeId : activeNodeId
                if (!targetNodeId) {
                    return
                }

                // replace 语义是保留当前卡片身份和位置 只替换类型与正文
                replaceNodeFromClipboard(targetNodeId, clipboardCard)
                setActiveNodeId(targetNodeId)
                return
            }
            default:
                return
        }
    }, [
        activeNodeId,
        addNode,
        canvasEditor,
        cards,
        clipboardCard,
        replaceNodeFromClipboard,
        setActiveNodeId,
        setClipboardCard,
        setIsCanvasUiHidden,
    ])

    return {
        executeCanvasCommand,
    }
}
