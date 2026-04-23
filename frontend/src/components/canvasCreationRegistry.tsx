import type { ComponentType } from "react"
import type { ConversationNodeType } from "../domain/conversation/types"
import { ChatPlusIcon } from "./icons/ChatPlusIcon"
import { NotePlusIcon } from "./icons/NotePlusIcon"
import { CANVAS_TOOL_SHORTCUTS } from '../hooks/canvasToolTypes.ts'

export interface CanvasCreationRegistryItem {
    description?: string
    tooltip: string
    shortcut: typeof CANVAS_TOOL_SHORTCUTS[keyof typeof CANVAS_TOOL_SHORTCUTS]
    Icon: ComponentType<{ className?: string }>
}

export const CANVAS_CREATION_REGISTRY: Record<ConversationNodeType, CanvasCreationRegistryItem> = {
    chat: {
        description: "包含用户提问与 AI 回答的双栏对话卡片。",
        tooltip: "Chat",
        shortcut: "c",
        Icon: ChatPlusIcon,
    },
    note: {
        description: "纯 Markdown 笔记卡片。",
        tooltip: "Note",
        shortcut: "n",
        Icon: NotePlusIcon,
    },
}
