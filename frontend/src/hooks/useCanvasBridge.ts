import { useCallback, useEffect, useRef, useState } from "react"
import { Editor, TLShapeId } from "tldraw"
import type { ConversationCard, ConversationNodeType } from "../domain/conversation/types"
import { assertNever } from "../lib/utils"
import type { AddConversationNodeDraftInput } from "../stores/conversationStore"
import { StartLinkDragInput } from "./canvasLinkTypes"
import type { CanvasTool } from "./canvasToolTypes"
import {
    type ArrowAnchorOverride,
    type LinkDragSession,
    type Point,
} from "./useCanvasBridge.helpers"
import { syncStableArrowProjection } from "./useCanvasBridge.projection"
import { useCanvasBridgeCreation } from "./useCanvasBridge.creation"
import { useCanvasBridgeCanvasSync } from "./useCanvasBridge.canvasSync"
import { useCanvasBridgeLinkDrag } from "./useCanvasBridge.linkDrag"
import { useCanvasBridgeInteractions } from "./useCanvasBridge.interactions"

interface UseCanvasBridgeParams {
    cards: ConversationCard[]
    activeNodeId: string | null
    currentCanvasTool: CanvasTool
    setActiveNodeId: (nodeId: string | null) => void
    setCurrentCanvasTool: (canvasTool: CanvasTool) => void // 真正修改 App 当前工具状态的 React setState
    addNode: (input: AddConversationNodeDraftInput) => string
    moveNode: (nodeId: string, nextPosition: { x: number; y: number }) => void
    resizeNode: (nodeId: string, nextSize: { mode: "auto" | "fixed"; width: number; minHeight: number }) => void
    setNodeParent: (nodeId: string, parentId: string | null) => void
    setNodeReferences: (nodeId: string, referenceNodeIds: string[]) => void
    deleteNodes: (nodeIds: string[]) => void
    undo: () => void
    redo: () => void
}

/**
 * node创建入参
 */
interface CommitNodeCreationInput {
    cardType: ConversationNodeType
    position: Point
    parentId?: string | null
    size?: {
        width?: number
        minHeight?: number
    }
}

interface UseCanvasBridgeResult {
    handleCanvasMount: (editor: Editor) => void
    handleLinkHandlePointerDown: (input: StartLinkDragInput) => void
    creationPreviewRect: { // 蓝色预创建框的几何信息，只给 overlay 用
        x: number
        y: number
        width: number
        height: number
    } | null
}

/**
 * 统一编排四层模块：linkDrag（高频拖拽）、canvasSync（Store 投影）、interactions（用户语义动作）、Creation（创建状态机）
 */
export function useCanvasBridge({
    cards,
    activeNodeId,
    currentCanvasTool,
    setActiveNodeId,
    setCurrentCanvasTool,
    addNode,
    moveNode,
    resizeNode,
    setNodeParent,
    setNodeReferences,
    deleteNodes,
    undo,
    redo,
}: UseCanvasBridgeParams): UseCanvasBridgeResult {
    const [canvasEditor, setCanvasEditor] = useState<Editor | null>(null) // // 全局 canvas editor 变量

    // 以下ref为桥接层的“运行时缓存” 让高频画布事件能读到最新状态而不必反复重渲染
    const isApplyingStoreToCanvasRef = useRef(false)
    const isUserMultiSelectionRef = useRef(false)
    const activeNodeIdRef = useRef<string | null>(null)
    const cardsRef = useRef<ConversationCard[]>(cards)
    const currentCanvasToolRef = useRef<CanvasTool>(currentCanvasTool)

    const arrowAnchorOverrideByIdRef = useRef<Map<TLShapeId, ArrowAnchorOverride>>(new Map()) // 存储用户手动指定的箭头首尾锚点 覆盖自动生成的

    /**
     * 当前正在拖拽出的箭头都对象的快照
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
        currentCanvasToolRef.current = currentCanvasTool

        /**
         * 侦听currentCanvasTool
         * 统一把画布工具状态映射到 tldraw 内部工具
         * chat / note 不是 tldraw 原生工具 当前先映射到 select，再由 creation hook 在 capture 阶段接管创建事件
         */
        if (!canvasEditor) {
            return
        }

        canvasEditor.setCurrentTool(currentCanvasTool === "hand-tool" ? "hand" : "select")
    }, [canvasEditor, currentCanvasTool])

    /**
     * 接收cardType创建卡片类型 position卡片位置 父nodeId(直接创建时为null)
     * 返回创建成功之后的NodeId
     */
    const commitNodeCreation = useCallback(
        ({
            cardType,
            position,
            parentId = null,
            size,
        }: CommitNodeCreationInput): string => {
            let nodeDraft: AddConversationNodeDraftInput

            switch (cardType) {
                case "chat":
                    nodeDraft = {
                        cardType,
                        parentId,
                        position,
                        size,
                        userPrompt: "",
                        aiResponse: "",
                    }
                    break
                case "note":
                    nodeDraft = {
                        cardType,
                        parentId,
                        position,
                        size,
                        noteContent: "",
                    }
                    break
                default:
                    assertNever(cardType)
            }

            const createdNodeId = addNode(nodeDraft)

            setActiveNodeId(createdNodeId)
            setCurrentCanvasTool("move") // 创建成功之后都回退到Move
            return createdNodeId
        },
        [addNode, setActiveNodeId, setCurrentCanvasTool],
    )

    /**
     * 清理全局 pointer 监听
     * 每次拖拽结束或组件卸载都必须解绑 避免重复触发与内存泄漏
     */
    const clearPointerListeners = useCallback(() => {
        if (removePointerListenersRef.current) {
            removePointerListenersRef.current()
            removePointerListenersRef.current = null
        }
    }, [])

    /**
     * 1. 挂载 幽灵卡片状态处理
     * 接管用户拉动箭头那一瞬间的高频拖拽动作，它只需要 cardsRef 查户口，不需要画图工具
     */
    const { handleLinkHandlePointerDown } = useCanvasBridgeLinkDrag({
        canvasEditor,
        cardsRef,
        currentCanvasToolRef,
        linkDragSessionRef,
        removePointerListenersRef,
        clearPointerListeners,
        commitNodeCreation,
        setNodeParent,
        setNodeReferences,
    })

    /**
     * 1.5 挂载 创建拖拽状态机
     * 在 Chat / Note 工具下接管空白画布拖拽
     * 产出蓝色预创建框，并在松手时提交真实业务卡片
     */
    const { creationPreviewRect } = useCanvasBridgeCreation({
        canvasEditor,
        currentCanvasToolRef,
        commitNodeCreation,
    })

    /**
     * 2. 挂载 VDOM Diff 同步
     */
    useCanvasBridgeCanvasSync({
        canvasEditor,
        cards,
        activeNodeId,
        linkDragSessionRef,
        isApplyingStoreToCanvasRef,
        isUserMultiSelectionRef,
        arrowAnchorOverrideByIdRef,
        syncStableArrowProjection,
    })

    /**
     * 3. 监听用户手势操作
     * 监听画布上的原生移动节点、删除、修改连线、撤销重做等动作，翻译后提交给 Zustand
     */
    useCanvasBridgeInteractions({
        canvasEditor,
        isApplyingStoreToCanvasRef,
        isUserMultiSelectionRef,
        activeNodeIdRef,
        cardsRef,
        linkDragSessionRef,
        arrowAnchorOverrideByIdRef,
        clearPointerListeners,
        setActiveNodeId,
        moveNode,
        resizeNode,
        setNodeParent,
        setNodeReferences,
        deleteNodes,
        undo,
        redo,
        syncStableArrowProjection,
    })

    /**
     * tldraw 挂载回调
     * 拿到 editor 后，桥接层的所有子模块才能真正开始工作
     * 显式关闭 tldraw 自带快捷键，确保撤回/重做只由 Store 单历史栈主导
     */
    const handleCanvasMount = useCallback((editor: Editor) => {
        setCanvasEditor(editor)
        editor.user.updateUserPreferences({
            areKeyboardShortcutsEnabled: false, // 关闭tldraw默认的快捷键
        })
        editor.clearHistory() // 清零画布历史
        editor.setCurrentTool(currentCanvasToolRef.current === "hand-tool" ? "hand" : "select")
    }, [currentCanvasToolRef])

    return {
        handleCanvasMount,
        handleLinkHandlePointerDown,
        creationPreviewRect,
    }
}
