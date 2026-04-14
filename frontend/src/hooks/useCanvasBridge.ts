import { useCallback, useEffect, useRef, useState } from "react"
import { Editor, TLShapeId } from "tldraw"
import type { ConversationCard } from "../domain/conversation/types"
import { StartLinkDragInput } from "./canvasLinkTypes"
import { type ArrowAnchorOverride, type LinkDragSession, type Point } from "./useCanvasBridge.helpers"
import { syncStableArrowProjection } from "./useCanvasBridge.projection"
import { useCanvasBridgeCanvasSync } from "./useCanvasBridge.canvasSync"
import { type CreationNodeType, useCanvasBridgeLinkDrag } from "./useCanvasBridge.linkDrag"
import { useCanvasBridgeInteractions } from "./useCanvasBridge.interactions"

function assertNeverCreationType(value: never): never {
    throw new Error(`Unsupported creation node type: ${String(value)}`)
}

interface UseCanvasBridgeParams {
    cards: ConversationCard[]
    activeNodeId: string | null
    selectedCreationType: CreationNodeType
    setActiveNodeId: (nodeId: string | null) => void
    addChatNode: (input?: {
        parentId?: string | null
        position?: { x: number; y: number }
        userPrompt?: string
        aiResponse?: string
    }) => string
    addNoteNode: (input?: {
        parentId?: string | null
        position?: { x: number; y: number }
        noteContent?: string
    }) => string
    moveNode: (nodeId: string, nextPosition: { x: number; y: number }) => void
    setNodeParent: (nodeId: string, parentId: string | null) => void
    setNodeReferences: (nodeId: string, referenceNodeIds: string[]) => void
    deleteNodes: (nodeIds: string[]) => void
    undo: () => void
    redo: () => void
}

interface UseCanvasBridgeResult {
    handleCanvasMount: (editor: Editor) => void
    handleLinkHandlePointerDown: (input: StartLinkDragInput) => void
}

/**
 * 画布桥接总线（可类比 Nuxt composable 的聚合入口）。
 * 业务场景：统一编排三层模块：linkDrag（高频拖拽）、canvasSync（Store 投影）、interactions（用户语义动作）。
 */
export function useCanvasBridge({
    cards,
    activeNodeId,
    selectedCreationType,
    setActiveNodeId,
    addChatNode,
    addNoteNode,
    moveNode,
    setNodeParent,
    setNodeReferences,
    deleteNodes,
    undo,
    redo,
}: UseCanvasBridgeParams): UseCanvasBridgeResult {
    // 全局canvas editor变量
    const [canvasEditor, setCanvasEditor] = useState<Editor | null>(null)

    /**
     * 防重入锁。
     * 业务场景：Store 正在投影到 tldraw 时，屏蔽用户态回调，避免状态回环。
     */
    const isApplyingStoreToCanvasRef = useRef(false)
    const activeNodeIdRef = useRef<string | null>(null)
    const cardsRef = useRef<ConversationCard[]>(cards)
    const selectedCreationTypeRef = useRef<CreationNodeType>(selectedCreationType)
    const arrowAnchorOverrideByIdRef = useRef<Map<TLShapeId, ArrowAnchorOverride>>(new Map())

    /**
     * 连线拖拽运行时状态（只存在于 tldraw 交互期间）。
     */
    const linkDragSessionRef = useRef<LinkDragSession | null>(null)
    const removePointerListenersRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        activeNodeIdRef.current = activeNodeId
    }, [activeNodeId])

    useEffect(() => {
        cardsRef.current = cards
    }, [cards])

    useEffect(() => {
        selectedCreationTypeRef.current = selectedCreationType
    }, [selectedCreationType])

    /**
     * 根据当前创建模式创建节点。
     * 业务场景：空白区创建与 handle 拖拽创建都统一走此入口，保证产品语义一致。
     */
    const createNodeByType = useCallback(
        (
            cardType: CreationNodeType,
            position: Point,
            parentId: string | null = null,
        ): string => {
            switch (cardType) {
                case "chat":
                    return addChatNode({
                        parentId,
                        position,
                        userPrompt: "",
                        aiResponse: "",
                    })
                case "note":
                    return addNoteNode({
                        parentId,
                        position,
                        noteContent: "",
                    })
            }

            return assertNeverCreationType(cardType)
        },
        [addChatNode, addNoteNode],
    )

    /**
     * 清理全局 pointer 监听。
     * 业务场景：每次拖拽结束或组件卸载都必须解绑，避免重复触发与内存泄漏。
     */
    const clearPointerListeners = useCallback(() => {
        if (removePointerListenersRef.current) {
            removePointerListenersRef.current()
            removePointerListenersRef.current = null
        }
    }, [])

    const { handleLinkHandlePointerDown } = useCanvasBridgeLinkDrag({
        canvasEditor,
        cardsRef,
        selectedCreationTypeRef,
        linkDragSessionRef,
        removePointerListenersRef,
        clearPointerListeners,
        createNodeByType,
        setActiveNodeId,
        setNodeReferences,
    })

    useCanvasBridgeCanvasSync({
        canvasEditor,
        cards,
        activeNodeId,
        linkDragSessionRef,
        isApplyingStoreToCanvasRef,
        arrowAnchorOverrideByIdRef,
        syncStableArrowProjection,
    })

    useCanvasBridgeInteractions({
        canvasEditor,
        isApplyingStoreToCanvasRef,
        activeNodeIdRef,
        cardsRef,
        selectedCreationTypeRef,
        linkDragSessionRef,
        arrowAnchorOverrideByIdRef,
        clearPointerListeners,
        createNodeByType,
        setActiveNodeId,
        moveNode,
        setNodeParent,
        setNodeReferences,
        deleteNodes,
        undo,
        redo,
        syncStableArrowProjection,
    })

    /**
     * tldraw 挂载回调。
     * 拿到 editor 实例后，三层子模块才能开始工作。
     * 显式关闭 tldraw 自带快捷键 清空旧历史，确保撤回/重做只由 Store 单历史栈主导。
     */
    const handleCanvasMount = useCallback((editor: Editor) => {
        setCanvasEditor(editor)
        editor.user.updateUserPreferences({
            areKeyboardShortcutsEnabled: false, // 关闭tldraw默认的快捷键
        })
        editor.clearHistory() // 清零画布历史
        editor.setCurrentTool("select") // 强制当前工具为光标
    }, [])

    return {
        handleCanvasMount,
        handleLinkHandlePointerDown,
    }
}
