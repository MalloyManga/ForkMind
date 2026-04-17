import { TLShapeId } from "tldraw"

/**
 * 四个拖拽handle触点
 */
export type LinkHandleSide = "top" | "right" | "bottom" | "left"

/**
 * 开始拖拽的入参
 */
export interface StartLinkDragInput {
    sourceShapeId: TLShapeId
    side: LinkHandleSide
    clientX: number
    clientY: number
}
