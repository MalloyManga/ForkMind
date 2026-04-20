import type { ConversationNodeType } from "../domain/conversation/types"

/**
 * 统一的画布工具状态
 */
export type CanvasTool = "move" | "hand-tool" | ConversationNodeType

/**
 * 判断当前工具是否属于“创建卡片工具”。
 * 只有 chat / note 才能触发双击空白创建和 handle 拖拽创建；
 * move / hand-tool 只负责浏览和操作画布，不进入卡片创建流程。
 */
export function isCreationCanvasTool(canvasTool: CanvasTool): canvasTool is ConversationNodeType {
    return canvasTool === "chat" || canvasTool === "note"
}
