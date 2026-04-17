import { useEffect, type MutableRefObject } from "react"
import type { Editor, TLShapeId } from "tldraw"
import type { ConversationCard, ConversationNodeType } from "../domain/conversation/types"
import { parseCanvasArrowDescriptor, parseNodeIdFromShapeId, toCanvasNodeShapeId } from "./canvasNodeIds"
import {
    type ArrowAnchorOverride,
    closestAnchorSideToNormalizedAnchor,
    createStableArrowProjections,
    isTextEditingTarget,
    type LinkDragSession,
    type Point,
} from "./useCanvasBridge.helpers"
import { type syncStableArrowProjection as SyncStableArrowProjectionFn } from "./useCanvasBridge.projection"

interface UseCanvasBridgeInteractionsParams {
    canvasEditor: Editor | null
    isApplyingStoreToCanvasRef: MutableRefObject<boolean> // 是否已经同步
    activeNodeIdRef: MutableRefObject<string | null>
    cardsRef: MutableRefObject<ConversationCard[]>
    selectedCreationTypeRef: MutableRefObject<ConversationNodeType>
    linkDragSessionRef: MutableRefObject<LinkDragSession | null>
    arrowAnchorOverrideByIdRef: MutableRefObject<Map<TLShapeId, ArrowAnchorOverride>>
    clearPointerListeners: () => void
    createNodeByType: (
        cardType: ConversationNodeType,
        position: Point,
        parentId?: string | null,
    ) => string
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
 * Canvas 交互适配器（交互事件 -> 业务动作的翻译层）
 * 监听画布内部的碎片化操作（按键、拖拽松手、tldraw 默认事件）
 * 翻译为领域限界内的原子型业务动作，并通过依赖注入（传入的回调函数）向上层触发处理
 */
export function useCanvasBridgeInteractions({
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
}: UseCanvasBridgeInteractionsParams) {

    // 禁用 tldraw 的默认双击空白创建 text，改为创建当前选中卡片类型
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        // registerAfterCreateHandler 为 每一次新建一参类型shape的时间 调用二参函数
        const unregister = canvasEditor.sideEffects.registerAfterCreateHandler(
            "shape",
            (shape, source) => {
                // 拦截非用户的 和 非text类型的 shape创建
                // text类型shape创建是鼠标双击 这里做拦截 在双击的地方创建卡片 并设置为active
                if (source !== "user" || shape.type !== "text") {
                    return
                }

                const textShapeId = shape.id
                const createdNodeId = createNodeByType(
                    selectedCreationTypeRef.current,
                    { x: shape.x, y: shape.y },
                    null,
                )
                setActiveNodeId(createdNodeId)

                canvasEditor.run(() => {
                    // 强制鼠标失焦
                    if (canvasEditor.getEditingShapeId() === textShapeId) {
                        canvasEditor.setEditingShape(null)
                    }
                    if (canvasEditor.getShape(textShapeId)) {
                        canvasEditor.deleteShapes([textShapeId])
                    }
                }, { history: "ignore" })
            },
        )
        return () => {
            unregister()
        }
    }, [canvasEditor, selectedCreationTypeRef, createNodeByType, setActiveNodeId])

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

                // 获取选中/框选的nodes 同时根据框选的nodes 设置activeNodeId = node[0]
                const selectedNodeIds = canvasEditor
                    .getSelectedShapeIds()
                    .map((shapeId) => parseNodeIdFromShapeId(shapeId))
                    .filter((nodeId): nodeId is string => nodeId !== null)
                const nextActiveNodeId = selectedNodeIds[0]

                if (selectedNodeIds.length === 0) {
                    if (activeNodeIdRef.current !== null) {
                        setActiveNodeId(null)
                    }
                    return
                }

                if (activeNodeIdRef.current !== nextActiveNodeId) {
                    setActiveNodeId(nextActiveNodeId)
                }
            },
            { source: "user", scope: "session" },
        )

        return () => {
            unlisten()
        }
    }, [activeNodeIdRef, canvasEditor, isApplyingStoreToCanvasRef, setActiveNodeId])

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
             * Store 已经是唯一历史源。
             * 用户拖拽/创建节点后，tldraw 内部仍可能累积自己的编辑历史；
             * 在真正执行业务 undo/redo 前先清空它，避免再次出现双历史栈错位
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

    /**
     * 节点拖拽结束 pointerup 时 新坐标写回 Store
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

            // 存储用户移动之后的锚点
            arrowAnchorOverrideByIdRef.current = nextOverrideById

            // 计算出所有应该绘制的箭头
            const projectionById = new Map(
                createStableArrowProjections(
                    cardsRef.current,
                    nextOverrideById,
                ).map((projection) => [projection.id, projection]),
            )

            // 使用计算出的箭头projection进行绘制
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
     * 组件卸载时清理运行时资源
     */
    useEffect(() => {
        return () => {
            clearPointerListeners()
            linkDragSessionRef.current = null
        }
    }, [clearPointerListeners, linkDragSessionRef])
}
