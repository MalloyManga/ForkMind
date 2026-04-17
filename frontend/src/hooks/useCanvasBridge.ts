import { useCallback, useEffect, useRef, useState } from "react"
import { Editor, TLShapeId } from "tldraw"
import type { ConversationCard, ConversationNodeType } from "../domain/conversation/types"
import { StartLinkDragInput } from "./canvasLinkTypes"
import { type ArrowAnchorOverride, type LinkDragSession, type Point } from "./useCanvasBridge.helpers"
import { syncStableArrowProjection } from "./useCanvasBridge.projection"
import { useCanvasBridgeCanvasSync } from "./useCanvasBridge.canvasSync"
import { useCanvasBridgeLinkDrag } from "./useCanvasBridge.linkDrag"
import { useCanvasBridgeInteractions } from "./useCanvasBridge.interactions"

function assertNeverCreationType(value: never): never {
    throw new Error(`Unsupported creation node type: ${String(value)}`)
}

interface UseCanvasBridgeParams {
    cards: ConversationCard[]
    activeNodeId: string | null
    selectedCreationType: ConversationNodeType
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
 * 统一编排三层模块：linkDrag（高频拖拽）、canvasSync（Store 投影）、interactions（用户语义动作）
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

    const isApplyingStoreToCanvasRef = useRef(false)
    const activeNodeIdRef = useRef<string | null>(null)
    const cardsRef = useRef<ConversationCard[]>(cards)
    const selectedCreationTypeRef = useRef<ConversationNodeType>(selectedCreationType)
    const arrowAnchorOverrideByIdRef = useRef<Map<TLShapeId, ArrowAnchorOverride>>(new Map()) // 存储用户手动指定的箭头首尾锚点 覆盖在自动生成的

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
     * 根据当前创建模式创建节点
     * 白区创建与 handle 拖拽创建都统一走此入口，保证产品语义一致
     */
    const createNodeByType = useCallback(
        (
            cardType: ConversationNodeType,
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
     * 清理全局 pointer 监听
     * 每次拖拽结束或组件卸载都必须解绑，避免重复触发与内存泄漏
     */
    const clearPointerListeners = useCallback(() => {
        if (removePointerListenersRef.current) {
            removePointerListenersRef.current()
            removePointerListenersRef.current = null
        }
    }, [])

    /**
     * 1. 挂载【临时拖拽交互部】
     * 职责：接管用户拉动箭头那一瞬间的高频拖拽动作，它只需要 cardsRef 查户口，不需要画图工具。
     */
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

    /**
     * 2. 挂载【内阁 / VDOM Diff 同步部】
     * 核心解答：看最后一行！总司令从 projection 引入了 `syncStableArrowProjection`（画线工具），
     * 作为“尚方宝剑”作为参数传给了 canvasSync。这样 sync 算完 Diff 就能直接拿它画线，无需双向 import！
     */
    useCanvasBridgeCanvasSync({
        canvasEditor,
        cards,
        activeNodeId,
        linkDragSessionRef,
        isApplyingStoreToCanvasRef,
        arrowAnchorOverrideByIdRef,
        syncStableArrowProjection, // <=== 秘密就在这里！依赖注入！
    })

    /**
     * 3. 挂载【外交部 / 画布原生事件交互部】
     * 职责：监听画布上的原生移动节点、删除、修改连线、撤销重做等动作，翻译后提交给 Zustand。
     */
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
        syncStableArrowProjection, // 同样的，交互层在用户手动改连线时也需要画图工具，总司令也给它发了一把。
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
