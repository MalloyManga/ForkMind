import { type ForkMindCardShape, FORK_MIND_CARD_SHAPE_TYPE } from "../lib/forkMindCardShape"
import { anchorBySide, type LinkDragSession, type StableArrowProjection } from "./useCanvasBridge.helpers"
import { Editor, TLArrowShape, TLShapeId } from "tldraw"

type ArrowShapePartial = {
    id: TLShapeId
    type: "arrow"
    x?: number
    y?: number
    opacity?: number
    props?: Partial<TLArrowShape["props"]>
}

function isSameAnchor(left: { x: number; y: number }, right: { x: number; y: number }): boolean {
    return left.x === right.x && left.y === right.y
}

/**
 * 让箭头 terminal 与目标 shape 维持唯一 binding。
 * 业务场景：父子关系和 reference 变化后，箭头仍复用同一个 shapeId，不丢失选中态。
 */
export function syncArrowBinding(
    editor: Editor,
    arrowShapeId: TLShapeId,
    terminal: "start" | "end",
    targetShapeId: TLShapeId,
    anchor: { x: number; y: number },
) {
    const existingBindings = editor
        .getBindingsFromShape(arrowShapeId, "arrow")
        .filter((binding) => binding.props.terminal === terminal)

    if (existingBindings.length > 1) {
        editor.deleteBindings(existingBindings.slice(1))
    }

    const nextProps = {
        terminal,
        normalizedAnchor: anchor,
        isExact: false,
        isPrecise: true,
        snap: "edge-point" as const,
    }

    const currentBinding = existingBindings[0]
    if (!currentBinding) {
        editor.createBinding({
            type: "arrow",
            fromId: arrowShapeId,
            toId: targetShapeId,
            props: nextProps,
        })
        return
    }

    if (
        currentBinding.toId === targetShapeId &&
        isSameAnchor(currentBinding.props.normalizedAnchor, anchor)
    ) {
        return
    }

    editor.updateBinding({
        ...currentBinding,
        toId: targetShapeId,
        props: nextProps,
    })
}

/**
 * 统一删除拖拽过程中产生的临时箭头与幽灵卡片。
 * 业务场景：pointerup 结算后，画布只保留业务投影，不残留一次性交互 shape。
 */
export function deleteDragPreviewShapes(editor: Editor, session: LinkDragSession) {
    const removableShapeIds = [session.arrowShapeId, session.ghostShapeId].filter((shapeId) =>
        editor.getShape(shapeId),
    )

    if (removableShapeIds.length > 0) {
        editor.deleteShapes(removableShapeIds)
    }
}

/**
 * 同步一条稳定的业务箭头投影到 tldraw。
 * 业务场景：Store 中 parent/reference 更新后，用此函数把关系重绘到画布。
 */
export function syncStableArrowProjection(editor: Editor, projection: StableArrowProjection) {
    const deltaEnd = {
        x: projection.endPoint.x - projection.startPoint.x,
        y: projection.endPoint.y - projection.startPoint.y,
    }

    const arrowShape = editor.getShape(projection.id)
    const arrowProps: Partial<TLArrowShape["props"]> = {
        kind: "arc",
        bend: projection.bend,
        dash: projection.kind === "reference" ? "dashed" : "solid",
        color: projection.kind === "reference" ? "grey" : "blue",
        size: "m",
        arrowheadStart: "none",
        arrowheadEnd: "triangle",
        start: { x: 0, y: 0 },
        end: deltaEnd,
    }

    if (!arrowShape) {
        editor.createShape({
            id: projection.id,
            type: "arrow",
            x: projection.startPoint.x,
            y: projection.startPoint.y,
            props: arrowProps,
        })
    } else {
        const update: ArrowShapePartial = {
            id: projection.id,
            type: "arrow",
            x: projection.startPoint.x,
            y: projection.startPoint.y,
            props: arrowProps,
        }
        editor.updateShapes([update])
    }

    syncArrowBinding(
        editor,
        projection.id,
        "start",
        projection.fromShapeId,
        anchorBySide(projection.sourceSide),
    )
    syncArrowBinding(
        editor,
        projection.id,
        "end",
        projection.toShapeId,
        anchorBySide(projection.targetSide),
    )
}

export type ForkMindCardShapePartial = {
    id: TLShapeId
    type: typeof FORK_MIND_CARD_SHAPE_TYPE
    x?: number
    y?: number
    opacity?: number
    props?: Partial<ForkMindCardShape["props"]>
}

export type ArrowShapePreviewPartial = {
    id: TLShapeId
    type: "arrow"
    x?: number
    y?: number
    opacity?: number
    props?: Partial<TLArrowShape["props"]>
}
