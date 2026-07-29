import { useCallback, useEffect, useRef, useState } from "react"
import {
    FORKMIND_WORKSPACE_FORMAT,
    FORKMIND_WORKSPACE_VERSION,
    type ForkMindWorkspaceDocument,
    validateAndNormalizeWorkspace,
} from "../domain/workspace"
import {
    abortAppCloseFromBridge,
    completeAppCloseFromBridge,
    loadWorkspaceFromBridge,
    saveWorkspaceToBridge,
    subscribeAppBeforeClose,
    type BridgeErrorPayload,
} from "../bridge"
import { useAISettingsStore } from "../stores/useAISettingsStore"
import { useConversationStore } from "../stores/useConversationStore"
import { useWorkspaceStore } from "../stores/useWorkspaceStore"

const WORKSPACE_SAVE_DEBOUNCE_MS = 800
const WORKSPACE_CLOSE_ERROR_CODE = "workspace_close_failed"
const WORKSPACE_NOT_READY_ERROR: BridgeErrorPayload = {
    code: WORKSPACE_CLOSE_ERROR_CODE,
    message: "工作区尚未完成初始化 当前关闭请求已取消",
    retryable: true,
}

export type WorkspacePersistenceStatus =
    | "loading"
    | "idle"
    | "dirty"
    | "saving"
    | "saved"
    | "error"
    | "unavailable"

interface WorkspaceHydrationOutcome {
    canSave: boolean
    status: WorkspacePersistenceStatus
    error: BridgeErrorPayload | null
}

/**
 * 把关闭流程中的未知异常转换为稳定的 Bridge 错误结构
 * @param error 入参来自快照构造 保存队列或关闭 Bridge 的未知异常
 * @returns 返回可直接展示给用户的持久化错误 不会返回 null
 * 用户关闭窗口且正常错误响应之外仍出现异常时触发
 */
function normalizeWorkspaceCloseError(error: unknown): BridgeErrorPayload {
    return {
        code: WORKSPACE_CLOSE_ERROR_CODE,
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
    }
}

let workspaceHydrationPromise: Promise<WorkspaceHydrationOutcome> | null = null

/**
 * 从当前两个 Store 构造可持久化工作区文档
 * API Key 位于 AISettingsStore 独立字段且不会进入该返回值
 */
export function createWorkspaceDocumentSnapshot(): ForkMindWorkspaceDocument {
    const workspaceState = useWorkspaceStore.getState()
    const activeThread = useConversationStore.getState().activeThread
    const settings = useAISettingsStore.getState().persistedSettings
    const activeThreadExists = workspaceState.threads.some(
        (thread) => thread.id === activeThread.id,
    )
    const synchronizedThreads = activeThreadExists
        ? workspaceState.threads.map((thread) =>
            thread.id === activeThread.id ? activeThread : thread,
        )
        : [...workspaceState.threads, activeThread]

    return {
        format: FORKMIND_WORKSPACE_FORMAT,
        version: FORKMIND_WORKSPACE_VERSION,
        activeThreadId: workspaceState.activeThreadId,
        threads: synchronizedThreads,
        settings: { ...settings },
        lastModified: new Date().toISOString(),
    }
}

/**
 * 执行一次全局工作区水化
 * React StrictMode 下多个 Hook 实例复用同一个 Promise 避免重复读取和覆盖 Store
 */
async function hydrateWorkspaceOnce(): Promise<WorkspaceHydrationOutcome> {
    const response = await loadWorkspaceFromBridge()
    if (response.error) {
        return {
            canSave: false,
            status: response.error.code === "bridge_unavailable" ? "unavailable" : "error",
            error: response.error,
        }
    }
    if (!response.exists) {
        return { canSave: true, status: "idle", error: null }
    }

    const validationResult = validateAndNormalizeWorkspace(response.workspace)
    if (!validationResult.ok) {
        return {
            canSave: false,
            status: "error",
            error: {
                code: validationResult.error.code,
                message: `${validationResult.error.message} (${validationResult.error.path})`,
                retryable: false,
            },
        }
    }

    const document = validationResult.value
    useAISettingsStore.getState().hydratePersistedSettings(document.settings)
    const activeThread = useWorkspaceStore
        .getState()
        .hydrateWorkspace(document.threads, document.activeThreadId)
    useConversationStore.getState().setActiveThread(activeThread)

    return { canSave: true, status: "saved", error: null }
}

/**
 * 本地工作区水化与防抖保存调度器
 * 返回值用于 UI 展示保存状态 不把持久化错误混入 Conversation Store
 */
export function useWorkspacePersistence() {
    const threads = useWorkspaceStore((state) => state.threads)
    const activeThreadId = useWorkspaceStore((state) => state.activeThreadId)
    const persistedSettings = useAISettingsStore((state) => state.persistedSettings)
    const [status, setStatus] = useState<WorkspacePersistenceStatus>("loading")
    const [error, setError] = useState<BridgeErrorPayload | null>(null)
    const [canSave, setCanSave] = useState(false)
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
    const latestSaveRevisionRef = useRef(0)
    const saveTimerRef = useRef<number | null>(null)
    const isCloseHandshakeRunningRef = useRef(false)

    /**
     * 把工作区快照追加到单线程保存队列
     * @param document 入参来自调度时刻的 Store 完整快照
     * @param revision 入参是该快照对应的单调递增版本号
     * @returns 返回本次保存错误 null 表示磁盘写入成功
     * 防抖到期 手动 flush 或应用关闭前最终保存时触发
     */
    const enqueueWorkspaceSave = useCallback((
        document: ForkMindWorkspaceDocument,
        revision: number,
    ): Promise<BridgeErrorPayload | null> => {
        const saveResultPromise = saveQueueRef.current.then(async () => {
            setStatus("saving")
            const response = await saveWorkspaceToBridge(document)
            if (response.error) {
                setStatus("error")
                setError(response.error)
                return response.error
            }

            if (revision === latestSaveRevisionRef.current) {
                setStatus("saved")
                setLastSavedAt(document.lastModified)
            }
            return null
        })

        // 队列本身始终恢复为 fulfilled 防止一次失败阻断后续保存
        saveQueueRef.current = saveResultPromise.then(() => undefined, () => undefined)
        return saveResultPromise
    }, [])

    /**
     * 立即保存当前最新工作区并等待此前排队任务完成
     * @returns 返回最终保存错误 null 表示可以安全继续关闭应用
     * Wails before-close 事件触发时会跳过 800ms 防抖直接调用
     */
    const flushWorkspaceNow = useCallback(async (): Promise<BridgeErrorPayload | null> => {
        // 关闭可能发生在首次磁盘读取完成前 必须先确定内存 Store 已完成水合
        workspaceHydrationPromise ??= hydrateWorkspaceOnce()
        const hydrationOutcome = await workspaceHydrationPromise
        if (!hydrationOutcome.canSave) {
            return hydrationOutcome.error ?? WORKSPACE_NOT_READY_ERROR
        }
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
        }

        const revision = latestSaveRevisionRef.current + 1
        latestSaveRevisionRef.current = revision
        setStatus("dirty")
        setError(null)

        return enqueueWorkspaceSave(createWorkspaceDocumentSnapshot(), revision)
    }, [enqueueWorkspaceSave])

    useEffect(() => {
        let isMounted = true
        workspaceHydrationPromise ??= hydrateWorkspaceOnce()

        void workspaceHydrationPromise.then((outcome) => {
            if (!isMounted) {
                return
            }

            setCanSave(outcome.canSave)
            setStatus(outcome.status)
            setError(outcome.error)
            if (outcome.status === "saved") {
                setLastSavedAt(new Date().toISOString())
            }
        })

        return () => {
            isMounted = false
        }
    }, [])

    useEffect(() => {
        if (!canSave) {
            return
        }

        const revision = latestSaveRevisionRef.current + 1
        latestSaveRevisionRef.current = revision
        setStatus("dirty")
        setError(null)

        const saveTimer = window.setTimeout(() => {
            saveTimerRef.current = null
            const document = createWorkspaceDocumentSnapshot()
            void enqueueWorkspaceSave(document, revision)
        }, WORKSPACE_SAVE_DEBOUNCE_MS)
        saveTimerRef.current = saveTimer

        return () => {
            window.clearTimeout(saveTimer)
            if (saveTimerRef.current === saveTimer) {
                saveTimerRef.current = null
            }
        }
    }, [activeThreadId, canSave, enqueueWorkspaceSave, persistedSettings, threads])

    useEffect(() => subscribeAppBeforeClose(() => {
        if (isCloseHandshakeRunningRef.current) {
            return
        }
        isCloseHandshakeRunningRef.current = true

        void (async () => {
            let closeError: BridgeErrorPayload | null = null

            try {
                closeError = await flushWorkspaceNow()
                if (!closeError) {
                    const closeResponse = await completeAppCloseFromBridge()
                    closeError = closeResponse.error ?? null
                }
            } catch (error) {
                closeError = normalizeWorkspaceCloseError(error)
            }

            if (!closeError) {
                return
            }

            setStatus("error")
            setError(closeError)

            // 只要最终保存或退出确认失败 就必须恢复为可重试关闭状态
            const abortResponse = await abortAppCloseFromBridge()
            if (abortResponse.error) {
                setError(abortResponse.error)
            }
            isCloseHandshakeRunningRef.current = false
        })()
    }), [flushWorkspaceNow])

    return {
        status,
        error,
        lastSavedAt,
    }
}
