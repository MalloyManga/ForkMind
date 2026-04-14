import { TLShapeId } from "tldraw"

export type LinkHandleSide = "top" | "right" | "bottom" | "left"

export interface StartLinkDragInput {
    sourceShapeId: TLShapeId
    side: LinkHandleSide
    clientX: number
    clientY: number
}
