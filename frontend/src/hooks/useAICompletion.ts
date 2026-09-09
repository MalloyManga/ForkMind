import { useCallback, useEffect, useRef, useState } from "react"
import {
    cancelChatCompletionFromBridge,
    startChatCompletionFromBridge,
    subscribeAIEvents,
    type BridgeErrorPayload,
} from "../bridge"
import { useAISettingsStore } from "../stores/useAISettingsStore"
import { useConversationStore } from "../stores/useConversationStore"
import {
    bufferAIEvent,
    takeResidualForThread,
    type ResidualAIRequest,
} from "../bridge/residualAIEventBuffer"
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

    /**
     * 依序重放一条残留请求的全部事件
     * @param residual 入参来自 takeResidualForThread 取出的整条缓冲记录
     * @returns 无返回值 各事件直接路由到 Store 动作
     * Store 自身的状态守卫保证重放安全: 节点已删除或状态已变化时动作自动空转
     */
    const replayResidualEvents = useCallback((residual: ResidualAIRequest) => {
        const conversationState = useConversationStore.getState()

        for (const item of residual.events) {
            switch (item.kind) {
                case "chunk":
                    conversationState.appendChatResponseChunk(item.event.nodeId, item.event.delta)
                    break
                case "canvasPlan":
                    setPendingCanvasPlan({
                        requestId: item.event.requestId,
                        threadId: residual.threadId,
                        sourceNodeId: item.event.nodeId,
                        schemaVersion: item.event.schemaVersion,
                        plan: item.event.plan,
                    })
                    break
                case "done":
                    if (item.event.cancelled) {
                        conversationState.cancelChatResponse(item.event.nodeId)
                    } else {
                        conversationState.completeChatResponse(item.event.nodeId)
                    }
                    break
                case "error":
                    conversationState.failChatResponse(item.event.nodeId)
                    setError(item.event.error)
                    break
            }
        }
    }, [])

    // 最新 plan 快照 供线程切换 effect 读取 避免把 state 放进依赖导致 effect 因 plan 变化反复空跑
    const pendingCanvasPlanRef = useRef<PendingCanvasPlan | null>(pendingCanvasPlan)
    useEffect(() => {
        pendingCanvasPlanRef.current = pendingCanvasPlan // 时刻读取到当前线程的最新 pendingCanvasPlan
    })

    // 线程切换时处理残留 AI 请求: 旧线程未结算的 plan 移入缓冲 新线程有缓冲则按序重放
    // 依赖只有 activeThreadId 与稳定函数 因此只在切换线程时执行一次 不存在循环触发
    useEffect(() => {
        const plan = pendingCanvasPlanRef.current
        if (plan && plan.threadId !== activeThreadId) {
            // 用户切走时 plan 提案尚未结算 移入缓冲 切回后由重放恢复 避免提案永久丢失
            bufferAIEvent(
                plan.requestId,
                plan.sourceNodeId,
                plan.threadId,
                {
                    kind: "canvasPlan",
                    event: {
                        requestId: plan.requestId,
                        nodeId: plan.sourceNodeId,
                        schemaVersion: plan.schemaVersion,
                        plan: plan.plan,
                    },
                },
            )
            setPendingCanvasPlan(null)
        }

        // 监听 activeThreadId 切回时取出该线程的残留请求并依序重放
        // 取走即从缓冲移除 即使重放被 Store 守卫空转也不会二次重放
        const residual = takeResidualForThread(activeThreadId) // 切换回原线程时尝试取出缓存 pendingCanvasPlan 并重新
        if (residual) {
            replayResidualEvents(residual)
        }
    }, [activeThreadId, replayResidualEvents])

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
            // 只认本 hook 发起的请求 其他请求的事件一律丢弃
            if (
                !activeRequest ||
                event.requestId !== activeRequest.requestId ||
                event.nodeId !== activeRequest.nodeId
            ) {
                return
            }

            // 线程不符: 事件写入残留缓冲 等待用户切回该线程后重放
            // 不再直接丢弃 避免节点永久卡在 streaming 状态
            if (conversationState.activeThread.id !== activeRequest.threadId) {
                bufferAIEvent(activeRequest.requestId, activeRequest.nodeId, activeRequest.threadId, {
                    kind: "chunk",
                    event,
                })
                return
            }

            // 收到 eventdelta 时 append
            conversationState.appendChatResponseChunk(event.nodeId, event.delta)
        },
        onDone: (event) => {
            const activeRequest = activeRequestRef.current
            const conversationState = useConversationStore.getState()
            if (
                !activeRequest ||
                event.requestId !== activeRequest.requestId ||
                event.nodeId !== activeRequest.nodeId
            ) {
                return
            }

            // 线程不符: done 是终止事件 缓冲后请求即判定死亡
            // 释放全局单活锁 用户在别的线程可以立即开始新生成 无需等切回原线程
            if (conversationState.activeThread.id !== activeRequest.threadId) {
                const buffered = bufferAIEvent(activeRequest.requestId, activeRequest.nodeId, activeRequest.threadId, {
                    kind: "done",
                    event,
                })
                if (buffered.settled) {
                    clearActiveRequest(activeRequest.requestId)
                }
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
                event.nodeId !== activeRequest.nodeId
            ) {
                return
            }

            // 线程不符: error 是终止事件 缓冲后请求即判定死亡
            // 错误详情不跨线程弹出 等用户切回原线程时由重放统一呈现
            if (conversationState.activeThread.id !== activeRequest.threadId) {
                const buffered = bufferAIEvent(activeRequest.requestId, activeRequest.nodeId, activeRequest.threadId, {
                    kind: "error",
                    event,
                })
                if (buffered.settled) {
                    clearActiveRequest(activeRequest.requestId)
                }
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

            // 线程不符: plan 提案写入缓冲 切回后随重放恢复 避免提案永久丢失
            if (useConversationStore.getState().activeThread.id !== activeRequest.threadId) {
                bufferAIEvent(activeRequest.requestId, activeRequest.nodeId, activeRequest.threadId, {
                    kind: "canvasPlan",
                    event,
                })
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
