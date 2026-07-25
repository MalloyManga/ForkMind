import { create } from "zustand"
import { DEFAULT_THREAD_TITLE } from "../../domain/conversation/constants"
import type { ConversationThread } from "../../domain/conversation/types"
import { cloneThread, createTimestamp } from "../conversationStore/helpers"
import { initialThread } from "../conversationStore/initialData"
import type { WorkspaceStoreState } from "./contracts"

/**
 * 生成工作区 Thread id
 * 新建会话时触发 返回值只用于 ConversationThread 的稳定身份
 */
function createThreadId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `thread-${crypto.randomUUID()}`
    }

    return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建空会话文档
 * @param title 入参来自新建会话动作 空字符串会降级为默认标题
 * @returns 返回带稳定 id 时间戳和空 cards 的 ConversationThread
 * 左侧栏点击新增或删除最后一个会话需要自动补位时触发
 */
function createEmptyThread(title?: string): ConversationThread {
    const now = createTimestamp()
    const normalizedTitle = title?.trim() || DEFAULT_THREAD_TITLE

    return {
        id: createThreadId(),
        title: normalizedTitle,
        cards: [],
        createdAt: now,
        updatedAt: now,
    }
}

/**
 * 工作区级 Zustand Store
 * threads 保存全部会话文档 activeThreadId 表示当前投影到画布的文档
 */
export const useWorkspaceStore = create<WorkspaceStoreState>()((set) => ({
    threads: [cloneThread(initialThread)],
    activeThreadId: initialThread.id,

    /**
     * 新建一个空会话并将其设为工作区 active
     */
    createThread: (title) => {
        const nextThread = createEmptyThread(title)

        set((state) => ({
            threads: [...state.threads, nextThread],
            activeThreadId: nextThread.id,
        }))

        return cloneThread(nextThread)
    },

    /**
     * 把 conversationStore 中的当前文档快照同步回工作区
     */
    upsertThread: (thread) => {
        set((state) => {
            const existingThreadIndex = state.threads.findIndex(
                (candidateThread) => candidateThread.id === thread.id,
            )
            const nextThread = cloneThread(thread)

            if (existingThreadIndex < 0) {
                return {
                    threads: [...state.threads, nextThread],
                }
            }

            const nextThreads = [...state.threads]
            nextThreads[existingThreadIndex] = nextThread
            return { threads: nextThreads }
        })
    },

    /**
     * 切换工作区当前会话 id
     * 不存在的 id 会被拒绝 避免 active 指向幽灵文档
     */
    setActiveThreadId: (threadId) => {
        set((state) => {
            const isThreadExists = state.threads.some((thread) => thread.id === threadId)
            return isThreadExists ? { activeThreadId: threadId } : {}
        })
    },

    /**
     * 重命名指定会话
     * 空标题降级为默认标题 updatedAt 用于持久化排序与脏检查
     */
    renameThread: (threadId, title) => {
        const normalizedTitle = title.trim() || DEFAULT_THREAD_TITLE
        const now = createTimestamp()

        set((state) => ({
            threads: state.threads.map((thread) =>
                thread.id === threadId
                    ? {
                        ...thread,
                        title: normalizedTitle,
                        updatedAt: now,
                    }
                    : thread,
            ),
        }))
    },

    /**
     * 删除指定会话并返回删除后应显示的会话
     * 删除最后一个会话时自动创建空会话 保证应用始终有可编辑文档
     */
    removeThread: (threadId) => {
        let nextActiveThread = cloneThread(initialThread)

        set((state) => {
            const remainingThreads = state.threads.filter((thread) => thread.id !== threadId)
            const nextThreads = remainingThreads.length > 0
                ? remainingThreads
                : [createEmptyThread()]

            const currentActiveThread = nextThreads.find(
                (thread) => thread.id === state.activeThreadId,
            )
            nextActiveThread = cloneThread(currentActiveThread ?? nextThreads[0])

            return {
                threads: nextThreads,
                activeThreadId: nextActiveThread.id,
            }
        })

        return nextActiveThread
    },

    /**
     * 使用本地持久化结果恢复整个工作区
     * @param threads 入参来自 Wails 读取并通过边界校验的会话集合
     * @param activeThreadId 入参来自 workspace index null 表示没有有效最近会话
     * @returns 返回恢复后需要投影到 conversationStore 的当前会话
     */
    hydrateWorkspace: (threads, activeThreadId) => {
        const normalizedThreads = threads.length > 0
            ? threads.map((thread) => cloneThread(thread))
            : [createEmptyThread()]
        const requestedActiveThread = normalizedThreads.find(
            (thread) => thread.id === activeThreadId,
        )
        const nextActiveThread = requestedActiveThread ?? normalizedThreads[0]

        set({
            threads: normalizedThreads,
            activeThreadId: nextActiveThread.id,
        })

        return cloneThread(nextActiveThread)
    },
}))
