import type { ComponentType } from "react"
import type { ConversationNodeType } from "../domain/conversation/types"
import { ChatPlusIcon } from "./icons/ChatPlusIcon"
import { NotePlusIcon } from "./icons/NotePlusIcon"

export interface CanvasCreationRegistryItem {
    label: string
    description: string
    Icon: ComponentType<{ className?: string }>
}

export const CANVAS_CREATION_REGISTRY: Record<ConversationNodeType, CanvasCreationRegistryItem> = {
    chat: {
        label: "Chat",
        description: "包含用户提问与 AI 回答的双栏对话卡片。",
        Icon: ChatPlusIcon,
    },
    note: {
        label: "Note",
        description: "纯 Markdown 笔记卡片。",
        Icon: NotePlusIcon,
    },
}
