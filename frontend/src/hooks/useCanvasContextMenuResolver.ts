import { CANVAS_COMMAND_REGISTRY, formatCanvasShortcut } from "./canvasCommands"
import type {
    CanvasContextMenuContext,
    CanvasContextMenuItem,
} from "./canvasContextMenuTypes"
import type { CanvasClipboardPayload } from "../stores/conversationStore"
import type { CanvasCommandId } from './canvasCommands'
import { assertNever } from "@/lib/utils.ts"

interface UseCanvasContextMenuResolverParams {
    clipboardCard: CanvasClipboardPayload | null
    isCanvasUiHidden: boolean
}

/**
 * ContentMenuItem 构造入参
 */
interface resolveContextMenuItemInput {
    commandId: CanvasCommandId,
    label?: string,
    isDisabled?: boolean
}

/**
 * 构造 ContentMenuItem
 */
function resolveContextMenuItem({
    commandId,
    label,
    isDisabled
}: resolveContextMenuItemInput): CanvasContextMenuItem {
    return {
        commandId: commandId,
        label: label ?? CANVAS_COMMAND_REGISTRY[commandId].label,
        shortcut: formatCanvasShortcut(CANVAS_COMMAND_REGISTRY[commandId].shortcut),
        // 没有业务剪贴板时 仍然展示菜单项 但显式禁用
        ...(isDisabled ? { disabled: isDisabled } : {})
    }
}

/**
 * 右键菜单 resolver
 * 根据当前右键命中的上下文 和 剪贴板可用性
 * 产出这一刻真正应该显示的菜单项
 */
export function useCanvasContextMenuResolver({
    clipboardCard,
    isCanvasUiHidden,
}: UseCanvasContextMenuResolverParams) {
    const resolveContextMenuItems = (context: CanvasContextMenuContext): CanvasContextMenuItem[] => {
        // 通用 ContextMenuItem 一次性全构造
        const pasteHereItem = resolveContextMenuItem({
            commandId: 'paste-here',
            isDisabled: clipboardCard === null
        })
        const pasteJSONHereItem = resolveContextMenuItem({
            commandId: "paste-json-here",
        })
        // --------------------------------

        switch (context.kind) {
            case 'canvas':
                const toogleUIItem = resolveContextMenuItem({
                    commandId: 'toggle-ui',
                    label: isCanvasUiHidden ? "Show UI" : "Hide UI"
                    // toggle-ui 的显示文案依赖当前状态 不能直接照搬注册表里的默认 label
                })
                return [
                    pasteHereItem,
                    pasteJSONHereItem,
                    toogleUIItem
                ]
            case 'node':
                const copyNodeItem = resolveContextMenuItem({
                    commandId: 'copy-node'
                })
                const copyNodeJSONItem = resolveContextMenuItem({
                    commandId: "copy-node-json",
                })
                const pasteToReplaceItem = resolveContextMenuItem({
                    commandId: 'paste-to-replace',
                    isDisabled: clipboardCard === null
                })
                return [
                    copyNodeItem,
                    copyNodeJSONItem,
                    pasteHereItem,
                    pasteJSONHereItem,
                    pasteToReplaceItem
                ]
            default:
                return assertNever(context)
        }
    }

    return {
        resolveContextMenuItems,
    }
}
