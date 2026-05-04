import { useEffect, type MutableRefObject } from "react"
import { type Editor, type TLShapeId } from "tldraw"
import type { ConversationCard } from "../domain/conversation/types"
import { type ForkMindCardShape, FORK_MIND_CARD_SHAPE_TYPE } from "../lib/forkMindCardShape"
import { parseCanvasArrowDescriptor, parseNodeIdFromShapeId, toCanvasNodeShapeId } from "./canvasNodeIds"
import {
    type ArrowAnchorOverride,
    areSameShapeIdSet,
    CHAT_CARD_HEIGHT,
    createStableArrowProjections,
    type LinkDragSession,
    NOTE_CARD_HEIGHT,
} from "./useCanvasBridge.helpers"
import {
    type ForkMindCardShapePartial,
    type syncStableArrowProjection as SyncStableArrowProjectionFn,
} from "./useCanvasBridge.projection"

/**
 * 判断画布里的卡片 shape 是否已经和 Store 目标状态一致
 * 一致时跳过 updateShapes 避免把同一份最终状态重复写回 tldraw
 */
function isForkMindCardShapeSynced(
    currentShape: ForkMindCardShape,
    nextX: number,
    nextY: number,
    nextProps: ForkMindCardShape["props"],
): boolean {
    return (
        currentShape.x === nextX &&
        currentShape.y === nextY &&
        currentShape.props.w === nextProps.w &&
        currentShape.props.h === nextProps.h &&
        currentShape.props.cardType === nextProps.cardType &&
        currentShape.props.userPrompt === nextProps.userPrompt &&
        currentShape.props.aiResponse === nextProps.aiResponse &&
        currentShape.props.noteContent === nextProps.noteContent
    )
}

interface UseCanvasBridgeCanvasSyncParams {
    canvasEditor: Editor | null
    cards: ConversationCard[]
    activeNodeId: string | null
    linkDragSessionRef: MutableRefObject<LinkDragSession | null>
    isApplyingStoreToCanvasRef: MutableRefObject<boolean>
    isUserMultiSelectionRef: MutableRefObject<boolean>
    arrowAnchorOverrideByIdRef: MutableRefObject<Map<TLShapeId, ArrowAnchorOverride>>
    syncStableArrowProjection: typeof SyncStableArrowProjectionFn
}

/**
 * Store 为唯一事实源 持续投影成 tldraw 的节点形状和关系箭头
 * 仅作 store canvas 的状态对比diff计算 真正执行绘制渲染由syncStableArrowProjection负责
 */
export function useCanvasBridgeCanvasSync({
    canvasEditor,
    cards,
    activeNodeId,
    linkDragSessionRef,
    isApplyingStoreToCanvasRef,
    isUserMultiSelectionRef,
    arrowAnchorOverrideByIdRef,
    syncStableArrowProjection,
}: UseCanvasBridgeCanvasSyncParams) {
    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        isApplyingStoreToCanvasRef.current = true

        try {
            canvasEditor.run(() => {
                // 1：拉取 tldraw 画布当前的真实图形状态
                const currentPageShapes = canvasEditor.getCurrentPageShapes()
                const nodeShapeMap = new Map<string, TLShapeId>()
                const descriptorArrowIds = new Set<TLShapeId>()
                const transientShapeIds: TLShapeId[] = []

                for (const currentShape of currentPageShapes) {
                    const currentShapeId = currentShape.id as TLShapeId
                    const nodeId = parseNodeIdFromShapeId(currentShapeId)

                    if (nodeId) {
                        nodeShapeMap.set(nodeId, currentShapeId)
                        continue
                    }

                    const arrowDescriptor = parseCanvasArrowDescriptor(currentShapeId)
                    if (arrowDescriptor) {
                        descriptorArrowIds.add(currentShapeId)
                        continue
                    }

                    const currentSession = linkDragSessionRef.current
                    const isCurrentDragShape =
                        currentSession !== null &&
                        (currentShapeId === currentSession.arrowShapeId ||
                            currentShapeId === currentSession.ghostShapeId)

                    /**
                     * 旧版本残留或第三方生成的非业务 shape 不应长期存在画布
                     */
                    if (
                        !isCurrentDragShape &&
                        (currentShape.type === "note" ||
                            currentShape.type === "arrow" ||
                            currentShape.type === "text")
                    ) {
                        transientShapeIds.push(currentShapeId)
                    }
                }

                // 2: 拉取 Zustand cards 对 Node 进行全量 Diff 计算
                const currentNodeIdSet = new Set(cards.map((card) => card.id))
                const createNodePayload: Array<{
                    id: TLShapeId
                    type: typeof FORK_MIND_CARD_SHAPE_TYPE
                    x: number
                    y: number
                    props: ForkMindCardShape["props"]
                }> = []
                const updateNodePayload: ForkMindCardShapePartial[] = []

                for (const card of cards) {
                    const nextShapeId = toCanvasNodeShapeId(card.id)
                    const nextHeight = card.type === "chat" ? CHAT_CARD_HEIGHT : NOTE_CARD_HEIGHT
                    const nextProps: ForkMindCardShape["props"] = {
                        w: card.size.width,
                        h: Math.max(card.size.minHeight, nextHeight),
                        cardType: card.type,
                        userPrompt: card.type === "chat" ? card.userPrompt : "",
                        aiResponse: card.type === "chat" ? card.aiResponse : "",
                        noteContent: card.type === "note" ? card.noteContent : "",
                    }

                    const existingShapeId = nodeShapeMap.get(card.id)
                    if (!existingShapeId) {
                        createNodePayload.push({
                            id: nextShapeId,
                            type: FORK_MIND_CARD_SHAPE_TYPE,
                            x: card.position.x,
                            y: card.position.y,
                            props: nextProps,
                        })
                        continue
                    }

                    const existingShape = canvasEditor.getShape(existingShapeId)
                    if (
                        existingShape?.type === FORK_MIND_CARD_SHAPE_TYPE &&
                        isForkMindCardShapeSynced(
                            existingShape,
                            card.position.x,
                            card.position.y,
                            nextProps,
                        )
                    ) {
                        continue
                    }

                    updateNodePayload.push({
                        id: existingShapeId,
                        type: FORK_MIND_CARD_SHAPE_TYPE,
                        x: card.position.x,
                        y: card.position.y,
                        props: nextProps,
                    })
                }

                //  3：结算 Diff，批量提交 Node（卡片）的增、删、改
                const removeNodeShapeIds = Array.from(nodeShapeMap.entries())
                    .filter(([nodeId]) => !currentNodeIdSet.has(nodeId))
                    .map(([, shapeId]) => shapeId)

                if (createNodePayload.length > 0) {
                    canvasEditor.createShapes(
                        createNodePayload as unknown as Parameters<Editor["createShapes"]>[0],
                    )
                }
                if (updateNodePayload.length > 0) {
                    canvasEditor.updateShapes(
                        updateNodePayload as unknown as Parameters<Editor["updateShapes"]>[0],
                    )
                }
                if (removeNodeShapeIds.length > 0) {
                    canvasEditor.deleteShapes(removeNodeShapeIds)
                }
                if (transientShapeIds.length > 0) {
                    canvasEditor.deleteShapes(transientShapeIds)
                }

                // 4：计算 Arrow（连线）的 Diff，并呼叫 projection 层兜底更新
                const stableArrowProjections = createStableArrowProjections(
                    cards,
                    arrowAnchorOverrideByIdRef.current,
                )
                const desiredArrowIdSet = new Set(
                    stableArrowProjections.map((projection) => projection.id),
                )
                const staleArrowIds = Array.from(descriptorArrowIds).filter(
                    (arrowShapeId) => !desiredArrowIdSet.has(arrowShapeId),
                )

                if (staleArrowIds.length > 0) {
                    canvasEditor.deleteShapes(staleArrowIds)
                }

                for (const overrideArrowId of Array.from(arrowAnchorOverrideByIdRef.current.keys())) {
                    if (!desiredArrowIdSet.has(overrideArrowId)) {
                        arrowAnchorOverrideByIdRef.current.delete(overrideArrowId)
                    }
                }

                for (const projection of stableArrowProjections) {
                    syncStableArrowProjection(canvasEditor, projection) // 执行更新
                }

                const nextSelectedNodeShapeIds = activeNodeId ? [toCanvasNodeShapeId(activeNodeId)] : []
                const currentSelectedNodeShapeIds = canvasEditor
                    .getSelectedShapeIds()
                    .filter((shapeId): shapeId is TLShapeId => parseNodeIdFromShapeId(shapeId) !== null)

                /**
                 * 多选态由 interactions 层判定并维护。
                 * 同步层只读取这个状态：多选期间不执行“active -> 单选”覆盖。
                 */
                if (isUserMultiSelectionRef.current && currentSelectedNodeShapeIds.length > 1) {
                    return
                }

                if (!areSameShapeIdSet(currentSelectedNodeShapeIds, nextSelectedNodeShapeIds)) {
                    canvasEditor.setSelectedShapes(nextSelectedNodeShapeIds)
                }
            }, { history: "ignore" })
        } finally {
            isApplyingStoreToCanvasRef.current = false
        }
    }, [
        activeNodeId,
        arrowAnchorOverrideByIdRef,
        canvasEditor,
        cards,
        isApplyingStoreToCanvasRef,
        isUserMultiSelectionRef,
        linkDragSessionRef,
        syncStableArrowProjection,
    ])
}
