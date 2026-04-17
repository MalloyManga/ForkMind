/**
 * 主键协议层 (Identity Protocol / Serialization)
 * 定义 tldraw Canvas的 Shape ID 与业务层 Zustand 的 Node ID 之间的转换规则
 * 这里只提供纯函数进行“身份翻译（序列化/反序列化）”，真正的视图绘制与同步由 projection.ts 负责
 */
import { TLShapeId, createShapeId } from "tldraw"

// 业务层 shape 分类前缀
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

/**
 * 箭头类型描述
 */
export type CanvasArrowDescriptor =
    | CanvasParentArrowDescriptor
    | CanvasReferenceArrowDescriptor

/**
 * 规范化 tldraw shapeId
 * 去掉tldraw有时会带的 `shape:` 前缀 解析我们自己的前缀
 */
function normalizeShapeId(shapeId: TLShapeId): string {
    const rawShapeId = String(shapeId)
    return rawShapeId.startsWith("shape:")
        ? rawShapeId.slice("shape:".length)
        : rawShapeId
}

/**
 * 把业务层 nodeId 构造为 tldraw shapeId
 * Store 与画布建立稳定一一对应关系，便于选中、删除和同步
 */
export function toCanvasNodeShapeId(nodeId: string): TLShapeId {
    return createShapeId(`${CANVAS_NODE_SHAPE_PREFIX}:${nodeId}`)
}

/**
 * 把业务层父子关系映射成稳定箭头 id
 * 由 childNodeId 推断出唯一对应的 parentNode 箭头 arrowShapeId
 */
export function toCanvasParentArrowId(childNodeId: string): TLShapeId {
    return createShapeId(`${CANVAS_PARENT_ARROW_PREFIX}:${childNodeId}`)
}

/**
 * 把业务层 reference 关系映射成稳定箭头 id
 * 由 reference 的源 nodeId 以及 targetId 计算出精确的 arrowShapeId
 */
export function toCanvasReferenceArrowId(sourceNodeId: string, targetNodeId: string): TLShapeId {
    return createShapeId(`${CANVAS_REFERENCE_ARROW_PREFIX}:${sourceNodeId}->${targetNodeId}`)
}

/**
 * 把画布 shapeId 过滤其余的 反解出 nodeId 仅保留 node 卡片 id
 * 去掉 tldraw 自带的 shape: 前缀 以及 我们自制的前缀 仅保留纯粹的UUID存储到store对应的字段
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
 * 把画布箭头 id 反解回业务关系描述
 * 用户单独选中箭头并按 Backspace 时，需要知道是在删除父子关系还是引用关系
 */
export function parseCanvasArrowDescriptor(shapeId: TLShapeId): CanvasArrowDescriptor | null {
    const normalizedShapeId = normalizeShapeId(shapeId)

    if (normalizedShapeId.startsWith(`${CANVAS_PARENT_ARROW_PREFIX}:`)) {
        return {
            kind: "parent",
            childNodeId: normalizedShapeId.slice(`${CANVAS_PARENT_ARROW_PREFIX}:`.length),
        }
    }

    else if (normalizedShapeId.startsWith(`${CANVAS_REFERENCE_ARROW_PREFIX}:`)) {
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
