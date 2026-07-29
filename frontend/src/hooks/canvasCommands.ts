import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import type { CanvasTool } from "./canvasToolTypes"

/**
 * 命令 Id (快捷键)
 */
export type CanvasCommandId =
    | "tool-move"
    | "tool-hand-tool"
    | "tool-chat"
    | "tool-note"
    | "tool-image"
    | "tool-link"
    | "tool-file"
    | "copy-node"
    | "paste-here"
    | "paste-to-replace"
    | "toggle-ui"
    | "toggle-panels"

/**
 * shortcut 具体定义
 */
interface CanvasShortcutDefinition {
    key: string
    code?: string
    mod?: boolean
    shift?: boolean
    alt?: boolean
}

interface CanvasCommandDefinition {
    label: string
    shortcut?: CanvasShortcutDefinition
}

/**
 * 画布命令注册表
 * Record<CanvasCommandId, CanvasCommandDefinition>
 */
export const CANVAS_COMMAND_REGISTRY = {
    "tool-move": {
        label: "Move",
        shortcut: { key: "v" },
    },
    "tool-hand-tool": {
        label: "Hand tool",
        shortcut: { key: "h" },
    },
    "tool-chat": {
        label: "Chat",
        shortcut: { key: "c" },
    },
    "tool-note": {
        label: "Note",
        shortcut: { key: "n" },
    },
    "tool-image": {
        label: "Image",
        shortcut: { key: "i" },
    },
    "tool-link": {
        label: "Link",
        shortcut: { key: "l" },
    },
    "tool-file": {
        label: "File",
        shortcut: { key: "f" },
    },
    "copy-node": {
        label: "Copy",
        shortcut: { key: "c", mod: true },
    },
    "paste-here": {
        label: "Paste here",
        shortcut: { key: "v", mod: true },
    },
    "paste-to-replace": {
        label: "Paste to replace",
        shortcut: { key: "r", mod: true, shift: true },
    },
    "toggle-ui": {
        // 这里文案为默认值 真正渲染菜单时 resolver 会按当前隐藏状态改成 Show 或 Hide
        label: "Show UI",
        shortcut: { key: "\\", code: "Backslash", mod: true },
    },
    "toggle-panels": {
        label: "Minimize UI",
        shortcut: { key: "\\", code: "Backslash", mod: true, shift: true },
    },
} as const satisfies Record<CanvasCommandId, CanvasCommandDefinition>

/**
 * 提取出 CanvasTool shortcuts 
 */
const CANVAS_TOOL_COMMAND_TO_TOOL = {
    "tool-move": "move",
    "tool-hand-tool": "hand-tool",
    "tool-chat": "chat",
    "tool-note": "note",
    "tool-image": "image",
    "tool-link": "link",
    "tool-file": "file",
} as const satisfies Record<Extract<CanvasCommandId, `tool-${string}`>, CanvasTool>

/**
 * canvasTool 按钮( ModeBar ) 读取 对应的 shortCut
 * 传入命令返回快捷键 shortcut 对象
 */
export function getCanvasToolShortcut(canvasTool: CanvasTool): CanvasShortcutDefinition {
    return CANVAS_COMMAND_REGISTRY[`tool-${canvasTool}`].shortcut
}

/**
 * 传入的 key 按键首字母全大写
 */
export function formatCanvasShortcut(shortcut: CanvasShortcutDefinition | undefined): string | undefined {
    if (!shortcut) {
        return undefined
    }

    const parts: string[] = []
    if (shortcut.mod) {
        parts.push("Ctrl/Cmd")
    }
    if (shortcut.shift) {
        parts.push("Shift")
    }
    if (shortcut.alt) {
        parts.push("Alt")
    }

    // 单字符按键直接转大写 其它像 tab 这种按键仅将第一个字符转大写
    const keyLabel = shortcut.key.length === 1
        ? shortcut.key.toUpperCase()
        : shortcut.key[0].toUpperCase() + shortcut.key.slice(1)

    parts.push(keyLabel)
    return parts.join("+")
}

/**
 * 将按下的 键盘 ley 与要触发的快捷键进行逐项匹配
 * 匹配 快捷键定义了+按下了 快捷键没定义(undifined转false)+没按下
 */
function isModifierStateMatched(event: KeyboardEvent | ReactKeyboardEvent, shortcut: CanvasShortcutDefinition): boolean {
    // 这里做的是完整匹配 例如 Ctrl/Cmd + V 不能在额外按着 Shift 时也被当成普通 Paste here
    const isModMatched = Boolean(shortcut.mod) === (event.metaKey || event.ctrlKey)
    const isShiftMatched = Boolean(shortcut.shift) === event.shiftKey
    const isAltMatched = Boolean(shortcut.alt) === event.altKey

    return isModMatched && isShiftMatched && isAltMatched
}

/**
 * 判断当前按键是否命中快捷键主键
 * key 用于常规字母 code 用于 \ 这类会被 Shift 变成 | 的物理键
 */
function isShortcutKeyMatched(event: KeyboardEvent | ReactKeyboardEvent, shortcut: CanvasShortcutDefinition): boolean {
    const normalizedKey = event.key.toLowerCase()
    if (shortcut.code && event.code === shortcut.code) {
        return true
    }

    return shortcut.key === normalizedKey
}

/**
 * 根据键盘事件反查命令 id
 * App 壳层只监听一次 keydown 再把命令转发给 resolver executor 或工具切换逻辑
 */
export function resolveCanvasCommandByKeyboardEvent(
    event: KeyboardEvent | ReactKeyboardEvent,
): CanvasCommandId | null {
    const tempCanvasCommandArray = Object.entries(CANVAS_COMMAND_REGISTRY) as
        [
            CanvasCommandId,
            (typeof CANVAS_COMMAND_REGISTRY)[CanvasCommandId]
        ][]

    const matchedEntry = tempCanvasCommandArray.find(([, canvasCommandDefinition]) => {
        const shortcut = canvasCommandDefinition.shortcut
        if (!shortcut) {
            return false
        }
        // 精确匹配按下的快捷键 与 实际合法的业务快捷键
        return isShortcutKeyMatched(event, shortcut) && isModifierStateMatched(event, shortcut)
    })

    return matchedEntry?.[0] ?? null
}

/**
 * 传入 CanvasCommandId 任意命令 返回 null 表示为非 canvasToolCommand 否则返回 canvasTool 的具体 shortcut
 */
export function resolveCanvasToolByCommand(commandId: CanvasCommandId): CanvasTool | null {
    // 只有 tool 开头的命令才会被翻译成当前画布工具 其它命令继续交给 executor
    if (!(commandId in CANVAS_TOOL_COMMAND_TO_TOOL)) {
        return null
    }

    return CANVAS_TOOL_COMMAND_TO_TOOL[commandId as keyof typeof CANVAS_TOOL_COMMAND_TO_TOOL]
}
