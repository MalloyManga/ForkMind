import { useCallback, type MutableRefObject } from "react"
import { Editor, TLShapeId, createShapeId } from "tldraw"
import { DEFAULT_CARD_MIN_HEIGHT, DEFAULT_CARD_WIDTH } from "../domain/conversation/constants"
import type { ConversationCard, ConversationNodeType } from "../domain/conversation/types"
import { type ForkMindCardShape, FORK_MIND_CARD_SHAPE_TYPE } from "../lib/forkMindCardShape"
import { assertNever } from "../lib/utils"
import { type LinkDragRelationKind, type StartLinkDragInput } from "./canvasLinkTypes"
import type { CanvasTool } from "./canvasToolTypes"
import { isCreationCanvasTool } from "./canvasToolTypes"
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

interface UseCanvasBridgeLinkDragParams {
    canvasEditor: Editor | null
    cardsRef: MutableRefObject<ConversationCard[]>
    currentCanvasToolRef: MutableRefObject<CanvasTool> // 当前的 canvasTool 状态
    linkDragSessionRef: MutableRefObject<LinkDragSession | null>
    removePointerListenersRef: MutableRefObject<(() => void) | null>
    clearPointerListeners: () => void
    commitNodeCreation: (input: {
        cardType: ConversationNodeType
        position: Point
        parentId?: string | null
        size?: { width?: number; minHeight?: number }
    }) => string
    setNodeParent: (nodeId: string, parentId: string | null) => void
    setNodeReferences: (nodeId: string, referenceNodeIds: string[]) => void
}

interface UseCanvasBridgeLinkDragResult {
    handleLinkHandlePointerDown: (input: StartLinkDragInput) => void
    cancelLinkDrag: (editor: Editor) => void
}

function createGhostCardContentProps(cardType: ConversationNodeType) {
    switch (cardType) {
        case "chat":
            return { cardType, userPrompt: "", aiResponse: "" }
        case "note":
            return { cardType, noteContent: "" }
        case "image":
            return {
                cardType,
                assetId: "",
                assetName: "",
                assetMimeType: "",
                assetSizeBytes: 0,
                caption: "",
                altText: "",
            }
        case "link":
            return { cardType, url: "", title: "", description: "" }
        case "file":
            return {
                cardType,
                assetName: "",
                assetMimeType: "",
                assetSizeBytes: 0,
                description: "",
            }
    }

    return assertNever(cardType)
}

/**
 * 根据 LinkKind 获取到对应的 style
 */
function createPreviewArrowStyle(relationKind: LinkDragRelationKind): {
    color: "blue" | "grey"
    dash: "solid" | "dashed"
} {
    return relationKind === "parent"
        ? { color: "blue", dash: "solid" }
        : { color: "grey", dash: "dashed" }
}

/**
 * 负责从锚点拖拽出箭头之后的 "幽灵卡片" 过程状态处理
 */
export function useCanvasBridgeLinkDrag({
    canvasEditor,
    cardsRef,
    currentCanvasToolRef,
    linkDragSessionRef,
    removePointerListenersRef,
    clearPointerListeners,
    commitNodeCreation,
    setNodeParent,
    setNodeReferences,
}: UseCanvasBridgeLinkDragParams): UseCanvasBridgeLinkDragResult {

    /**
     * 取消一次进行中的拖拽连线会话
     * 用户按 Esc 明确放弃本次拖拽时 只清理临时预览 不写入业务关系
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
     * 高频更新拖拽中的临时箭头与幽灵卡片
     * 不写入 Zustand 直接操作 tldraw
     * 1. 鼠标在起点节点内：隐藏幽灵卡片，箭头缩回至 0。
     * 2. 鼠标悬停在其他具有业务意义的节点上：触发吸附（Snap），删除幽灵卡片，箭头指向目标边缘。
     * 3. 鼠标在空白画布上：显示/更新幽灵卡片，使其始终跟随鼠标移动，箭头顺延到鼠标。
     */
    const updateLinkDragPreview = useCallback((editor: Editor, pointerPoint: Point) => {
        /**
         * 当前正在拖拽出的箭头对象的快照
         * 仅服务于这一次拖拽 拖拽结束之后就消失
         */
        const session = linkDragSessionRef.current
        if (!session) {
            return
        }

        // 高频更新最终释放点 供松开鼠标后的 mouseup 结算阶段使用
        session.releasePoint = pointerPoint
        /**
         * session 里取出 pointerdown 时写入的 relationKind
         * 生成对应的 style
         */
        const previewArrowStyle = createPreviewArrowStyle(session.relationKind)

        // 1：利用 tldraw 提供的物理射线检测 (Raycasting)
        // 找出鼠标当前位置下，除了[起点本身]、[当前箭头]、[当前幽灵卡片]之外的第一个合法业务节点
        const snapTargetShape = editor.getShapeAtPoint(pointerPoint, {
            hitInside: true,
            margin: 18, // 增加吸附容差，不至于非要鼠标进入到节点正上方才能吸附住
            filter: (shape) => {
                const shapeId = shape.id as TLShapeId
                if (shapeId === session.sourceShapeId || shapeId === session.arrowShapeId) {
                    return false
                }
                if (shapeId === session.ghostShapeId) {
                    return false
                }
                // 确保它是一个由业务创建出来的具有真实 node ID 的节点
                return parseNodeIdFromShapeId(shapeId) !== null
            },
        })

        // 2：判断用户是否把鼠标又退回到了出发点的内部
        const sourceBounds = editor.getShapePageBounds(session.sourceShapeId)
        const isPointerInsideSourceNode =
            sourceBounds !== undefined &&
            pointerPoint.x >= sourceBounds.minX &&
            pointerPoint.x <= sourceBounds.maxX &&
            pointerPoint.y >= sourceBounds.minY &&
            pointerPoint.y <= sourceBounds.maxY

        // ================= 分支 1：鼠标退回起点 =================
        if (isPointerInsideSourceNode) {
            session.snappedTargetShapeId = null
            session.snappedTargetNodeId = null

            const arrowUpdate: ArrowShapePreviewPartial = {
                id: session.arrowShapeId,
                type: "arrow",
                props: {
                    ...previewArrowStyle,
                    end: { x: 0, y: 0 }, // 长短归零（注意 tldraw 的 end 是相对起点的坐标偏差）
                    bend: 0, // 取消曲线的弯曲度
                },
            }

            editor.run(() => {
                // 退回起点了就不应该看到要生成新卡片的幽灵卡片了，销毁它
                if (editor.getShape(session.ghostShapeId)) {
                    editor.deleteShapes([session.ghostShapeId])
                }
                const previewUpdates = [arrowUpdate] as unknown as Parameters<Editor["updateShapes"]>[0]
                editor.updateShapes(previewUpdates)
            }, { history: "ignore" })
            return
        }

        // ================= 分支 2：鼠标悬停在其他业务节点上方（吸附态） =================
        if (snapTargetShape) {
            const targetShapeId = snapTargetShape.id as TLShapeId
            const targetNodeId = parseNodeIdFromShapeId(targetShapeId)
            const targetBounds = editor.getShapePageBounds(targetShapeId)

            if (!targetNodeId || !targetBounds) {
                return
            }

            // 计算目标节点上离当前鼠标最近的吸附面（上/下/左/右）
            const targetSide = closestAnchorSideToPoint(pointerPoint, targetBounds)
            const targetPoint = edgePointBySide(targetBounds, targetSide)

            session.snappedTargetShapeId = targetShapeId
            session.snappedTargetNodeId = targetNodeId

            const arrowUpdate: ArrowShapePreviewPartial = {
                id: session.arrowShapeId,
                type: "arrow",
                props: {
                    ...previewArrowStyle,
                    end: {
                        x: targetPoint.x - session.startPoint.x, // 更新箭头终止点的相对坐标
                        y: targetPoint.y - session.startPoint.y,
                    },
                    bend: computeArrowBend(session.startPoint, targetPoint), // 根据两点距离计算出弹性贝塞尔曲线弧度
                },
            }

            editor.run(() => {
                // 吸附到已有节点的情况属于「关联」，不属于新建连线，所以必须把之前创建出的临时幽灵卡片删掉
                if (editor.getShape(session.ghostShapeId)) {
                    editor.deleteShapes([session.ghostShapeId])
                }
                const previewUpdates = [arrowUpdate] as unknown as Parameters<Editor["updateShapes"]>[0]
                editor.updateShapes(previewUpdates)
            }, { history: "ignore" })
            return
        }

        // ================= 分支 3：鼠标悬浮在没人的空白画布上（新建预创建态） =================
        session.snappedTargetShapeId = null
        session.snappedTargetNodeId = null

        if (!session.ghostCardType || session.ghostHeight === null) {
            const arrowUpdate: ArrowShapePreviewPartial = {
                id: session.arrowShapeId,
                type: "arrow",
                props: {
                    ...previewArrowStyle,
                    end: {
                        x: pointerPoint.x - session.startPoint.x,
                        y: pointerPoint.y - session.startPoint.y,
                    },
                    bend: computeArrowBend(session.startPoint, pointerPoint),
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

        const ghostAttachSide = oppositeSide(session.sourceSide)
        /**
         * 高频计算出的幽灵卡片左上角位置
         */
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
                ...previewArrowStyle,
                end: {
                    x: pointerPoint.x - session.startPoint.x,
                    y: pointerPoint.y - session.startPoint.y,
                },
                bend: computeArrowBend(session.startPoint, pointerPoint),
            },
        }

        editor.run(() => {
            // 如果原本处于分支1/分支2，幽灵卡片可能已经被销毁了，这里我们就必须重新按预设生成一个
            if (!editor.getShape(session.ghostShapeId)) {
                const ghostShape = {
                    id: session.ghostShapeId,
                    type: FORK_MIND_CARD_SHAPE_TYPE,
                    x: ghostPosition.x,
                    y: ghostPosition.y,
                    opacity: GHOST_NODE_OPACITY_VISIBLE, // 半透明材质
                    props: {
                        nodeId: "preview",
                        w: DEFAULT_CARD_WIDTH,
                        h: session.ghostHeight,
                        ...createGhostCardContentProps(session.ghostCardType!),
                    },
                } as unknown as Parameters<Editor["createShape"]>[0]
                editor.createShape(ghostShape)
            } else {
                // 这里高频更新幽灵卡片位置
                // 如果幽灵卡片一直在存活，我们只修改它的XY坐标让他跟随鼠标跑路做位移
                const ghostUpdate: ForkMindCardShapePartial = {
                    id: session.ghostShapeId,
                    type: FORK_MIND_CARD_SHAPE_TYPE,
                    x: ghostPosition.x,
                    y: ghostPosition.y,
                    opacity: GHOST_NODE_OPACITY_VISIBLE,
                }

                const previewUpdates = [arrowUpdate, ghostUpdate] as unknown as Parameters<Editor["updateShapes"]>[0]
                editor.updateShapes(previewUpdates)
                return // 提前 return 避免下方重复执行 updateShapes
            }

            // 只有当上面走的是创建的分支时，才需要这里把新建出来的形状补一个箭头更新进去
            const previewUpdates = [arrowUpdate] as unknown as Parameters<Editor["updateShapes"]>[0]
            editor.updateShapes(previewUpdates)
        }, { history: "ignore" })
    }, [linkDragSessionRef])

    /**
     * 结算阶段 (MouseUp / Commit)
     * 松手结算拖拽。负责处理结果并写入真实业务状态（Zustand）
     * - 连到已有卡片：调用 setNodeReferences 追加关系
     * - 松在空白处：调用 createNodeByType 发起创建新节点的业务动作
     * 结算完后，清理掉所有的临时渲染形状 (deleteDragPreviewShapes)
     */
    const resolveLinkDrag = useCallback((editor: Editor) => {
        const session = linkDragSessionRef.current
        if (!session) {
            return
        }

        if (session.snappedTargetNodeId) {
            if (session.relationKind === "parent") {
                setNodeParent(session.snappedTargetNodeId, session.sourceNodeId)
            } else {
                const sourceNode = cardsRef.current.find((node) => node.id === session.sourceNodeId)
                if (sourceNode) {
                    setNodeReferences(
                        session.sourceNodeId,
                        appendReferenceId(sourceNode, session.snappedTargetNodeId),
                    )
                }
            }

            editor.run(() => {
                deleteDragPreviewShapes(editor, session)
            }, { history: "ignore" })

            linkDragSessionRef.current = null
            return
        }

        if (
            // reference 拖拽到空白处并不创建卡片 直接 delete 幽灵卡片 parent 不经过这里 先创建卡片之后再 delete
            session.relationKind === "reference" ||
            !session.ghostCardType ||
            session.ghostHeight === null
        ) {
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

        // 正式创建卡片
        commitNodeCreation({
            cardType: session.ghostCardType,
            position: newNodePosition,
            parentId: session.sourceNodeId,
            size: {
                width: DEFAULT_CARD_WIDTH,
                minHeight: session.ghostHeight,
            },
        })

        editor.run(() => {
            deleteDragPreviewShapes(editor, session)
        }, { history: "ignore" })

        linkDragSessionRef.current = null
    }, [cardsRef, commitNodeCreation, linkDragSessionRef, setNodeParent, setNodeReferences])

    /**
     * 从 hover 触点开始拖拽连线
     * 从节点的锚点（小圆圈）按下鼠标开始拖拽时触发
     * 1. 拦截接管原生事件
     * 2. 在 tldraw 中立刻生成一条临时射线（箭头）和一个假的幽灵卡片
     * 3. 给浏览器的全局 window 挂载 mousemove / mouseup / esc 的监听器，从而驱动上面定义的另外三个生命周期函数
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

        // 得到源node的box对象 
        const sourceBounds = canvasEditor.getShapePageBounds(input.sourceShapeId)
        if (!sourceBounds) {
            return
        }

        const currentCanvasTool = currentCanvasToolRef.current
        if (currentCanvasTool === "hand-tool") {
            return
        }

        const currentCreationType = isCreationCanvasTool(currentCanvasTool) ? currentCanvasTool : null
        const relationKind: LinkDragRelationKind = currentCreationType ? "parent" : "reference"
        const currentGhostHeight = currentCreationType ? getDefaultHeightByType(currentCreationType) : null

        const startPoint = edgePointBySide(sourceBounds, input.side)
        const initialPointerPoint = canvasEditor.screenToPage({ // 计算出画布page上的绝对坐标
            x: input.clientX,
            y: input.clientY,
        })
        const ghostAttachSide = oppositeSide(input.side)
        /**
         * 当前的幽灵卡片存在高度时获取左上角的位置坐标
         */
        const initialGhostPosition = currentGhostHeight === null
            ? null
            : ghostPositionByPointer(
                initialPointerPoint,
                ghostAttachSide,
                DEFAULT_CARD_WIDTH,
                currentGhostHeight,
            )

        // 创建出幽灵箭头与幽灵卡片
        const arrowShapeId = createShapeId()
        const ghostShapeId = createShapeId()
        const previewArrowStyle = createPreviewArrowStyle(relationKind)

        canvasEditor.run(() => {
            canvasEditor.createShape({
                id: arrowShapeId,
                type: "arrow",
                x: startPoint.x,
                y: startPoint.y,
                props: {
                    kind: "arc",
                    ...previewArrowStyle, // 根据当前的 canvasTool 来对应不同的 arrow UI
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

            // 创建ghostShape 
            if (currentCreationType && currentGhostHeight !== null && initialGhostPosition) {
                const ghostShape = {
                    id: ghostShapeId,
                    type: FORK_MIND_CARD_SHAPE_TYPE,
                    x: initialGhostPosition.x,
                    y: initialGhostPosition.y,
                    opacity: GHOST_NODE_OPACITY_VISIBLE,
                    props: {
                        nodeId: "preview",
                        w: DEFAULT_CARD_WIDTH,
                        h: currentGhostHeight,
                        ...createGhostCardContentProps(currentCreationType),
                    },
                } as unknown as Parameters<Editor["createShape"]>[0]

                canvasEditor.createShape(ghostShape)
            }

            canvasEditor.setSelectedShapes([])
        }, { history: "ignore" })

        linkDragSessionRef.current = {
            sourceShapeId: input.sourceShapeId,
            sourceNodeId,
            sourceSide: input.side,
            startPoint,
            arrowShapeId,
            ghostShapeId,
            relationKind, // pointerdown 时写入 relationKind 高频更新与 pointerUp 结算时使用
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
        commitNodeCreation,
        currentCanvasToolRef,
        linkDragSessionRef,
        removePointerListenersRef,
        resolveLinkDrag,
        updateLinkDragPreview,
    ])

    return {
        handleLinkHandlePointerDown,
        cancelLinkDrag,
    }
}
