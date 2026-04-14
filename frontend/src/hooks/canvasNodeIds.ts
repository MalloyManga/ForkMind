// 处理tldraw与业务层Zustand之间的双向映射
import { TLShapeId, createShapeId } from "tldraw"

// 
export const CANVAS_NODE_SHAPE_PREFIX = "forkmind-node"
export const CANVAS_PARENT_ARROW_PREFIX = "forkmind-parent-arrow"
export const CANVAS_REFERENCE_ARROW_PREFIX = "forkmind-reference-arrow"

export interface CanvasParentArrowDescriptor {
    kind: "parent"
    childNodeId: string
}

export interface CanvasReferenceArrowDescriptor {
    kind: "reference"
    sourceNodeId: string
    targetNodeId: string
}

export type CanvasArrowDescriptor =
    | CanvasParentArrowDescriptor
    | CanvasReferenceArrowDescriptor

/**
 * 规范化 tldraw shapeId。
 * tldraw 内部有时会带 `shape:` 前缀 统一去掉后解析我们自己的前缀
 */
function normalizeShapeId(shapeId: TLShapeId): string {
    const rawShapeId = String(shapeId)
    return rawShapeId.startsWith("shape:")
        ? rawShapeId.slice("shape:".length)
        : rawShapeId
}

/**
 * 把业务层 nodeId 映射成画布 shapeId。
 * 业务场景：Store 与画布建立稳定一一对应关系，便于选中、删除和同步。
 */
export function toCanvasShapeId(nodeId: string): TLShapeId {
    return createShapeId(`${CANVAS_NODE_SHAPE_PREFIX}:${nodeId}`)
}

/**
 * 把业务层父子关系映射成稳定箭头 id。
 * 业务场景：child 的 `parentId` 一旦存在，就始终投影成同一条箭头，便于同步和删除。
 */
export function toCanvasParentArrowId(childNodeId: string): TLShapeId {
    return createShapeId(`${CANVAS_PARENT_ARROW_PREFIX}:${childNodeId}`)
}

/**
 * 把业务层 reference 关系映射成稳定箭头 id。
 * 业务场景：source -> target 的引用关系需要稳定可重建，删除箭头时也能反查回 Store。
 */
export function toCanvasReferenceArrowId(sourceNodeId: string, targetNodeId: string): TLShapeId {
    return createShapeId(`${CANVAS_REFERENCE_ARROW_PREFIX}:${sourceNodeId}->${targetNodeId}`)
}

/**
 * 把画布 shapeId 反解回业务层 nodeId
 * 去掉 tldraw 自带的 shape: 前缀 以及 我们自制的前缀 仅保留纯粹的UUID存储到store
 */
export function parseNodeIdFromShapeId(shapeId: TLShapeId): string | null {
    const normalizedShapeId = normalizeShapeId(shapeId)
    const prefix = `${CANVAS_NODE_SHAPE_PREFIX}:`

    if (!normalizedShapeId.startsWith(prefix)) {
        return null
    }

    return normalizedShapeId.slice(prefix.length)
}

/**
 * 把画布箭头 id 反解回业务关系描述。
 * 业务场景：用户单独选中箭头并按 Backspace 时，需要知道是在删除父子关系还是引用关系。
 */
export function parseCanvasArrowDescriptor(shapeId: TLShapeId): CanvasArrowDescriptor | null {
    const normalizedShapeId = normalizeShapeId(shapeId)

    if (normalizedShapeId.startsWith(`${CANVAS_PARENT_ARROW_PREFIX}:`)) {
        return {
            kind: "parent",
            childNodeId: normalizedShapeId.slice(`${CANVAS_PARENT_ARROW_PREFIX}:`.length),
        }
    }

    if (normalizedShapeId.startsWith(`${CANVAS_REFERENCE_ARROW_PREFIX}:`)) {
        const rawDescriptor = normalizedShapeId.slice(`${CANVAS_REFERENCE_ARROW_PREFIX}:`.length)
        const [sourceNodeId, targetNodeId] = rawDescriptor.split("->")

        if (!sourceNodeId || !targetNodeId) {
            return null
        }

        return {
            kind: "reference",
            sourceNodeId,
            targetNodeId,
        }
    }

    return null
}