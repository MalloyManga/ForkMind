import type { ComponentType } from "react"
import type { ConversationNodeType } from "../domain/conversation/types"
import { ChatPlusIcon } from "./icons/ChatPlusIcon"
import { NotePlusIcon } from "./icons/NotePlusIcon"

export interface CanvasCreationRegistryItem {
    tooltip: string
    Icon: ComponentType<{ className?: string }>
}

/**
 * 底部 ModeBar CanvasTool 注册表
 * tooltip Icon
 */
export const CANVAS_CREATION_REGISTRY: Record<ConversationNodeType, CanvasCreationRegistryItem> = {
    chat: {
        tooltip: "Chat",
        Icon: ChatPlusIcon,
    },
    note: {
        tooltip: "Note",
        Icon: NotePlusIcon,
    },
}
