import { create } from "zustand"
import { NODE_STATUS_DONE } from "../domain/conversation/constants"
import type {
    ConversationCard,
    ConversationThread,
} from "../domain/conversation/types"

const initialCards: ConversationCard[] = [
    {
        id: "root-1",
        userPrompt: "解释一下 Rust 所有权模型。",
        aiResponse: "所有权是 Rust 的核心内存安全机制。",
        parentId: null,
        status: NODE_STATUS_DONE,
        createdAt: "2026-03-30T10:00:00.000Z",
        updatedAt: "2026-03-30T10:01:00.000Z",
    },
    {
        id: "root-2",
        userPrompt: "Vue 组合式 API 和 React Hooks 的差异是什么？",
        aiResponse: "两者都强调逻辑复用，但生态与语法心智模型不同。",
        parentId: null,
        status: NODE_STATUS_DONE,
        createdAt: "2026-03-30T10:02:00.000Z",
        updatedAt: "2026-03-30T10:03:00.000Z",
    },
    {
        id: "root-3",
        userPrompt: "如何设计可扩展的 prompt 模板？",
        aiResponse: "建议把 prompt 拆成固定协议层与业务插槽层。",
        parentId: null,
        status: NODE_STATUS_DONE,
        createdAt: "2026-03-30T10:04:00.000Z",
        updatedAt: "2026-03-30T10:05:00.000Z",
    },
    {
        id: "root-4",
        userPrompt: "Go 中 context 的最佳实践？",
        aiResponse: "从入口向下传递，不放业务数据，不存全局。",
        parentId: null,
        status: NODE_STATUS_DONE,
        createdAt: "2026-03-30T10:06:00.000Z",
        updatedAt: "2026-03-30T10:07:00.000Z",
    },
]

interface ConversationStoreState {
    activeThread: ConversationThread
    setActiveThread: (thread: ConversationThread) => void

    /**
     * 批量写入函数(导入json 初始化之后从后台导入)
     */
    setCards: (cards: ConversationCard[]) => void
}

/**
 * 初始线程（默认对话）
 * 当前只维护单线程，后续扩展多会话时可以升级成 `threads + activeThreadId` 结构。
 */
const initialThread: ConversationThread = {
    id: "thread-default",
    title: "默认对话",
    cards: initialCards,
}

export const useConversationStore = create<ConversationStoreState>()((set) => ({
    activeThread: initialThread,
    setActiveThread: (thread) => set({ activeThread: thread }),
    setCards: (cards) => {
        set((state) => ({
            activeThread: {
                ...state.activeThread,
                // 创建新卡片数组覆盖展开的旧卡片
                cards: [...cards],
            },
        }))
    },
}))
