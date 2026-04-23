import type { ConversationNodeType } from "../domain/conversation/types"

/**
 * 统一的画布工具状态
 */
export type CanvasTool = "move" | "hand-tool" | ConversationNodeType

export const CANVAS_TOOL_SHORTCUTS = {
    move: "v",
    "hand-tool": "h",
    chat: "c",
    note: "n",
} as const

/**
 * 根据键盘字母反推应该切换到哪个画布工具
 * 画布区域按下快捷键时 统一把按键翻译成当前工具状态
 */
export function resolveCanvasToolByShortcut(shortcutKey: string): CanvasTool | null {
    const normalizedShortcutKey = shortcutKey.toLowerCase()

    const matchedEntry = Object.entries(CANVAS_TOOL_SHORTCUTS).find(([, shortcut]) =>
        shortcut === normalizedShortcutKey
    )

    if (!matchedEntry) {
        return null
    }

    return matchedEntry[0] as CanvasTool
}

/**
 * 判断当前工具是否属于 创建卡片工具
 */
export function isCreationCanvasTool(canvasTool: CanvasTool): canvasTool is ConversationNodeType {
    return canvasTool === "chat" || canvasTool === "note"
}
