import { useEffect, type MutableRefObject } from "react"
import { type Editor, type TLShapeId } from "tldraw"
import type { ConversationCard } from "../domain/conversation/types"
import { assertNever } from "../lib/utils"
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
 * 判断画布里的卡片 shape 是否已经和 Store 目标状态完全一致
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
        areSameForkMindCardShapeProps(currentShape.props, nextProps)
    )
}

/**
 * 比较同一业务卡片投影后的 props 是否一致
 * @param currentProps 入参来自 tldraw 当前 shape props
 * @param nextProps 入参来自 Store card 本轮重新投影的目标 props
 * @returns 返回 true 表示无需 updateShapes false 表示 Store 投影需要覆盖到画布
 */
function areSameForkMindCardShapeProps(
    currentProps: ForkMindCardShape["props"],
    nextProps: ForkMindCardShape["props"],
): boolean {
    if (currentProps.cardType !== nextProps.cardType) {
        return false
    }

    switch (nextProps.cardType) {
        case "chat":
            return (
                currentProps.cardType === "chat" &&
                currentProps.userPrompt === nextProps.userPrompt &&
                currentProps.aiResponse === nextProps.aiResponse
            )
        case "note":
            return currentProps.cardType === "note" &&
                currentProps.noteContent === nextProps.noteContent
    }

    return assertNever(nextProps)
}

/**
 * 计算卡片类型对应的默认画布高度
 * @param card Store 中的业务 card 用于读取 card.cardType 并暴露新增类型的编译期提醒
 * @returns 返回 tldraw 自定义 shape 本轮同步时应使用的默认高度
 * 只影响显示高度 不改 Store 原文内容
 */
function getProjectedCardHeight(card: ConversationCard): number {
    switch (card.cardType) {
        case "chat":
            return CHAT_CARD_HEIGHT
        case "note":
            return NOTE_CARD_HEIGHT
    }

    return assertNever(card)
}

/**
 * 将 Store 业务节点转换为 tldraw 自定义 shape props
 * @param card Store 中的 ConversationCard 是业务层唯一事实源
 * @returns 返回 tldraw shape props 只包含画布渲染需要的字段
 * 新增卡片类型时必须在这里补齐投影规则
 */
function createForkMindCardShapeProps(card: ConversationCard): ForkMindCardShape["props"] {
    const projectedHeight = getProjectedCardHeight(card)
    const baseProps = {
        w: card.size.width,
        h: Math.max(card.size.minHeight, projectedHeight),
    }

    switch (card.cardType) {
        case "chat":
            return {
                ...baseProps,
                cardType: card.cardType,
                userPrompt: card.userPrompt,
                aiResponse: card.aiResponse,
            }
        case "note":
            return {
                ...baseProps,
                cardType: card.cardType,
                noteContent: card.noteContent,
            }
    }

    return assertNever(card)
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
                    const nextProps = createForkMindCardShapeProps(card)

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
