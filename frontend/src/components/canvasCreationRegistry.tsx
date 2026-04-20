import type { ComponentType } from "react"
import type { ConversationNodeType } from "../domain/conversation/types"
import { ChatPlusIcon } from "./icons/ChatPlusIcon"
import { NotePlusIcon } from "./icons/NotePlusIcon"

export interface CanvasCreationRegistryItem {
    description: string
    tooltip: string
    Icon: ComponentType<{ className?: string }>
}

export const CANVAS_CREATION_REGISTRY: Record<ConversationNodeType, CanvasCreationRegistryItem> = {
    chat: {
        description: "包含用户提问与 AI 回答的双栏对话卡片。",
        tooltip: "Chat",
        Icon: ChatPlusIcon,
    },
    note: {
        description: "纯 Markdown 笔记卡片。",
        tooltip: "Note",
        Icon: NotePlusIcon,
    },
}
