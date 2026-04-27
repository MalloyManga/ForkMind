import type { CanvasCommandId } from "./canvasCommands"
import type { Point } from './useCanvasBridge.helpers'

/**
 * 右键唤起的 ContentMenu 类型接口
 */
export type CanvasContextMenuContext =
    | {
        // 用户右键的是空白画布 这时菜单只关心落点 不关心节点身份
        kind: "canvas"
        screenPoint: Point
        pagePoint: Point
    }
    | {
        // 用户右键的是某张卡片 这时菜单除了落点 还需要知道 nodeId 才能执行 copy 或 replace
        kind: "node"
        nodeId: string
        screenPoint: Point
        pagePoint: Point
    }

export interface CanvasContextMenuItem {
    // 最终执行什么业务命令 只传命令 id 不把具体逻辑写死在 UI 层
    commandId: CanvasCommandId
    label: string
    shortcut?: string
    disabled?: boolean
}
