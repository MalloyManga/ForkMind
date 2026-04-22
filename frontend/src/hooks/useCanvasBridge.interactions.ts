import { useEffect, type MutableRefObject } from "react"
import type { Editor, TLShapeId } from "tldraw"
import type { ConversationCard } from "../domain/conversation/types"
import { parseCanvasArrowDescriptor, parseNodeIdFromShapeId, toCanvasNodeShapeId } from "./canvasNodeIds"
import {
    type ArrowAnchorOverride,
    closestAnchorSideToNormalizedAnchor,
    createStableArrowProjections,
    isTextEditingTarget,
    type LinkDragSession,
} from "./useCanvasBridge.helpers"
import { type syncStableArrowProjection as SyncStableArrowProjectionFn } from "./useCanvasBridge.projection"

interface UseCanvasBridgeInteractionsParams {
    canvasEditor: Editor | null
    isApplyingStoreToCanvasRef: MutableRefObject<boolean> // 是否已经同步
    isUserMultiSelectionRef: MutableRefObject<boolean>
    activeNodeIdRef: MutableRefObject<string | null>
    cardsRef: MutableRefObject<ConversationCard[]>
    linkDragSessionRef: MutableRefObject<LinkDragSession | null>
    arrowAnchorOverrideByIdRef: MutableRefObject<Map<TLShapeId, ArrowAnchorOverride>>
    clearPointerListeners: () => void
    setActiveNodeId: (nodeId: string | null) => void
    moveNode: (nodeId: string, nextPosition: { x: number; y: number }) => void
    setNodeParent: (nodeId: string, parentId: string | null) => void
    setNodeReferences: (nodeId: string, referenceNodeIds: string[]) => void
    deleteNodes: (nodeIds: string[]) => void
    undo: () => void
    redo: () => void
    syncStableArrowProjection: typeof SyncStableArrowProjectionFn
}

/**
 * Canvas 交互适配层
 * 负责监听画布里的原生事件 然后把这些事件翻译成 Store 能理解的业务动作
 */
export function useCanvasBridgeInteractions({
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
    setNodeParent,
    setNodeReferences,
    deleteNodes,
    undo,
    redo,
    syncStableArrowProjection,
}: UseCanvasBridgeInteractionsParams) {
    // 拦截并删除tldraw默认双击创建text
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        // registerAfterCreateHandler 为 每一次新建一参类型shape的时间 调用二参函数
        const unregister = canvasEditor.sideEffects.registerAfterCreateHandler(
            "shape",
            (shape, source) => {
                // 只处理用户行为生成的 text shape 其它 shape 继续走原流程
                if (source !== "user" || shape.type !== "text") {
                    return
                }

                canvasEditor.run(() => {
                    // 先退出 text 编辑态 再删除 shape
                    if (canvasEditor.getEditingShapeId() === shape.id) {
                        canvasEditor.setEditingShape(null)
                    }
                    if (canvasEditor.getShape(shape.id)) {
                        canvasEditor.deleteShapes([shape.id])
                    }
                }, { history: "ignore" })
            },
        )
        return () => {
            unregister()
        }
    }, [canvasEditor])

    /**
     * 禁止用户直接拖动/改写业务箭头（包括移动箭头本体与拖端点）
     * 当前阶段箭头只作为关系投影，用户可选中删除，但不能直接拖动编辑。
     * 注意：Store -> Canvas 的系统投影同步仍需放行（isApplyingStoreToCanvasRef=true）。
     */
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        const unregister = canvasEditor.sideEffects.registerBeforeChangeHandler(
            "shape",
            (previousShape, nextShape, source) => {
                if (isApplyingStoreToCanvasRef.current) {
                    return nextShape
                }

                if (source !== "user") {
                    return nextShape
                }

                if (previousShape.type === "arrow" && nextShape.type === "arrow") {
                    return previousShape
                }

                return nextShape
            },
        )

        return () => {
            unregister()
        }
    }, [canvasEditor, isApplyingStoreToCanvasRef])

    // 画布选中态 -> Store activeNodeId 同步
    // 设置activeNodeId分为两种 点击/框选 映射回store需要做处理
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        const unlisten = canvasEditor.store.listen(
            () => {
                if (isApplyingStoreToCanvasRef.current) {
                    return
                }

                // 从当前选中的 shape 里过滤出业务节点
                const selectedNodeIds = canvasEditor
                    .getSelectedShapeIds()
                    .map((shapeId) => parseNodeIdFromShapeId(shapeId))
                    .filter((nodeId): nodeId is string => nodeId !== null)
                const nextActiveNodeId = selectedNodeIds[0]

                if (selectedNodeIds.length === 0) {
                    isUserMultiSelectionRef.current = false
                    if (activeNodeIdRef.current !== null) {
                        setActiveNodeId(null)
                    }
                    return
                }

                if (selectedNodeIds.length > 1) {
                    // 框选或全选多个节点时 标记当前是多选态
                    isUserMultiSelectionRef.current = true

                    // 多选时尽量保留当前 active 节点
                    // 只有它已经不在当前选择集里 才切到第一个
                    if (
                        activeNodeIdRef.current !== null &&
                        selectedNodeIds.includes(activeNodeIdRef.current)
                    ) {
                        return
                    }

                    if (activeNodeIdRef.current !== nextActiveNodeId) {
                        setActiveNodeId(nextActiveNodeId)
                    }
                    return
                }

                isUserMultiSelectionRef.current = false
                if (activeNodeIdRef.current !== nextActiveNodeId) {
                    setActiveNodeId(nextActiveNodeId)
                }
            },
            { source: "user", scope: "session" },
        )

        return () => {
            unlisten()
        }
    }, [activeNodeIdRef, canvasEditor, isApplyingStoreToCanvasRef, isUserMultiSelectionRef, setActiveNodeId])

    // Backspace 删除语义动作映射
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Backspace") {
                return
            }
            if (isTextEditingTarget(event.target)) {
                return
            }

            const selectedShapeIds = canvasEditor.getSelectedShapeIds()
            // 从 getSelectedShapeIds 中过滤出卡片node
            const selectedNodeIds = selectedShapeIds
                .map((shapeId) => parseNodeIdFromShapeId(shapeId))
                .filter((nodeId): nodeId is string => nodeId !== null)

            const selectedArrowDescriptors = selectedShapeIds
                .map((shapeId) => parseCanvasArrowDescriptor(shapeId))
                .filter((descriptor): descriptor is NonNullable<typeof descriptor> => descriptor !== null)

            if (selectedNodeIds.length === 0 && selectedArrowDescriptors.length === 0) {
                return
            }

            event.preventDefault()
            event.stopPropagation()

            // 执行删除
            if (selectedNodeIds.length > 0) {
                deleteNodes(selectedNodeIds)
            }

            // 重新判断父链 reference 链 关系
            for (const arrowDescriptor of selectedArrowDescriptors) {
                if (arrowDescriptor.kind === "parent") {
                    setNodeParent(arrowDescriptor.childNodeId, null)
                    continue
                }

                const sourceNode = cardsRef.current.find(
                    (card) => card.id === arrowDescriptor.sourceNodeId,
                )
                if (!sourceNode) {
                    continue
                }

                setNodeReferences(
                    sourceNode.id,
                    (sourceNode.referenceNodeIds ?? []).filter(
                        (referenceNodeId) => referenceNodeId !== arrowDescriptor.targetNodeId,
                    ),
                )
            }

            // 选中 的nodes里包含activeNode 去除active
            if (
                activeNodeIdRef.current !== null &&
                selectedNodeIds.includes(activeNodeIdRef.current)
            ) {
                setActiveNodeId(null)
            }
        }

        window.addEventListener("keydown", handleKeyDown, true)
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true)
        }
    }, [
        activeNodeIdRef,
        canvasEditor,
        cardsRef,
        deleteNodes,
        setActiveNodeId,
        setNodeParent,
        setNodeReferences,
    ])

    /**
     * Ctrl/Cmd + Z / Y 快捷键统一路由到 Store 历史栈
     * 避免 tldraw 内部历史与业务历史双写冲突，保证撤回语义由业务层单点主导
     */
    useEffect(() => {
        const handleHistoryKeyDown = (event: KeyboardEvent) => {
            const isMetaPressed = event.metaKey || event.ctrlKey
            if (!isMetaPressed) {
                return
            }

            if (isTextEditingTarget(event.target)) {
                return
            }

            const normalizedKey = event.key.toLowerCase()
            const isUndoShortcut = normalizedKey === "z" && !event.shiftKey
            const isRedoShortcut =
                normalizedKey === "y" || (normalizedKey === "z" && event.shiftKey)

            if (!isUndoShortcut && !isRedoShortcut) {
                return
            }

            event.preventDefault()
            event.stopPropagation()

            /**
             * Store 是当前唯一业务历史源
             * 执行业务撤回前 先清空 tldraw 自己的内部历史
             */
            canvasEditor?.clearHistory()

            if (isUndoShortcut) {
                undo()
            }
            else {
                redo()
            }
        }

        window.addEventListener("keydown", handleHistoryKeyDown, true)
        return () => {
            window.removeEventListener("keydown", handleHistoryKeyDown, true)
        }
    }, [canvasEditor, redo, undo])

    // Ctrl/Cmd + A 全选画布业务图形（节点 + 关系箭头）
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        const handleSelectAllKeyDown = (event: KeyboardEvent) => {
            const isMetaPressed = event.metaKey || event.ctrlKey
            if (!isMetaPressed) {
                return
            }

            if (event.key.toLowerCase() !== "a") {
                return
            }

            if (isTextEditingTarget(event.target)) {
                return
            }

            event.preventDefault()
            event.stopPropagation()

            // 明确标记当前进入多选态 避免后续被单选同步覆盖
            isUserMultiSelectionRef.current = true
            const selectableShapeIds = canvasEditor
                .getCurrentPageShapes()
                .map((shape) => shape.id as TLShapeId)
                .filter(
                    (shapeId) =>
                        parseNodeIdFromShapeId(shapeId) !== null ||
                        parseCanvasArrowDescriptor(shapeId) !== null,
                )

            canvasEditor.setSelectedShapes(selectableShapeIds)
        }

        window.addEventListener("keydown", handleSelectAllKeyDown, true)
        return () => {
            window.removeEventListener("keydown", handleSelectAllKeyDown, true)
        }
    }, [canvasEditor, isUserMultiSelectionRef])

    /**
     * 业务场景 节点拖拽结束后 把新坐标提交回 Store
     */
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        const handlePointerUp = () => {
            if (isApplyingStoreToCanvasRef.current) {
                return
            }

            const selectedNodeIds = canvasEditor
                .getSelectedShapeIds()
                .map((shapeId) => parseNodeIdFromShapeId(shapeId))
                .filter((nodeId): nodeId is string => nodeId !== null)

            for (const selectedNodeId of selectedNodeIds) {
                const selectedShape = canvasEditor.getShape(toCanvasNodeShapeId(selectedNodeId))
                const sourceNode = cardsRef.current.find((card) => card.id === selectedNodeId)

                if (!selectedShape || !sourceNode) {
                    continue
                }

                if (
                    selectedShape.x === sourceNode.position.x &&
                    selectedShape.y === sourceNode.position.y
                ) {
                    continue
                }

                moveNode(selectedNodeId, {
                    x: selectedShape.x,
                    y: selectedShape.y,
                })
            }
        }

        window.addEventListener("pointerup", handlePointerUp, true)
        return () => {
            window.removeEventListener("pointerup", handlePointerUp, true)
        }
    }, [canvasEditor, cardsRef, isApplyingStoreToCanvasRef, moveNode])

    /**
     * 拖拽已经存在的箭头端点之后 吸附到8个锚点上 并进行存储记录用户自定的连接锚点
     */
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        const handleArrowPointerUp = () => {
            if (isApplyingStoreToCanvasRef.current) {
                return
            }

            const selectedArrowIds = canvasEditor
                .getSelectedShapeIds()
                .filter(
                    (shapeId): shapeId is TLShapeId => parseCanvasArrowDescriptor(shapeId) !== null,
                )

            if (selectedArrowIds.length === 0) {
                return
            }

            const nextOverrideById = new Map(arrowAnchorOverrideByIdRef.current)
            for (const selectedArrowId of selectedArrowIds) {
                const bindings = canvasEditor.getBindingsFromShape(selectedArrowId, "arrow")
                const startBinding = bindings.find((binding) => binding.props.terminal === "start")
                const endBinding = bindings.find((binding) => binding.props.terminal === "end")

                if (!startBinding || !endBinding) {
                    continue
                }

                nextOverrideById.set(selectedArrowId, {
                    sourceSide: closestAnchorSideToNormalizedAnchor(startBinding.props.normalizedAnchor),
                    targetSide: closestAnchorSideToNormalizedAnchor(endBinding.props.normalizedAnchor),
                })
            }

            // 保存拖拽之后得到的锚点覆盖值
            arrowAnchorOverrideByIdRef.current = nextOverrideById

            // 按新的锚点重新计算所有箭头投影
            const projectionById = new Map(
                createStableArrowProjections(
                    cardsRef.current,
                    nextOverrideById,
                ).map((projection) => [projection.id, projection]),
            )

            // 再把新的投影结果写回画布
            canvasEditor.run(() => {
                for (const selectedArrowId of selectedArrowIds) {
                    const projection = projectionById.get(selectedArrowId)
                    if (projection) {
                        syncStableArrowProjection(canvasEditor, projection)
                    }
                }
            }, { history: "ignore" })
        }

        window.addEventListener("pointerup", handleArrowPointerUp, true)
        return () => {
            window.removeEventListener("pointerup", handleArrowPointerUp, true)
        }
    }, [
        arrowAnchorOverrideByIdRef,
        canvasEditor,
        cardsRef,
        isApplyingStoreToCanvasRef,
        syncStableArrowProjection,
    ])

    /**
     * 组件卸载时 清理临时指针监听和拖拽会话
     */
    useEffect(() => {
        return () => {
            clearPointerListeners()
            linkDragSessionRef.current = null
        }
    }, [clearPointerListeners, linkDragSessionRef])
}
