import type { ConversationNodeType } from "./types"

/**
 * 画布创建模式类型（当前与节点类型一一对应）。
 * 业务场景：底部创建模式条、单击空白创建、handle 拖拽创建共享同一套类型入口。
 */
export type ConversationCreationType = ConversationNodeType

/**
 * 创建模式按钮所需的图标 key。
 * 业务场景：把 UI 图标选择权从组件内 if/else 抽离，后续扩展新节点类型时只改注册表。
 */
export type ConversationCreationIconKey = "chat" | "note"

export interface ConversationNodeRegistryItem {
    type: ConversationCreationType
    label: string
    description: string
    iconKey: ConversationCreationIconKey
}

/**
 * 节点类型注册表（全局唯一入口）。
 * 业务场景：未来新增 image/link/file 节点时，只需要在这里追加一项，
 * 渲染层通过 map（等价 Nuxt 的 v-for）自动拿到新类型，避免多处硬编码。
 */
export const CONVERSATION_NODE_REGISTRY: readonly ConversationNodeRegistryItem[] = [
    {
        type: "chat",
        label: "Chat",
        description: "包含用户提问与 AI 回答的双栏对话卡片。",
        iconKey: "chat",
    },
    {
        type: "note",
        label: "Note",
        description: "纯 Markdown 笔记卡片。",
        iconKey: "note",
    },
] as const
