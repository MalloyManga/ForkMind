import { useEffect, type MutableRefObject } from "react"
import { type Editor, type TLShapeId } from "tldraw"
import type { ConversationCard } from "../domain/conversation/types"
import { type ForkMindCardShape, FORK_MIND_CARD_SHAPE_TYPE } from "../lib/forkMindCardShape"
import { parseCanvasArrowDescriptor, parseNodeIdFromShapeId, toCanvasShapeId } from "./canvasNodeIds"
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

interface UseCanvasBridgeCanvasSyncParams {
    canvasEditor: Editor | null
    cards: ConversationCard[]
    activeNodeId: string | null
    linkDragSessionRef: MutableRefObject<LinkDragSession | null>
    isApplyingStoreToCanvasRef: MutableRefObject<boolean>
    arrowAnchorOverrideByIdRef: MutableRefObject<Map<TLShapeId, ArrowAnchorOverride>>
    syncStableArrowProjection: typeof SyncStableArrowProjectionFn
}

/**
 * Store -> Canvas 投影同步层。
 * 业务场景：把 Store 作为唯一事实源，持续投影成 tldraw 的节点形状和关系箭头。
 */
export function useCanvasBridgeCanvasSync({
    canvasEditor,
    cards,
    activeNodeId,
    linkDragSessionRef,
    isApplyingStoreToCanvasRef,
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
                     * 业务场景：旧版本残留或第三方生成的非业务 shape 不应长期存在画布。
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
                    const nextShapeId = toCanvasShapeId(card.id)
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

                    updateNodePayload.push({
                        id: existingShapeId,
                        type: FORK_MIND_CARD_SHAPE_TYPE,
                        x: card.position.x,
                        y: card.position.y,
                        props: nextProps,
                    })
                }

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
                    syncStableArrowProjection(canvasEditor, projection)
                }

                const nextSelectedNodeShapeIds = activeNodeId ? [toCanvasShapeId(activeNodeId)] : []
                const currentSelectedNodeShapeIds = canvasEditor
                    .getSelectedShapeIds()
                    .filter((shapeId) => parseNodeIdFromShapeId(shapeId) !== null)

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
        linkDragSessionRef,
        syncStableArrowProjection,
    ])
}
