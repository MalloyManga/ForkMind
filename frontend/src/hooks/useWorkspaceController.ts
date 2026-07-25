import { useCallback, useEffect } from "react"
import type { ConversationThread } from "../domain/conversation/types"
import { useConversationStore } from "../stores/useConversationStore"
import {
    selectWorkspaceActiveThreadId,
    selectWorkspaceThreads,
    useWorkspaceStore,
} from "../stores/useWorkspaceStore"

/**
 * 多会话编排层
 * conversationStore 管理当前画布高频状态 workspaceStore 管理全部会话文档
 * 该 Hook 负责在两者之间完成保存当前文档 切换目标文档和清理运行时历史
 */
export function useWorkspaceController() {
    const activeThread = useConversationStore((state) => state.activeThread)
    const setActiveThread = useConversationStore((state) => state.setActiveThread)
    const renameActiveThread = useConversationStore((state) => state.renameActiveThread)
    const forgetThreadRuntime = useConversationStore((state) => state.forgetThreadRuntime)

    const threads = useWorkspaceStore(selectWorkspaceThreads)
    const activeThreadId = useWorkspaceStore(selectWorkspaceActiveThreadId)
    const createWorkspaceThread = useWorkspaceStore((state) => state.createThread)
    const upsertWorkspaceThread = useWorkspaceStore((state) => state.upsertThread)
    const setWorkspaceActiveThreadId = useWorkspaceStore((state) => state.setActiveThreadId)
    const renameWorkspaceThread = useWorkspaceStore((state) => state.renameThread)
    const removeWorkspaceThread = useWorkspaceStore((state) => state.removeThread)

    useEffect(() => {
        // 当前画布任意业务变化都同步回工作区内存镜像
        // 本地磁盘防抖由后续 persistence scheduler 订阅 workspaceStore 处理
        upsertWorkspaceThread(activeThread)
    }, [activeThread, upsertWorkspaceThread])

    /**
     * 新建并切换到空会话
     * @param title 入参来自左侧栏新建动作 未传时使用领域默认标题
     * @returns 返回新建的 ConversationThread 便于后续聚焦或持久化
     */
    const createThread = useCallback((title?: string): ConversationThread => {
        const nextThread = createWorkspaceThread(title)
        setActiveThread(nextThread)
        return nextThread
    }, [createWorkspaceThread, setActiveThread])

    /**
     * 切换当前会话
     * @param threadId 入参来自左侧会话列表点击
     * 目标不存在或已经 active 时不产生任何状态变化
     */
    const switchThread = useCallback((threadId: string) => {
        if (threadId === activeThread.id) {
            return
        }

        upsertWorkspaceThread(activeThread)
        const targetThread = useWorkspaceStore
            .getState()
            .threads
            .find((thread) => thread.id === threadId)

        if (!targetThread) {
            return
        }

        setWorkspaceActiveThreadId(threadId)
        setActiveThread(targetThread)
    }, [activeThread, setActiveThread, setWorkspaceActiveThreadId, upsertWorkspaceThread])

    /**
     * 重命名指定会话
     * active 会话由 conversationStore 修改后自动同步 非 active 会话直接修改工作区镜像
     */
    const renameThread = useCallback((threadId: string, title: string) => {
        if (threadId === activeThread.id) {
            renameActiveThread(title)
            return
        }

        renameWorkspaceThread(threadId, title)
    }, [activeThread.id, renameActiveThread, renameWorkspaceThread])

    /**
     * 删除指定会话
     * 删除 active 会话后把工作区返回的下一会话投影到画布
     * 删除最后一个会话时 workspaceStore 会自动创建空白会话
     */
    const deleteThread = useCallback((threadId: string) => {
        const isDeletingActiveThread = threadId === activeThread.id
        const nextActiveThread = removeWorkspaceThread(threadId)
        forgetThreadRuntime(threadId)

        if (isDeletingActiveThread) {
            setActiveThread(nextActiveThread)
        }
    }, [activeThread.id, forgetThreadRuntime, removeWorkspaceThread, setActiveThread])

    return {
        threads,
        activeThreadId,
        createThread,
        switchThread,
        renameThread,
        deleteThread,
    }
}
