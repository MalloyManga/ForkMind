import { EventsOn } from "../../wailsjs/runtime/runtime"
import type {
    AIStreamChunkEvent,
    AIStreamDoneEvent,
    AIStreamErrorEvent,
    BridgeErrorPayload,
} from "./contracts"

const AI_EVENT_CHUNK = "forkmind:ai:chunk"
const AI_EVENT_DONE = "forkmind:ai:done"
const AI_EVENT_ERROR = "forkmind:ai:error"

type UnknownRecord = Record<string, unknown>

interface AIEventHandlers {
    onChunk: (event: AIStreamChunkEvent) => void
    onDone: (event: AIStreamDoneEvent) => void
    onError: (event: AIStreamErrorEvent) => void
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseBridgeError(value: unknown): BridgeErrorPayload | null {
    if (!isUnknownRecord(value)) {
        return null
    }
    if (
        typeof value.code !== "string" ||
        typeof value.message !== "string" ||
        typeof value.retryable !== "boolean"
    ) {
        return null
    }

    return {
        code: value.code,
        message: value.message,
        retryable: value.retryable,
    }
}

function parseChunkEvent(value: unknown): AIStreamChunkEvent | null {
    if (!isUnknownRecord(value)) {
        return null
    }
    if (
        typeof value.requestId !== "string" ||
        typeof value.nodeId !== "string" ||
        typeof value.delta !== "string"
    ) {
        return null
    }

    return {
        requestId: value.requestId,
        nodeId: value.nodeId,
        delta: value.delta,
    }
}

function parseDoneEvent(value: unknown): AIStreamDoneEvent | null {
    if (!isUnknownRecord(value)) {
        return null
    }
    if (
        typeof value.requestId !== "string" ||
        typeof value.nodeId !== "string" ||
        typeof value.finishReason !== "string" ||
        typeof value.cancelled !== "boolean"
    ) {
        return null
    }

    return {
        requestId: value.requestId,
        nodeId: value.nodeId,
        finishReason: value.finishReason,
        cancelled: value.cancelled,
    }
}

function parseErrorEvent(value: unknown): AIStreamErrorEvent | null {
    if (!isUnknownRecord(value)) {
        return null
    }
    const error = parseBridgeError(value.error)
    if (
        typeof value.requestId !== "string" ||
        typeof value.nodeId !== "string" ||
        !error
    ) {
        return null
    }

    return {
        requestId: value.requestId,
        nodeId: value.nodeId,
        error,
    }
}

/**
 * 订阅 Go OpenAI 流式事件
 * 每个 payload 都从 unknown 校验后才交给业务 Hook
 * 返回函数会一次性解除三个监听 避免 React StrictMode 重复订阅
 */
export function subscribeAIEvents(handlers: AIEventHandlers): () => void {
    const runtimeGlobal = globalThis as typeof globalThis & { runtime?: unknown }
    if (typeof runtimeGlobal.runtime === "undefined") {
        return () => undefined
    }

    const unsubscribeChunk = EventsOn(AI_EVENT_CHUNK, (payload: unknown) => {
        const event = parseChunkEvent(payload)
        if (event) {
            handlers.onChunk(event)
        }
    })
    const unsubscribeDone = EventsOn(AI_EVENT_DONE, (payload: unknown) => {
        const event = parseDoneEvent(payload)
        if (event) {
            handlers.onDone(event)
        }
    })
    const unsubscribeError = EventsOn(AI_EVENT_ERROR, (payload: unknown) => {
        const event = parseErrorEvent(payload)
        if (event) {
            handlers.onError(event)
        }
    })

    return () => {
        unsubscribeChunk()
        unsubscribeDone()
        unsubscribeError()
    }
}
