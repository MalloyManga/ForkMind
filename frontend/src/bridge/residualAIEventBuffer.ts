import type {
    AIStreamChunkEvent,
    AIStreamDoneEvent,
    AIStreamErrorEvent,
    AICanvasPlanEvent,
} from "./contracts"

/**
 * 残留事件统一载荷
 * kind 区分四类 Wails AI 事件 重放时按 kind 路由到对应 Store 动作
 * 事件按到达顺序入队 保证 chunk 追加与终止收口的先后关系不丢失
 */
export type ResidualAIEvent =
    | { kind: "chunk"; event: AIStreamChunkEvent }
    | { kind: "done"; event: AIStreamDoneEvent }
    | { kind: "error"; event: AIStreamErrorEvent }
    | { kind: "canvasPlan"; event: AICanvasPlanEvent }

/**
 * 单条残留请求的缓冲记录
 * threadId 记录请求归属线程 用户切回该线程时才会重放
 * settled 表示已收到终止事件 done/error 请求已死亡 调用方可以释放全局单活锁
 * settledAt 用于内存上限触发时淘汰最老的已终止条目
 */
export interface ResidualAIRequest {
    requestId: string
    nodeId: string
    threadId: string
    events: ResidualAIEvent[]
    settled: boolean
    settledAt: number
}

// 残留缓冲本体: 复合 key `${requestId}:${nodeId}` -> 请求记录
// 单活请求语义下同一时刻最多 1 条未终止缓冲 积压的都是已终止且用户未再访问的线程
const residualRequests = new Map<string, ResidualAIRequest>()

// 残留在途请求的内存上限 超出后淘汰最老的已终止条目 防止长时间重度使用后无限增长
const MAX_RESIDUAL_REQUESTS = 16

/**
 * 拼接残留缓冲的复合 key
 * requestId 全局唯一 加上 nodeId 是为未来多请求并发预留的防碰撞兜底
 */
function buildResidualKey(requestId: string, nodeId: string): string {
    return `${requestId}:${nodeId}`
}

/**
 * 淘汰最老的已终止残留请求
 * 仅在缓冲达到内存上限时触发 未终止的请求不会被淘汰
 * 因为未终止请求背后是当前唯一活跃请求 淘汰它会导致事件永久丢失
 */
function evictOldestSettled(): void {
    let oldestKey: string | null = null
    let oldestAt = Infinity

    for (const [key, entry] of residualRequests) {
        if (entry.settled && entry.settledAt < oldestAt) {
            oldestAt = entry.settledAt
            oldestKey = key
        }
    }

    if (oldestKey) {
        residualRequests.delete(oldestKey)
    }
}

/**
 * 写入一条残留 AI 事件
 * @param requestId 入参来自校验通过的 Wails AI 事件
 * @param nodeId 入参是事件对应的聊天节点 id
 * @param threadId 入参是请求归属线程 id
 * @param event 入参是已解析的 AI 事件 按 kind 区分路由
 * @returns 返回该请求的残留记录 写入终止事件后调用方可读取 settled 释放全局单活锁
 * AI 事件到达且发现所属线程不是当前 activeThread 时触发 事件被暂存等待线程切回后重放
 */
export function bufferAIEvent(
    requestId: string,
    nodeId: string,
    threadId: string,
    event: ResidualAIEvent,
): ResidualAIRequest {
    const key = buildResidualKey(requestId, nodeId)
    let entry = residualRequests.get(key)
    if (!entry) {
        if (residualRequests.size >= MAX_RESIDUAL_REQUESTS) {
            evictOldestSettled()
        }
        entry = {
            requestId,
            nodeId,
            threadId,
            events: [],
            settled: false,
            settledAt: 0,
        }
        residualRequests.set(key, entry)
    }

    entry.events.push(event)
    if (event.kind === "done" || event.kind === "error") {
        entry.settled = true
        entry.settledAt = Date.now()
    }
    return entry
}

/**
 * 取走指定线程的残留请求
 * @param threadId 入参是当前刚刚切换到的 activeThread id
 * @returns 返回该线程的残留请求(含全部事件) 无残留返回 null
 * 用户切回残留请求归属线程时触发 取走即从缓冲移除 调用方重放完毕后不会二次重放
 */
export function takeResidualForThread(threadId: string): ResidualAIRequest | null {
    for (const [key, entry] of residualRequests) {
        if (entry.threadId === threadId) {
            residualRequests.delete(key)
            return entry
        }
    }
    return null
}

/**
 * 删除指定线程的残留缓冲
 * @param threadId 入参是正在被删除的线程 id
 * 用户删除一个仍有残留请求的线程时触发 线程已不存在 缓冲失去重放意义 立即释放内存
 */
export function dropResidualAIRequest(threadId: string): void {
    for (const [key, entry] of residualRequests) {
        if (entry.threadId === threadId) {
            residualRequests.delete(key)
        }
    }
}

/**
 * 清空全部残留缓冲
 * 工作区整体导入或重置后触发 旧请求 id 与新文档无任何关联 全部释放
 */
export function clearAllResidualAIRequests(): void {
    residualRequests.clear()
}
