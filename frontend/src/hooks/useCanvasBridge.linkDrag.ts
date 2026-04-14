import { useCallback, type MutableRefObject } from "react"
import { Editor, TLShapeId, createShapeId } from "tldraw"
import { DEFAULT_CARD_MIN_HEIGHT, DEFAULT_CARD_WIDTH } from "../domain/conversation/constants"
import type { ConversationCard } from "../domain/conversation/types"
import { type ForkMindCardShape, FORK_MIND_CARD_SHAPE_TYPE } from "../lib/forkMindCardShape"
import { type StartLinkDragInput } from "./canvasLinkTypes"
import { parseNodeIdFromShapeId } from "./canvasNodeIds"
import {
    anchorBySide,
    appendReferenceId,
    closestAnchorSideToPoint,
    computeArrowBend,
    edgePointBySide,
    getDefaultHeightByType,
    GHOST_NODE_OPACITY_VISIBLE,
    ghostPositionByPointer,
    type LinkDragSession,
    oppositeSide,
    type Point,
} from "./useCanvasBridge.helpers"
import {
    type ArrowShapePreviewPartial,
    deleteDragPreviewShapes,
    type ForkMindCardShapePartial,
    syncArrowBinding,
} from "./useCanvasBridge.projection"

export type CreationNodeType = "chat" | "note"

interface UseCanvasBridgeLinkDragParams {
    canvasEditor: Editor | null
    cardsRef: MutableRefObject<ConversationCard[]>
    selectedCreationTypeRef: MutableRefObject<CreationNodeType>
    linkDragSessionRef: MutableRefObject<LinkDragSession | null>
    removePointerListenersRef: MutableRefObject<(() => void) | null>
    clearPointerListeners: () => void
    createNodeByType: (
        cardType: CreationNodeType,
        position: Point,
        parentId?: string | null,
    ) => string
    setActiveNodeId: (nodeId: string | null) => void
    setNodeReferences: (nodeId: string, referenceNodeIds: string[]) => void
}

interface UseCanvasBridgeLinkDragResult {
    handleLinkHandlePointerDown: (input: StartLinkDragInput) => void
    cancelLinkDrag: (editor: Editor) => void
}

/**
 * 连线拖拽状态机（可类比 Nuxt composable 的高频交互命令层）。
 * 业务场景：统一管理“从卡片 handle 拖出关系线”的整条生命周期，避免主 bridge 文件继续膨胀。
 */
export function useCanvasBridgeLinkDrag({
    canvasEditor,
    cardsRef,
    selectedCreationTypeRef,
    linkDragSessionRef,
    removePointerListenersRef,
    clearPointerListeners,
    createNodeByType,
    setActiveNodeId,
    setNodeReferences,
}: UseCanvasBridgeLinkDragParams): UseCanvasBridgeLinkDragResult {
    /**
     * 取消一次进行中的拖拽连线会话。
     * 业务场景：用户按 Esc 明确放弃本次拖拽时，只清理临时预览，不写入业务关系。
     */
    const cancelLinkDrag = useCallback((editor: Editor) => {
        const session = linkDragSessionRef.current
        if (!session) {
            return
        }

        editor.run(() => {
            deleteDragPreviewShapes(editor, session)
        }, { history: "ignore" })

        linkDragSessionRef.current = null
    }, [linkDragSessionRef])

    /**
     * 更新拖拽中的临时箭头与幽灵卡片。
     * 业务场景：pointermove 高频事件只走 tldraw 内部 shape 更新，不把帧级坐标写入 Zustand。
     */
    const updateLinkDragPreview = useCallback((editor: Editor, pointerPoint: Point) => {
        const session = linkDragSessionRef.current
        if (!session) {
            return
        }

        session.releasePoint = pointerPoint

        const snapTargetShape = editor.getShapeAtPoint(pointerPoint, {
            hitInside: true,
            margin: 18,
            filter: (shape) => {
                const shapeId = shape.id as TLShapeId
                if (shapeId === session.sourceShapeId || shapeId === session.arrowShapeId) {
                    return false
                }
                if (shapeId === session.ghostShapeId) {
                    return false
                }
                return parseNodeIdFromShapeId(shapeId) !== null
            },
        })

        const sourceBounds = editor.getShapePageBounds(session.sourceShapeId)
        const isPointerInsideSourceNode =
            sourceBounds !== undefined &&
            pointerPoint.x >= sourceBounds.minX &&
            pointerPoint.x <= sourceBounds.maxX &&
            pointerPoint.y >= sourceBounds.minY &&
            pointerPoint.y <= sourceBounds.maxY

        if (isPointerInsideSourceNode) {
            session.snappedTargetShapeId = null
            session.snappedTargetNodeId = null

            const arrowUpdate: ArrowShapePreviewPartial = {
                id: session.arrowShapeId,
                type: "arrow",
                props: {
                    end: { x: 0, y: 0 },
                    bend: 0,
                },
            }

            editor.run(() => {
                if (editor.getShape(session.ghostShapeId)) {
                    editor.deleteShapes([session.ghostShapeId])
                }
                const previewUpdates = [arrowUpdate] as unknown as Parameters<Editor["updateShapes"]>[0]
                editor.updateShapes(previewUpdates)
            }, { history: "ignore" })
            return
        }

        if (snapTargetShape) {
            const targetShapeId = snapTargetShape.id as TLShapeId
            const targetNodeId = parseNodeIdFromShapeId(targetShapeId)
            const targetBounds = editor.getShapePageBounds(targetShapeId)

            if (!targetNodeId || !targetBounds) {
                return
            }

            const targetSide = closestAnchorSideToPoint(pointerPoint, targetBounds)
            const targetPoint = edgePointBySide(targetBounds, targetSide)

            session.snappedTargetShapeId = targetShapeId
            session.snappedTargetNodeId = targetNodeId

            const arrowUpdate: ArrowShapePreviewPartial = {
                id: session.arrowShapeId,
                type: "arrow",
                props: {
                    end: {
                        x: targetPoint.x - session.startPoint.x,
                        y: targetPoint.y - session.startPoint.y,
                    },
                    bend: computeArrowBend(session.startPoint, targetPoint),
                },
            }

            editor.run(() => {
                if (editor.getShape(session.ghostShapeId)) {
                    editor.deleteShapes([session.ghostShapeId])
                }
                const previewUpdates = [arrowUpdate] as unknown as Parameters<Editor["updateShapes"]>[0]
                editor.updateShapes(previewUpdates)
            }, { history: "ignore" })
            return
        }

        session.snappedTargetShapeId = null
        session.snappedTargetNodeId = null

        const ghostAttachSide = oppositeSide(session.sourceSide)
        const ghostPosition = ghostPositionByPointer(
            pointerPoint,
            ghostAttachSide,
            DEFAULT_CARD_WIDTH,
            session.ghostHeight,
        )

        const arrowUpdate: ArrowShapePreviewPartial = {
            id: session.arrowShapeId,
            type: "arrow",
            props: {
                end: {
                    x: pointerPoint.x - session.startPoint.x,
                    y: pointerPoint.y - session.startPoint.y,
                },
                bend: computeArrowBend(session.startPoint, pointerPoint),
            },
        }

        editor.run(() => {
            if (!editor.getShape(session.ghostShapeId)) {
                const ghostShape = {
                    id: session.ghostShapeId,
                    type: FORK_MIND_CARD_SHAPE_TYPE,
                    x: ghostPosition.x,
                    y: ghostPosition.y,
                    opacity: GHOST_NODE_OPACITY_VISIBLE,
                    props: {
                        w: DEFAULT_CARD_WIDTH,
                        h: session.ghostHeight,
                        cardType: session.ghostCardType,
                        userPrompt: "",
                        aiResponse: "",
                        noteContent: "",
                    },
                } as unknown as Parameters<Editor["createShape"]>[0]
                editor.createShape(ghostShape)
            } else {
                const ghostUpdate: ForkMindCardShapePartial = {
                    id: session.ghostShapeId,
                    type: FORK_MIND_CARD_SHAPE_TYPE,
                    x: ghostPosition.x,
                    y: ghostPosition.y,
                    opacity: GHOST_NODE_OPACITY_VISIBLE,
                }

                const previewUpdates = [arrowUpdate, ghostUpdate] as unknown as Parameters<
                    Editor["updateShapes"]
                >[0]
                editor.updateShapes(previewUpdates)
                return
            }

            const previewUpdates = [arrowUpdate] as unknown as Parameters<Editor["updateShapes"]>[0]
            editor.updateShapes(previewUpdates)
        }, { history: "ignore" })
    }, [linkDragSessionRef])

    /**
     * 松手结算拖拽。
     * 业务场景：
     * - 连到已有卡片：追加 reference
     * - 松在空白处：创建新节点并建立 parent 主链
     */
    const resolveLinkDrag = useCallback((editor: Editor) => {
        const session = linkDragSessionRef.current
        if (!session) {
            return
        }

        if (session.snappedTargetNodeId) {
            const sourceNode = cardsRef.current.find((node) => node.id === session.sourceNodeId)
            if (sourceNode) {
                setNodeReferences(
                    session.sourceNodeId,
                    appendReferenceId(sourceNode, session.snappedTargetNodeId),
                )
            }

            setActiveNodeId(session.snappedTargetNodeId)

            editor.run(() => {
                deleteDragPreviewShapes(editor, session)
            }, { history: "ignore" })

            linkDragSessionRef.current = null
            return
        }

        const ghostShape = editor.getShape(session.ghostShapeId) as ForkMindCardShape | undefined
        const newNodePosition = ghostShape
            ? { x: ghostShape.x, y: ghostShape.y }
            : {
                x: session.releasePoint.x - DEFAULT_CARD_WIDTH / 2,
                y: session.releasePoint.y - DEFAULT_CARD_MIN_HEIGHT / 2,
            }

        const createdNodeId = createNodeByType(
            session.ghostCardType,
            newNodePosition,
            session.sourceNodeId,
        )
        setActiveNodeId(createdNodeId)

        editor.run(() => {
            deleteDragPreviewShapes(editor, session)
        }, { history: "ignore" })

        linkDragSessionRef.current = null
    }, [cardsRef, createNodeByType, linkDragSessionRef, setActiveNodeId, setNodeReferences])

    /**
     * 从 hover 触点开始拖拽连线。
     * 业务场景：用户无需切换工具，直接从卡片边缘拖出关系。
     */
    const handleLinkHandlePointerDown = useCallback((input: StartLinkDragInput) => {
        if (!canvasEditor) {
            return
        }

        clearPointerListeners()

        const sourceNodeId = parseNodeIdFromShapeId(input.sourceShapeId)
        if (!sourceNodeId) {
            return
        }

        const sourceBounds = canvasEditor.getShapePageBounds(input.sourceShapeId)
        if (!sourceBounds) {
            return
        }

        const currentCreationType = selectedCreationTypeRef.current
        const currentGhostHeight = getDefaultHeightByType(currentCreationType)

        const startPoint = edgePointBySide(sourceBounds, input.side)
        const initialPointerPoint = canvasEditor.screenToPage({
            x: input.clientX,
            y: input.clientY,
        })
        const ghostAttachSide = oppositeSide(input.side)
        const initialGhostPosition = ghostPositionByPointer(
            initialPointerPoint,
            ghostAttachSide,
            DEFAULT_CARD_WIDTH,
            currentGhostHeight,
        )

        const arrowShapeId = createShapeId()
        const ghostShapeId = createShapeId()

        canvasEditor.run(() => {
            canvasEditor.createShape({
                id: arrowShapeId,
                type: "arrow",
                x: startPoint.x,
                y: startPoint.y,
                props: {
                    kind: "arc",
                    color: "blue",
                    dash: "solid",
                    size: "m",
                    arrowheadStart: "none",
                    arrowheadEnd: "triangle",
                    start: { x: 0, y: 0 },
                    end: {
                        x: initialPointerPoint.x - startPoint.x,
                        y: initialPointerPoint.y - startPoint.y,
                    },
                    bend: computeArrowBend(startPoint, initialPointerPoint),
                },
            })

            syncArrowBinding(
                canvasEditor,
                arrowShapeId,
                "start",
                input.sourceShapeId,
                anchorBySide(input.side),
            )

            const ghostShape = {
                id: ghostShapeId,
                type: FORK_MIND_CARD_SHAPE_TYPE,
                x: initialGhostPosition.x,
                y: initialGhostPosition.y,
                opacity: GHOST_NODE_OPACITY_VISIBLE,
                props: {
                    w: DEFAULT_CARD_WIDTH,
                    h: currentGhostHeight,
                    cardType: currentCreationType,
                    userPrompt: "",
                    aiResponse: "",
                    noteContent: "",
                },
            } as unknown as Parameters<Editor["createShape"]>[0]

            canvasEditor.createShape(ghostShape)
            canvasEditor.setSelectedShapes([])
        }, { history: "ignore" })

        linkDragSessionRef.current = {
            sourceShapeId: input.sourceShapeId,
            sourceNodeId,
            sourceSide: input.side,
            startPoint,
            arrowShapeId,
            ghostShapeId,
            ghostCardType: currentCreationType,
            ghostHeight: currentGhostHeight,
            snappedTargetShapeId: null,
            snappedTargetNodeId: null,
            releasePoint: initialPointerPoint,
        }

        updateLinkDragPreview(canvasEditor, initialPointerPoint)

        const handlePointerMove = (event: PointerEvent) => {
            const pointerPoint = canvasEditor.screenToPage({
                x: event.clientX,
                y: event.clientY,
            })
            updateLinkDragPreview(canvasEditor, pointerPoint)
        }

        const handlePointerUp = () => {
            clearPointerListeners()
            resolveLinkDrag(canvasEditor)
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return
            }

            event.preventDefault()
            event.stopPropagation()
            clearPointerListeners()
            cancelLinkDrag(canvasEditor)
        }

        window.addEventListener("pointermove", handlePointerMove, true)
        window.addEventListener("pointerup", handlePointerUp, true)
        window.addEventListener("keydown", handleKeyDown, true)

        removePointerListenersRef.current = () => {
            window.removeEventListener("pointermove", handlePointerMove, true)
            window.removeEventListener("pointerup", handlePointerUp, true)
            window.removeEventListener("keydown", handleKeyDown, true)
        }
    }, [
        canvasEditor,
        cancelLinkDrag,
        clearPointerListeners,
        linkDragSessionRef,
        removePointerListenersRef,
        resolveLinkDrag,
        selectedCreationTypeRef,
        updateLinkDragPreview,
    ])

    return {
        handleLinkHandlePointerDown,
        cancelLinkDrag,
    }
}
