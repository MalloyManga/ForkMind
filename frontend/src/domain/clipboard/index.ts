import { cloneConversationCard } from "../conversation/helpers"
import {
    DEFAULT_CARD_MIN_HEIGHT,
    DEFAULT_CARD_WIDTH,
    NODE_STATUS_DONE,
} from "../conversation/constants"
import type { ConversationCard, ManagedAssetReference } from "../conversation/types"
import {
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
    FORKMIND_WORKSPACE_FORMAT,
    FORKMIND_WORKSPACE_VERSION,
    validateAndNormalizeWorkspace,
} from "../workspace"
import type {
    CanvasClipboardPayload,
    ClipboardNodeSnapshot,
} from "../../stores/conversationStore"
import {
    ClipboardGetText,
    ClipboardSetText,
} from "../../../wailsjs/runtime/runtime"

export const FORKMIND_CLIPBOARD_FORMAT = "forkmind-canvas-clipboard"
export const FORKMIND_CLIPBOARD_VERSION = 1
export const FORKMIND_CLIPBOARD_MAX_TEXT_LENGTH = 8 * 1024 * 1024

const CLIPBOARD_VALIDATION_THREAD_ID = "clipboard-validation-thread"
const CLIPBOARD_IMAGE_CARD_GAP = 40

type UnknownRecord = Record<string, unknown>

export type ForkMindClipboardParseResult =
    | { ok: true; value: CanvasClipboardPayload }
    | { ok: false; error: string }

function isUnknownRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createClipboardNodeSnapshot(card: ConversationCard): ClipboardNodeSnapshot {
    const clonedCard = cloneConversationCard(card)
    const { id, createdAt, updatedAt, ...clipboardNode } = clonedCard

    return {
        ...clipboardNode,
        originalNodeId: id,
    }
}

/**
 * 从业务卡片集合构造画布剪贴板 payload
 * @param targetCards 入参来自 tldraw 当前选中节点映射后的领域卡片
 * @returns 返回包含内部关系和整体左上角的快照 空集合返回 null
 * 用户复制画布节点时触发 结果只会继续序列化到系统剪贴板
 */
export function createCanvasClipboardPayload(
    targetCards: ConversationCard[],
): CanvasClipboardPayload | null {
    if (targetCards.length === 0) {
        return null
    }

    const sourceTopLeft = targetCards.reduce(
        (currentTopLeft, card) => ({
            x: Math.min(currentTopLeft.x, card.position.x),
            y: Math.min(currentTopLeft.y, card.position.y),
        }),
        { x: targetCards[0].position.x, y: targetCards[0].position.y },
    )

    return {
        nodes: targetCards.map((card) => createClipboardNodeSnapshot(card)),
        sourceTopLeft,
    }
}

/**
 * 把 Go 已导入的系统剪贴板图片包装成 Store 批量粘贴 payload
 * @param assets 入参来自 ImportClipboardImages Bridge 每项都已进入 Managed Asset Repository
 * @returns 空数组返回 null 非空结果按水平方向排列并交给 Store 生成真实节点 id
 * Paste Here 和 Paste to Replace 检测到真实图片时触发
 */
export function createClipboardImagePayload(
    assets: ManagedAssetReference[],
): CanvasClipboardPayload | null {
    if (assets.length === 0) {
        return null
    }

    const nodes = assets.map((asset, assetIndex): ClipboardNodeSnapshot => ({
        originalNodeId: `clipboard-image-${assetIndex}`,
        cardType: "image",
        parentId: null,
        position: {
            x: assetIndex * (DEFAULT_CARD_WIDTH + CLIPBOARD_IMAGE_CARD_GAP),
            y: 0,
        },
        size: {
            mode: "auto",
            width: DEFAULT_CARD_WIDTH,
            minHeight: DEFAULT_CARD_MIN_HEIGHT,
        },
        status: NODE_STATUS_DONE,
        asset: { ...asset },
        caption: "",
        altText: "",
    }))

    return {
        nodes,
        sourceTopLeft: { x: 0, y: 0 },
    }
}

/**
 * 序列化 ForkMind 系统剪贴板文档
 * @param payload 入参来自 createCanvasClipboardPayload 或已校验的系统剪贴板
 * @returns 返回带 format version 包装的可移植 JSON 字符串
 * 用户执行 Copy 时触发
 */
export function serializeForkMindClipboard(payload: CanvasClipboardPayload): string {
    return JSON.stringify({
        format: FORKMIND_CLIPBOARD_FORMAT,
        version: FORKMIND_CLIPBOARD_VERSION,
        payload,
    }, null, 2)
}

/**
 * 解析并规范化外部 ForkMind 剪贴板 JSON
 * @param content 入参来自浏览器系统剪贴板 readText 结果
 * @returns 成功时返回可直接交给 Store 的 payload 失败时返回用户可读错误
 * 用户执行 Paste Here 或 Paste to Replace 时触发 外部节点会复用工作区验证器检查类型 关系与重复 id
 */
export function parseForkMindClipboard(content: string): ForkMindClipboardParseResult {
    if (content.length > FORKMIND_CLIPBOARD_MAX_TEXT_LENGTH) {
        return {
            ok: false,
            error: `剪贴板内容超过 ${FORKMIND_CLIPBOARD_MAX_TEXT_LENGTH} 字符限制`,
        }
    }

    let parsedDocument: unknown
    try {
        parsedDocument = JSON.parse(content) as unknown
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? `剪贴板 JSON 解析失败: ${error.message}` : "剪贴板 JSON 解析失败",
        }
    }

    if (!isUnknownRecord(parsedDocument)) {
        return { ok: false, error: "剪贴板内容必须是 JSON 对象" }
    }
    if (parsedDocument.format !== FORKMIND_CLIPBOARD_FORMAT) {
        return { ok: false, error: `剪贴板格式必须是 ${FORKMIND_CLIPBOARD_FORMAT}` }
    }
    if (parsedDocument.version !== FORKMIND_CLIPBOARD_VERSION) {
        return { ok: false, error: `暂不支持剪贴板版本 ${String(parsedDocument.version)}` }
    }
    if (!isUnknownRecord(parsedDocument.payload) || !Array.isArray(parsedDocument.payload.nodes)) {
        return { ok: false, error: "剪贴板 payload.nodes 必须是数组" }
    }
    if (parsedDocument.payload.nodes.length === 0) {
        return { ok: false, error: "剪贴板没有可粘贴节点" }
    }

    const now = new Date().toISOString()
    const validationCards = parsedDocument.payload.nodes.map((node): unknown => {
        if (!isUnknownRecord(node)) {
            return node
        }

        return {
            ...node,
            id: node.originalNodeId,
            createdAt: now,
            updatedAt: now,
        }
    })
    const workspaceValidation = validateAndNormalizeWorkspace({
        format: FORKMIND_WORKSPACE_FORMAT,
        version: FORKMIND_WORKSPACE_VERSION,
        activeThreadId: CLIPBOARD_VALIDATION_THREAD_ID,
        threads: [{
            id: CLIPBOARD_VALIDATION_THREAD_ID,
            title: "Clipboard Validation",
            cards: validationCards,
            createdAt: now,
            updatedAt: now,
        }],
        settings: {
            baseUrl: DEFAULT_OPENAI_BASE_URL,
            model: DEFAULT_OPENAI_MODEL,
        },
        lastModified: now,
    })
    if (!workspaceValidation.ok) {
        return {
            ok: false,
            error: `${workspaceValidation.error.message} (${workspaceValidation.error.path})`,
        }
    }

    const payload = createCanvasClipboardPayload(workspaceValidation.value.threads[0].cards)
    if (!payload) {
        return { ok: false, error: "剪贴板没有可粘贴节点" }
    }

    return { ok: true, value: payload }
}

/**
 * 写入系统文本剪贴板
 * @param content 入参是带 ForkMind format/version 的 JSON 字符串
 * @returns Promise 在浏览器确认写入后完成 不可用或被系统拒绝时抛出明确错误
 * Copy 命令触发
 */
export async function writeSystemClipboardText(content: string): Promise<void> {
    let browserClipboardError: unknown = null
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(content)
            return
        } catch (error) {
            browserClipboardError = error
        }
    }

    const runtimeGlobal = globalThis as typeof globalThis & { runtime?: unknown }
    if (typeof runtimeGlobal.runtime !== "undefined") {
        const didWrite = await ClipboardSetText(content)
        if (didWrite) {
            return
        }
        throw new Error("Wails 系统剪贴板写入失败")
    }

    throw browserClipboardError instanceof Error
        ? new Error(`系统剪贴板写入失败: ${browserClipboardError.message}`)
        : new Error("当前环境不支持系统剪贴板写入")
}

/**
 * 读取系统文本剪贴板
 * @returns 返回系统剪贴板当前文本 不可用或权限被拒绝时抛出明确错误
 * Paste Here 与 Paste to Replace 命令触发
 */
export async function readSystemClipboardText(): Promise<string> {
    let browserClipboardError: unknown = null
    if (navigator.clipboard?.readText) {
        try {
            return await navigator.clipboard.readText()
        } catch (error) {
            browserClipboardError = error
        }
    }

    const runtimeGlobal = globalThis as typeof globalThis & { runtime?: unknown }
    if (typeof runtimeGlobal.runtime !== "undefined") {
        return ClipboardGetText()
    }

    throw browserClipboardError instanceof Error
        ? new Error(`系统剪贴板读取失败: ${browserClipboardError.message}`)
        : new Error("当前环境不支持系统剪贴板读取")
}
