import { useCallback, useEffect, useRef, useState } from "react"
import {
    cancelChatCompletionFromBridge,
    startChatCompletionFromBridge,
    subscribeAIEvents,
    type BridgeErrorPayload,
} from "../bridge"
import { useAISettingsStore } from "../stores/useAISettingsStore"
import { useConversationStore } from "../stores/useConversationStore"
import type { PendingCanvasPlan } from "../domain/canvasPlan"
import {
    AI_REQUEST_ID_PREFIX,
    AI_ERROR_CODE_REQUEST_ACTIVE,
    AI_ERROR_CODE_INVALID_NODE,
    AI_ERROR_CODE_INVALID_SETTINGS
} from "../constants/aiCompletion"

/**
 * 当前的活跃请求实例接口
 */
interface ActiveAIRequest {
    requestId: string
    threadId: string
    nodeId: string
}

/**
 * AI 补全文本的 res
 */
export interface UseAICompletionResult {
    isRequestActive: boolean
    activeRequestNodeId: string | null
    error: BridgeErrorPayload | null
    pendingCanvasPlan: PendingCanvasPlan | null
    canStart: (nodeId: string) => boolean
    startCompletion: (nodeId: string, allowWebSearch: boolean) => Promise<void>
    cancelCompletion: (nodeId: string) => Promise<void>
    clearError: () => void
    acceptCanvasPlan: () => void
    rejectCanvasPlan: () => void
}

/**
 * 创建AI请求ID
 * @returns 
 */
function createAIRequestId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `${AI_REQUEST_ID_PREFIX}-${crypto.randomUUID()}`
    }

    return `${AI_REQUEST_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createClientError(code: string, message: string): BridgeErrorPayload {
    return {
        code,
        message,
        retryable: false,
    }
}

/**
 * 协调单个全局 OpenAI-compatible 流式请求
 * @returns 返回发送 取消 可用性和错误状态供 App 与右侧编辑栏消费
 * App 挂载时订阅 Wails Events 并把通过 requestId 校验的事件写入 conversationStore
 */
export function useAICompletion(): UseAICompletionResult {
    const activeRequestRef = useRef<ActiveAIRequest | null>(null) // 当前的活跃请求实例
    const [activeRequestNodeId, setActiveRequestNodeId] = useState<string | null>(null)
    const [error, setError] = useState<BridgeErrorPayload | null>(null)
    const [pendingCanvasPlan, setPendingCanvasPlan] = useState<PendingCanvasPlan | null>(null)
    const activeThreadId = useConversationStore((state) => state.activeThread.id)

    useEffect(() => {
        setPendingCanvasPlan((currentPlan) =>
            currentPlan && currentPlan.threadId !== activeThreadId ? null : currentPlan,
        )
    }, [activeThreadId])

    const clearActiveRequest = useCallback((requestId: string) => {
        if (activeRequestRef.current?.requestId !== requestId) {
            return
        }

        activeRequestRef.current = null
        setActiveRequestNodeId(null)
    }, [])

    // 创建 wails event 的 AI res 触发的回调函数
    useEffect(() => subscribeAIEvents({
        onChunk: (event) => {
            const activeRequest = activeRequestRef.current
            const conversationState = useConversationStore.getState()

            // wails 事件总线为全局广播 每一个 hook 都需要做过滤
            if (
                !activeRequest ||
                event.requestId !== activeRequest.requestId ||
                event.nodeId !== activeRequest.nodeId ||
                conversationState.activeThread.id !== activeRequest.threadId
            ) {
                return
            }

            // 收到 eventdealta 时 append
            conversationState.appendChatResponseChunk(event.nodeId, event.delta)
        },
        onDone: (event) => {
            const activeRequest = activeRequestRef.current
            const conversationState = useConversationStore.getState()
            if (
                !activeRequest ||
                event.requestId !== activeRequest.requestId ||
                event.nodeId !== activeRequest.nodeId ||
                conversationState.activeThread.id !== activeRequest.threadId
            ) {
                return
            }

            if (event.cancelled) {
                conversationState.cancelChatResponse(event.nodeId)
            } else {
                conversationState.completeChatResponse(event.nodeId)
            }
            clearActiveRequest(event.requestId)
        },
        onError: (event) => {
            const activeRequest = activeRequestRef.current
            const conversationState = useConversationStore.getState()
            if (
                !activeRequest ||
                event.requestId !== activeRequest.requestId ||
                event.nodeId !== activeRequest.nodeId ||
                conversationState.activeThread.id !== activeRequest.threadId
            ) {
                return
            }

            conversationState.failChatResponse(event.nodeId)
            setError(event.error)
            clearActiveRequest(event.requestId)
        },
        onCanvasPlan: (event) => {
            const activeRequest = activeRequestRef.current
            if (!activeRequest || event.requestId !== activeRequest.requestId || event.nodeId !== activeRequest.nodeId) {
                return
            }

            setPendingCanvasPlan({
                requestId: event.requestId,
                threadId: activeRequest.threadId,
                sourceNodeId: event.nodeId,
                schemaVersion: event.schemaVersion,
                plan: event.plan,
            })
        },
    }), [clearActiveRequest])

    /**
     * 判断指定 Chat 节点当前是否允许发送
     * @param nodeId 入参来自右侧编辑栏 active node id
     * @returns 返回 true 表示没有其他活动请求 且目标节点存在并包含非空 Prompt
     * 组件每次渲染发送按钮时触发 用于统一按钮禁用条件
     */
    const canStart = useCallback((nodeId: string): boolean => {
        if (activeRequestRef.current) {
            return false
        }

        const targetNode = useConversationStore
            .getState()
            .activeThread.cards
            .find((node) => node.id === nodeId)
        return targetNode?.cardType === "chat" && targetNode.userPrompt.trim().length > 0
    }, [])

    /**
     * 启动指定 Chat 节点的流式生成
     * @param nodeId 入参来自 Send 或 Regenerate 按钮 读取当前chat节点的prompt信息
     * @param allowWebSearch 入参来自右侧栏本轮联网开关 true 时由 Go 请求 Provider 原生 web_search
     * @returns Promise 在 Wails 接受或拒绝启动请求后完成 实际文本继续通过事件到达
     * 用户发送 Prompt 时触发 并在调用 Bridge 前建立唯一活动请求和撤销基线
     */
    const startCompletion = useCallback(async (nodeId: string, allowWebSearch: boolean): Promise<void> => {
        if (activeRequestRef.current) {
            setError(createClientError(
                AI_ERROR_CODE_REQUEST_ACTIVE,
                "当前已有生成任务 请先停止或等待完成",
            ))
            return
        }

        const conversationState = useConversationStore.getState() // 复用当前会话状态供后续使用
        // 缓存旧回答用于 Bridge 失败时恢复（Store.startChatResponse 会将其清空为 ""）
        const targetCard = conversationState.activeThread.cards.find((n) => n.id === nodeId)
        let prevResponse = ""
        if (targetCard?.cardType === "chat") {
            prevResponse = targetCard.aiResponse ?? ""
        }

        const settingsState = useAISettingsStore.getState() // 读取当前的apikey以及baseurl
        const { persistedSettings, apiKey } = settingsState
        // 未配置
        if (!persistedSettings.baseUrl.trim() || !persistedSettings.model.trim()) {
            setError(createClientError(
                AI_ERROR_CODE_INVALID_SETTINGS,
                "请先配置 Base URL 和模型名称",
            ))
            return
        }

        // store 检测是否可以开始生成(无效与幽灵card) 并清空旧回答进入 streaming 状态
        if (!conversationState.startChatResponse(nodeId)) {
            setError(createClientError(
                AI_ERROR_CODE_INVALID_NODE,
                "当前节点无法开始生成 请检查 Prompt 和节点状态",
            ))
            return
        }

        const requestId = createAIRequestId() // 创建 reqId 为后续的时间路由提供匹配按键
        const activeRequest: ActiveAIRequest = {
            requestId,
            threadId: conversationState.activeThread.id,
            nodeId,
        }
        const requestThread = conversationState.activeThread

        activeRequestRef.current = activeRequest
        setActiveRequestNodeId(nodeId)
        setError(null)
        setPendingCanvasPlan(null)

        // 通过 react bridge 正式调用
        const response = await startChatCompletionFromBridge({
            requestId,
            thread: requestThread,
            activeNodeId: nodeId,
            config: {
                baseUrl: persistedSettings.baseUrl.trim(),
                apiKey,
                model: persistedSettings.model.trim(),
            },
            allowWebSearch,
        })

        if (response.error && activeRequestRef.current?.requestId === requestId) {
            // 恢复旧回答文本（Bridge 返回 error 时的乐观回退）
            useConversationStore.getState().updateChatResponse(nodeId, prevResponse)
            useConversationStore.getState().failChatResponse(nodeId)
            setError(response.error)
            clearActiveRequest(requestId)
        }
    }, [clearActiveRequest])

    /**
     * 请求停止指定 Chat 节点的流式生成
     * @param nodeId 入参来自当前右侧编辑栏 Stop 按钮 用于防止停止其他节点请求
     * @returns Promise 在取消命令送达 Wails 后完成 节点最终状态由 cancelled done 事件决定
     * 用户主动终止长回答时触发 已接收文本会被 Store 保留
     */
    const cancelCompletion = useCallback(async (nodeId: string): Promise<void> => {
        const activeRequest = activeRequestRef.current
        if (!activeRequest || activeRequest.nodeId !== nodeId) {
            return
        }

        const response = await cancelChatCompletionFromBridge({
            requestId: activeRequest.requestId,
        })
        if (response.error && activeRequestRef.current?.requestId === activeRequest.requestId) {
            setError(response.error)
        }
    }, [])

    /**
     * 接受当前 AI 画布提案并交给 Zustand 单事务落盘
     * @returns 无返回值 来源会话已切换或节点失效时 Store 会返回空结果
     * 用户点击右侧栏 Accept 时触发
     */
    const acceptCanvasPlan = useCallback(() => {
        const proposal = pendingCanvasPlan
        if (!proposal || useConversationStore.getState().activeThread.id !== proposal.threadId) {
            setPendingCanvasPlan(null)
            return
        }

        useConversationStore.getState().applyCanvasPlan({
            plan: proposal.plan,
            sourceNodeId: proposal.sourceNodeId,
        })
        setPendingCanvasPlan(null)
    }, [pendingCanvasPlan])

    const rejectCanvasPlan = useCallback(() => {
        setPendingCanvasPlan(null)
    }, [])

    return {
        isRequestActive: activeRequestNodeId !== null,
        activeRequestNodeId,
        error,
        pendingCanvasPlan,
        canStart,
        startCompletion,
        cancelCompletion,
        clearError: () => setError(null),
        acceptCanvasPlan,
        rejectCanvasPlan,
    }
}
