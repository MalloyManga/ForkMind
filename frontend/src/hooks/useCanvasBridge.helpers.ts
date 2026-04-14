import { TLShapeId } from "tldraw"
import type { ConversationCard } from "../domain/conversation/types"
import { LinkHandleSide } from "./canvasLinkTypes"
import {
    type CanvasArrowDescriptor,
    toCanvasParentArrowId,
    toCanvasReferenceArrowId,
    toCanvasShapeId,
} from "./canvasNodeIds"

/**
 * 鼠标交互的位置
 */
export interface Point {
    x: number
    y: number
}

export interface Anchor {
    x: number
    y: number
}

export type AnchorSide =
    | "top"
    | "top-right"
    | "right"
    | "bottom-right"
    | "bottom"
    | "bottom-left"
    | "left"
    | "top-left"

export interface LinkDragSession {
    sourceShapeId: TLShapeId
    sourceNodeId: string
    sourceSide: LinkHandleSide
    startPoint: Point
    arrowShapeId: TLShapeId
    ghostShapeId: TLShapeId
    ghostCardType: "chat" | "note"
    ghostHeight: number
    snappedTargetShapeId: TLShapeId | null
    snappedTargetNodeId: string | null
    releasePoint: Point
}

export interface StableArrowProjection {
    id: TLShapeId
    kind: CanvasArrowDescriptor["kind"]
    fromShapeId: TLShapeId
    toShapeId: TLShapeId
    sourceSide: AnchorSide
    targetSide: AnchorSide
    startPoint: Point
    endPoint: Point
    bend: number
}

export interface ArrowAnchorOverride {
    sourceSide: AnchorSide
    targetSide: AnchorSide
}

const ANCHOR_SIDE_ALL: AnchorSide[] = [
    "top",
    "top-right",
    "right",
    "bottom-right",
    "bottom",
    "bottom-left",
    "left",
    "top-left",
]

export const CHAT_CARD_HEIGHT = 280
export const NOTE_CARD_HEIGHT = 220
export const GHOST_NODE_OPACITY_VISIBLE = 0.48
export const GHOST_NODE_OPACITY_HIDDEN = 0

/**
 * 统一计算画布卡片高度。
 * 业务场景：阶段三先落地“固定宽度 + 固定高度上限 + 内部滚动”，避免长 Markdown 把画布排版撑坏。
 */
export function getCardShapeHeight(card: ConversationCard): number {
    const baseHeight = card.type === "chat" ? CHAT_CARD_HEIGHT : NOTE_CARD_HEIGHT
    return Math.max(card.size.minHeight, baseHeight)
}

/**
 * 按创建类型取默认高度。
 * 业务场景：双击空白创建或拖拽幽灵卡片时，需根据当前选择的卡片类型计算初始高度。
 */
export function getDefaultHeightByType(cardType: "chat" | "note"): number {
    return cardType === "chat" ? CHAT_CARD_HEIGHT : NOTE_CARD_HEIGHT
}

/**
 * 比较两个 shapeId 集合是否一致。
 * 业务场景：同步 activeNodeId 到画布选中态时，避免重复 setSelectedShapes 触发无意义刷新。
 */
export function areSameShapeIdSet(left: TLShapeId[], right: TLShapeId[]): boolean {
    if (left.length !== right.length) {
        return false
    }

    const rightSet = new Set(right)
    return left.every((shapeId) => rightSet.has(shapeId))
}

/**
 * 判断当前键盘事件是否处于文本输入语境。
 * 业务场景：右侧栏正在编辑 Markdown 时，Backspace 应该删除文本，而不是删除节点或箭头。
 */
export function isTextEditingTarget(eventTarget: EventTarget | null): boolean {
    if (!(eventTarget instanceof HTMLElement)) {
        return false
    }

    const tagName = eventTarget.tagName.toLowerCase()
    return tagName === "textarea" || tagName === "input" || eventTarget.isContentEditable
}

/**
 * 由四向触点转换为归一化锚点。
 * 业务场景：tldraw 的箭头 binding 需要知道“绑定在卡片边缘的哪个位置”。
 */
export function anchorBySide(side: AnchorSide): Anchor {
    switch (side) {
        case "top":
            return { x: 0.5, y: 0 }
        case "top-right":
            return { x: 1, y: 0 }
        case "right":
            return { x: 1, y: 0.5 }
        case "bottom-right":
            return { x: 1, y: 1 }
        case "bottom":
            return { x: 0.5, y: 1 }
        case "bottom-left":
            return { x: 0, y: 1 }
        case "left":
            return { x: 0, y: 0.5 }
        case "top-left":
            return { x: 0, y: 0 }
    }
}

export function closestAnchorSideToNormalizedAnchor(anchor: Anchor): AnchorSide {
    let bestSide: AnchorSide = "top"
    let bestDistance = Number.POSITIVE_INFINITY

    for (const side of ANCHOR_SIDE_ALL) {
        const sideAnchor = anchorBySide(side)
        const deltaX = sideAnchor.x - anchor.x
        const deltaY = sideAnchor.y - anchor.y
        const distance = deltaX * deltaX + deltaY * deltaY
        if (distance < bestDistance) {
            bestDistance = distance
            bestSide = side
        }
    }

    return bestSide
}

/**
 * 根据边方向取矩形边缘中心点。
 * 业务场景：不管是稳定业务箭头还是拖拽中的临时箭头，都需要从边缘中心发射。
 */
export function edgePointBySide(
    bounds: { x: number; y: number; w: number; h: number },
    side: AnchorSide,
): Point {
    switch (side) {
        case "top":
            return { x: bounds.x + bounds.w / 2, y: bounds.y }
        case "top-right":
            return { x: bounds.x + bounds.w, y: bounds.y }
        case "right":
            return { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 }
        case "bottom-right":
            return { x: bounds.x + bounds.w, y: bounds.y + bounds.h }
        case "bottom":
            return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h }
        case "bottom-left":
            return { x: bounds.x, y: bounds.y + bounds.h }
        case "left":
            return { x: bounds.x, y: bounds.y + bounds.h / 2 }
        case "top-left":
            return { x: bounds.x, y: bounds.y }
    }
}

/**
 * 根据目标点判断更适合吸附到目标卡片的哪一边。
 * 业务场景：拖拽连线靠近现有卡片时，箭头终点要“贴边吸附”，而不是随便落在卡片内部。
 */
export function closestAnchorSideToPoint(
    point: Point,
    bounds: { x: number; y: number; w: number; h: number },
): AnchorSide {
    let bestSide: AnchorSide = "top"
    let bestDistance = Number.POSITIVE_INFINITY

    for (const side of ANCHOR_SIDE_ALL) {
        const sidePoint = edgePointBySide(bounds, side)
        const deltaX = sidePoint.x - point.x
        const deltaY = sidePoint.y - point.y
        const distance = deltaX * deltaX + deltaY * deltaY

        if (distance < bestDistance) {
            bestDistance = distance
            bestSide = side
        }
    }

    return bestSide
}

/**
 * 取对边方向。
 * 业务场景：从源卡片右边拉出新卡片时，幽灵卡片默认应让自己的左边贴住指针。
 */
export function oppositeSide(side: LinkHandleSide): LinkHandleSide {
    switch (side) {
        case "top":
            return "bottom"
        case "right":
            return "left"
        case "bottom":
            return "top"
        case "left":
            return "right"
    }
}

export function oppositeAnchorSide(side: AnchorSide): AnchorSide {
    switch (side) {
        case "top":
            return "bottom"
        case "top-right":
            return "bottom-left"
        case "right":
            return "left"
        case "bottom-right":
            return "top-left"
        case "bottom":
            return "top"
        case "bottom-left":
            return "top-right"
        case "left":
            return "right"
        case "top-left":
            return "bottom-right"
    }
}

/**
 * 根据“指针挂载在哪条边”计算幽灵卡片左上角。
 * 业务场景：用户拖线时看到的是“箭头拖着一张半透明卡片走”，而不是只有一根线。
 */
export function ghostPositionByPointer(
    pointerPoint: Point,
    attachedSide: LinkHandleSide,
    width: number,
    height: number,
): Point {
    switch (attachedSide) {
        case "top":
            return { x: pointerPoint.x - width / 2, y: pointerPoint.y }
        case "right":
            return { x: pointerPoint.x - width, y: pointerPoint.y - height / 2 }
        case "bottom":
            return { x: pointerPoint.x - width / 2, y: pointerPoint.y - height }
        case "left":
            return { x: pointerPoint.x, y: pointerPoint.y - height / 2 }
    }
}

/**
 * 追加引用关系并自动去重。
 * 业务场景：拖线连接到已有卡片时，不改主链 parentId，而是补一条 reference 关系。
 */
export function appendReferenceId(node: ConversationCard, targetNodeId: string): string[] {
    return Array.from(new Set([...(node.referenceNodeIds ?? []), targetNodeId]))
}

/**
 * 根据两张卡片的相对位置，推导箭头应该从哪边出、从哪边入。
 * 业务场景：让箭头方向更接近 Figma/FigJam 的自然连线手感。
 */
function deriveLinkSides(sourceCard: ConversationCard, targetCard: ConversationCard): {
    sourceSide: AnchorSide
    targetSide: AnchorSide
} {
    const sourceWidth = sourceCard.size.width
    const targetWidth = targetCard.size.width
    const sourceHeight = getCardShapeHeight(sourceCard)
    const targetHeight = getCardShapeHeight(targetCard)

    const sourceCenter = {
        x: sourceCard.position.x + sourceWidth / 2,
        y: sourceCard.position.y + sourceHeight / 2,
    }
    const targetCenter = {
        x: targetCard.position.x + targetWidth / 2,
        y: targetCard.position.y + targetHeight / 2,
    }

    const deltaX = targetCenter.x - sourceCenter.x
    const deltaY = targetCenter.y - sourceCenter.y

    const angle = Math.atan2(deltaY, deltaX)
    const pi = Math.PI

    let sourceSide: AnchorSide
    if (angle >= -pi / 8 && angle < pi / 8) {
        sourceSide = "right"
    } else if (angle >= pi / 8 && angle < (3 * pi) / 8) {
        sourceSide = "bottom-right"
    } else if (angle >= (3 * pi) / 8 && angle < (5 * pi) / 8) {
        sourceSide = "bottom"
    } else if (angle >= (5 * pi) / 8 && angle < (7 * pi) / 8) {
        sourceSide = "bottom-left"
    } else if (angle >= (7 * pi) / 8 || angle < (-7 * pi) / 8) {
        sourceSide = "left"
    } else if (angle >= (-7 * pi) / 8 && angle < (-5 * pi) / 8) {
        sourceSide = "top-left"
    } else if (angle >= (-5 * pi) / 8 && angle < (-3 * pi) / 8) {
        sourceSide = "top"
    } else {
        sourceSide = "top-right"
    }

    return {
        sourceSide,
        targetSide: oppositeAnchorSide(sourceSide),
    }
}

/**
 * 计算弧线箭头的 bend。
 * 业务场景：把默认折线改成更接近 Figma 的弧线关系线。
 */
export function computeArrowBend(sourcePoint: Point, targetPoint: Point): number {
    const deltaX = targetPoint.x - sourcePoint.x
    const deltaY = targetPoint.y - sourcePoint.y
    const distance = Math.hypot(deltaX, deltaY)
    const baseBend = Math.max(24, Math.min(96, distance * 0.16))

    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        return deltaY >= 0 ? baseBend : -baseBend
    }

    return deltaX >= 0 ? -baseBend : baseBend
}

/**
 * 从业务数据投影出所有稳定箭头。
 * 业务场景：父子链与引用链都是 Store 的“关系投影”，不是临时画布垃圾数据。
 */
export function createStableArrowProjections(
    cards: ConversationCard[],
    anchorOverrideByArrowId?: Map<TLShapeId, ArrowAnchorOverride>,
): StableArrowProjection[] {
    const cardById = new Map(cards.map((card) => [card.id, card] as const))
    const projections: StableArrowProjection[] = []

    for (const card of cards) {
        if (card.parentId) {
            const parentCard = cardById.get(card.parentId)
            if (parentCard) {
                const sides = deriveLinkSides(parentCard, card)
                const override = anchorOverrideByArrowId?.get(toCanvasParentArrowId(card.id))
                const sourceSide = override?.sourceSide ?? sides.sourceSide
                const targetSide = override?.targetSide ?? sides.targetSide
                const startPoint = edgePointBySide(
                    {
                        x: parentCard.position.x,
                        y: parentCard.position.y,
                        w: parentCard.size.width,
                        h: getCardShapeHeight(parentCard),
                    },
                    sourceSide,
                )
                const endPoint = edgePointBySide(
                    {
                        x: card.position.x,
                        y: card.position.y,
                        w: card.size.width,
                        h: getCardShapeHeight(card),
                    },
                    targetSide,
                )

                projections.push({
                    id: toCanvasParentArrowId(card.id),
                    kind: "parent",
                    fromShapeId: toCanvasShapeId(parentCard.id),
                    toShapeId: toCanvasShapeId(card.id),
                    sourceSide,
                    targetSide,
                    startPoint,
                    endPoint,
                    bend: computeArrowBend(startPoint, endPoint),
                })
            }
        }

        for (const referenceTargetId of card.referenceNodeIds ?? []) {
            const targetCard = cardById.get(referenceTargetId)
            if (!targetCard) {
                continue
            }

            const sides = deriveLinkSides(card, targetCard)
            const referenceArrowId = toCanvasReferenceArrowId(card.id, targetCard.id)
            const override = anchorOverrideByArrowId?.get(referenceArrowId)
            const sourceSide = override?.sourceSide ?? sides.sourceSide
            const targetSide = override?.targetSide ?? sides.targetSide
            const startPoint = edgePointBySide(
                {
                    x: card.position.x,
                    y: card.position.y,
                    w: card.size.width,
                    h: getCardShapeHeight(card),
                },
                sourceSide,
            )
            const endPoint = edgePointBySide(
                {
                    x: targetCard.position.x,
                    y: targetCard.position.y,
                    w: targetCard.size.width,
                    h: getCardShapeHeight(targetCard),
                },
                targetSide,
            )

            projections.push({
                id: referenceArrowId,
                kind: "reference",
                fromShapeId: toCanvasShapeId(card.id),
                toShapeId: toCanvasShapeId(targetCard.id),
                sourceSide,
                targetSide,
                startPoint,
                endPoint,
                bend: computeArrowBend(startPoint, endPoint),
            })
        }
    }

    return projections
}
