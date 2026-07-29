import type { ConversationNodeType } from "../domain/conversation/types"

/**
 * 统一的画布工具状态
 */
export type CanvasTool = "move" | "hand-tool" | ConversationNodeType

/**
 * 判断当前工具是否属于 创建卡片工具
 */
export function isCreationCanvasTool(canvasTool: CanvasTool): canvasTool is ConversationNodeType {
    switch (canvasTool) {
        case "chat":
        case "note":
        case "image":
        case "link":
        case "file":
            return true
        case "move":
        case "hand-tool":
            return false
    }
}
