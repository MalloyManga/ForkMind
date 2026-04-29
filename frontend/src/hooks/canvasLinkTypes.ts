import { TLShapeId } from "tldraw"

/**
 * 四个拖拽 handle 触点
 */
export type LinkHandleSide = "top" | "right" | "bottom" | "left"

/**
 * 拖拽连线最终要写入的关系类型
 * arrow 类型
 */
export type LinkDragRelationKind = "reference" | "parent"

export interface CanvasParentArrowDescriptor {
    kind: "parent"
    childNodeId: string
}

export interface CanvasReferenceArrowDescriptor {
    kind: "reference"
    sourceNodeId: string
    targetNodeId: string
}

/**
 * 画布箭头关系描述
 * parent: 主链父子关系
 * reference: 补充参考关系
 */
export type CanvasArrowDescriptor =
    | CanvasParentArrowDescriptor
    | CanvasReferenceArrowDescriptor

/**
 * 开始拖拽的入参
 */
export interface StartLinkDragInput {
    sourceShapeId: TLShapeId
    side: LinkHandleSide
    clientX: number
    clientY: number
}
