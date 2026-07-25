import { useEffect, useRef, useState } from "react"
import {
    FORKMIND_WORKSPACE_FORMAT,
    FORKMIND_WORKSPACE_VERSION,
    type ForkMindWorkspaceDocument,
    validateAndNormalizeWorkspace,
} from "../domain/workspace"
import {
    loadWorkspaceFromBridge,
    saveWorkspaceToBridge,
    type BridgeErrorPayload,
} from "../bridge"
import { useAISettingsStore } from "../stores/useAISettingsStore"
import { useConversationStore } from "../stores/useConversationStore"
import { useWorkspaceStore } from "../stores/useWorkspaceStore"

const WORKSPACE_SAVE_DEBOUNCE_MS = 800

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

let workspaceHydrationPromise: Promise<WorkspaceHydrationOutcome> | null = null

/**
 * 从当前两个 Store 构造可持久化工作区文档
 * API Key 位于 AISettingsStore 独立字段且不会进入该返回值
 */
function createWorkspaceDocument(): ForkMindWorkspaceDocument {
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
            const document = createWorkspaceDocument()

            saveQueueRef.current = saveQueueRef.current.then(async () => {
                setStatus("saving")
                const response = await saveWorkspaceToBridge(document)
                if (response.error) {
                    setStatus("error")
                    setError(response.error)
                    return
                }

                if (revision === latestSaveRevisionRef.current) {
                    setStatus("saved")
                    setLastSavedAt(document.lastModified)
                }
            })
        }, WORKSPACE_SAVE_DEBOUNCE_MS)

        return () => {
            window.clearTimeout(saveTimer)
        }
    }, [activeThreadId, canSave, persistedSettings, threads])

    return {
        status,
        error,
        lastSavedAt,
    }
}
