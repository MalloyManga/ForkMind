import { NODE_STATUS_DONE } from "../../domain/conversation/constants"
import type { ConversationCard, ConversationThread } from "../../domain/conversation/types"
import { createDefaultSize } from "./helpers"

/**
 * 阶段二演示用初始数据。
 * 业务场景：项目启动后用于验证“chat + note 混合节点”的编辑链路。
 */
const initialCards: ConversationCard[] = [
    {
        id: "root-chat-1",
        type: "chat",
        userPrompt: "解释一下 Rust 所有权模型。",
        aiResponse: "所有权是 Rust 的核心内存安全机制。",
        parentId: null,
        referenceNodeIds: undefined,
        position: { x: 0, y: 0 },
        size: createDefaultSize(),
        status: NODE_STATUS_DONE,
        createdAt: "2026-03-30T10:00:00.000Z",
        updatedAt: "2026-03-30T10:01:00.000Z",
    },
    {
        id: "root-note-1",
        type: "note",
        noteContent: "这里是用户的 Markdown 笔记卡片。",
        parentId: null,
        referenceNodeIds: undefined,
        position: { x: 420, y: 0 },
        size: createDefaultSize(),
        status: NODE_STATUS_DONE,
        createdAt: "2026-03-30T10:02:00.000Z",
        updatedAt: "2026-03-30T10:03:00.000Z",
    },
    {
        id: "root-chat-2",
        type: "chat",
        userPrompt: "如何设计可扩展的 prompt 模板？",
        aiResponse: "建议把 prompt 拆成固定协议层与业务插槽层。",
        parentId: null,
        referenceNodeIds: undefined,
        position: { x: 0, y: 280 },
        size: createDefaultSize(),
        status: NODE_STATUS_DONE,
        createdAt: "2026-03-30T10:04:00.000Z",
        updatedAt: "2026-03-30T10:05:00.000Z",
    },
]

/**
 * 默认激活线程（即默认画布）。
 */
export const initialThread: ConversationThread = {
    id: "thread-default",
    title: "默认对话",
    cards: initialCards,
}
