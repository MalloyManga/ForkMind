import {
    DEFAULT_CARD_MIN_HEIGHT,
    DEFAULT_CARD_WIDTH,
    NODE_STATUS_DONE,
    NODE_STATUS_ERROR,
    NODE_STATUS_IDLE,
    NODE_STATUS_STREAMING,
} from "../conversation/constants"
import type {
    BaseNode,
    ChatNode,
    ConversationCard,
    ConversationNodeStatus,
    ConversationNodeType,
    ConversationTextAnchor,
    ConversationThread,
    FileNode,
    ImageNode,
    LinkNode,
    ManagedAssetReference,
    NoteNode,
} from "../conversation/types"
import {
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
    FORKMIND_WORKSPACE_FORMAT,
    FORKMIND_WORKSPACE_VERSION,
} from "./constants"
import type {
    ForkMindWorkspaceDocument,
    PersistedOpenAISettings,
    WorkspaceValidationError,
    WorkspaceValidationResult,
} from "./types"

type UnknownRecord = Record<string, unknown>

const VALID_NODE_STATUSES = new Set<ConversationNodeStatus>([
    NODE_STATUS_IDLE,
    NODE_STATUS_STREAMING,
    NODE_STATUS_DONE,
    NODE_STATUS_ERROR,
])

function isUnknownRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

function createValidationError(
    code: string,
    message: string,
    path: string,
): WorkspaceValidationResult {
    return {
        ok: false,
        error: { code, message, path },
    }
}

function readString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback
}

function normalizeTimestamp(value: unknown, fallback: string): string {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        return fallback
    }

    return new Date(value).toISOString()
}

/**
 * 解析外部 JSON 中可选的文本锚点
 * @param input 入参来自单张卡片的 sourceAnchor 未知字段
 * @returns 返回字段级合法的锚点 源节点与字段兼容性在关系归一化阶段确认
 * 工作区导入和系统剪贴板解析时触发
 */
function parseTextAnchor(input: unknown): ConversationTextAnchor | undefined {
    if (!isUnknownRecord(input)) {
        return undefined
    }

    const sourceNodeId = readString(input.sourceNodeId).trim()
    const quote = readString(input.quote).trim()
    const field = input.field
    const origin = input.origin
    if (
        !sourceNodeId ||
        !quote ||
        (
            field !== "userPrompt" &&
            field !== "aiResponse" &&
            field !== "noteContent" &&
            field !== "caption" &&
            field !== "altText" &&
            field !== "url" &&
            field !== "title" &&
            field !== "description"
        ) ||
        (origin !== "editor" && origin !== "canvas")
    ) {
        return undefined
    }

    const startOffset = isFiniteNumber(input.startOffset) ? Math.floor(input.startOffset) : null
    const endOffset = isFiniteNumber(input.endOffset) ? Math.floor(input.endOffset) : null
    const hasValidEditorOffsets =
        origin === "editor" &&
        startOffset !== null &&
        endOffset !== null &&
        startOffset >= 0 &&
        endOffset > startOffset
    const hasValidCanvasOffsets = origin === "canvas" && startOffset === null && endOffset === null
    if (!hasValidEditorOffsets && !hasValidCanvasOffsets) {
        return undefined
    }

    return {
        sourceNodeId,
        field,
        quote,
        startOffset,
        endOffset,
        origin,
    }
}

function isTextAnchorFieldCompatible(
    sourceCard: ConversationCard,
    anchor: ConversationTextAnchor,
): boolean {
    switch (sourceCard.cardType) {
        case "chat":
            return anchor.field === "userPrompt" || anchor.field === "aiResponse"
        case "note":
            return anchor.field === "noteContent"
        case "image":
            return anchor.field === "caption" || anchor.field === "altText"
        case "link":
            return anchor.field === "url" || anchor.field === "title" || anchor.field === "description"
        case "file":
            return anchor.field === "description"
    }

    return false
}

function parseManagedAsset(input: unknown): ManagedAssetReference | null {
    if (!isUnknownRecord(input)) {
        return null
    }

    const id = readString(input.id).trim()
    const name = readString(input.name).trim()
    const mimeType = readString(input.mimeType).trim()
    const sizeBytes = isFiniteNumber(input.sizeBytes) ? Math.floor(input.sizeBytes) : 0
    if (
        !/^[a-f0-9]{64}(?:\.[a-z0-9]{1,10})?$/.test(id) ||
        !name ||
        !mimeType ||
        sizeBytes <= 0
    ) {
        return null
    }

    return { id, name, mimeType, sizeBytes }
}

/**
 * 规范化从磁盘 导入文件或系统剪贴板进入内存的节点状态
 * @param value 入参来自外部 JSON status 字段
 * @param cardType 入参来自已经校验的节点判别字段
 * @param aiResponse 入参来自 Chat 节点外部回答文本 Note 节点传空字符串
 * @returns 返回当前进程可安全恢复的状态 外部 streaming 不会跨进程继续存在
 * 工作区水化和 ForkMind JSON 粘贴解析单节点时触发
 */
function normalizeExternalNodeStatus(
    value: unknown,
    cardType: ConversationNodeType,
    aiResponse: string,
): ConversationNodeStatus {
    if (cardType !== "chat") {
        return NODE_STATUS_DONE
    }
    if (value === NODE_STATUS_STREAMING) {
        return aiResponse.length > 0 ? NODE_STATUS_DONE : NODE_STATUS_IDLE
    }
    if (VALID_NODE_STATUSES.has(value as ConversationNodeStatus)) {
        return value as ConversationNodeStatus
    }

    return NODE_STATUS_IDLE
}

/**
 * 解析单张外部卡片
 * @param input 入参来自 JSON cards 数组中的未知元素
 * @param path 入参用于生成用户可定位的校验错误路径
 * @param now 入参是本轮导入统一时间 缺失时间戳时使用
 * @returns 返回合法 ConversationCard 或具体边界错误
 */
function parseCard(
    input: unknown,
    path: string,
    now: string,
): { ok: true; value: ConversationCard } | { ok: false; error: WorkspaceValidationError } {
    if (!isUnknownRecord(input)) {
        return {
            ok: false,
            error: { code: "invalid_card", message: "节点必须是对象", path },
        }
    }

    const id = readString(input.id).trim()
    if (!id) {
        return {
            ok: false,
            error: { code: "invalid_node_id", message: "节点 id 不能为空", path: `${path}.id` },
        }
    }

    const cardType = input.cardType
    if (
        cardType !== "chat" &&
        cardType !== "note" &&
        cardType !== "image" &&
        cardType !== "link" &&
        cardType !== "file"
    ) {
        return {
            ok: false,
            error: {
                code: "invalid_card_type",
                message: "节点 cardType 只能是 chat note image link 或 file",
                path: `${path}.cardType`,
            },
        }
    }

    const position = isUnknownRecord(input.position) ? input.position : {}
    const size = isUnknownRecord(input.size) ? input.size : {}
    const aiResponse = cardType === "chat" ? readString(input.aiResponse) : ""
    const status = normalizeExternalNodeStatus(input.status, cardType, aiResponse)
    const requestedReferences = Array.isArray(input.referenceNodeIds)
        ? input.referenceNodeIds.filter((value): value is string => typeof value === "string")
        : undefined
    const baseNode: BaseNode = {
        id,
        cardType,
        parentId: typeof input.parentId === "string" ? input.parentId : null,
        referenceNodeIds: requestedReferences,
        sourceAnchor: parseTextAnchor(input.sourceAnchor),
        position: {
            x: isFiniteNumber(position.x) ? position.x : 0,
            y: isFiniteNumber(position.y) ? position.y : 0,
        },
        size: {
            mode: size.mode === "fixed" ? "fixed" : "auto",
            width: isFiniteNumber(size.width) && size.width > 0
                ? size.width
                : DEFAULT_CARD_WIDTH,
            minHeight: isFiniteNumber(size.minHeight) && size.minHeight > 0
                ? size.minHeight
                : DEFAULT_CARD_MIN_HEIGHT,
        },
        status,
        createdAt: normalizeTimestamp(input.createdAt, now),
        updatedAt: normalizeTimestamp(input.updatedAt, now),
    }

    if (cardType === "chat") {
        const chatNode: ChatNode = {
            ...baseNode,
            cardType,
            userPrompt: readString(input.userPrompt),
            aiResponse,
        }
        return { ok: true, value: chatNode }
    }

    switch (cardType) {
        case "note": {
            const noteNode: NoteNode = {
                ...baseNode,
                cardType,
                noteContent: readString(input.noteContent),
            }
            return { ok: true, value: noteNode }
        }
        case "image": {
            const imageNode: ImageNode = {
                ...baseNode,
                cardType,
                asset: parseManagedAsset(input.asset),
                caption: readString(input.caption),
                altText: readString(input.altText),
            }
            return { ok: true, value: imageNode }
        }
        case "link": {
            const linkNode: LinkNode = {
                ...baseNode,
                cardType,
                url: readString(input.url),
                title: readString(input.title),
                description: readString(input.description),
            }
            return { ok: true, value: linkNode }
        }
        case "file": {
            const fileNode: FileNode = {
                ...baseNode,
                cardType,
                asset: parseManagedAsset(input.asset),
                description: readString(input.description),
            }
            return { ok: true, value: fileNode }
        }
    }
}

/**
 * 修复外部 Thread 内的 parent reference 关系
 * @param cards 入参是已经完成字段级校验的节点集合
 * @returns 返回去除坏引用 自引用 重复引用并打断父链环的新数组
 */
function normalizeCardRelations(cards: ConversationCard[]): ConversationCard[] {
    const existingIdSet = new Set(cards.map((card) => card.id))
    const normalizedCards = cards.map((card) => ({
        ...card,
        parentId:
            card.parentId && card.parentId !== card.id && existingIdSet.has(card.parentId)
                ? card.parentId
                : null,
        referenceNodeIds: card.referenceNodeIds
            ? Array.from(new Set(card.referenceNodeIds)).filter(
                (referenceNodeId) =>
                    referenceNodeId !== card.id && existingIdSet.has(referenceNodeId),
            )
            : undefined,
        position: { ...card.position },
        size: { ...card.size },
    }))
    const cardById = new Map(normalizedCards.map((card) => [card.id, card]))

    return normalizedCards.map((card) => {
        const visitedIds = new Set<string>([card.id])
        let cursorParentId = card.parentId

        while (cursorParentId) {
            if (visitedIds.has(cursorParentId)) {
                return { ...card, parentId: null }
            }

            visitedIds.add(cursorParentId)
            cursorParentId = cardById.get(cursorParentId)?.parentId ?? null
        }

        const anchorSourceCard = card.sourceAnchor
            ? cardById.get(card.sourceAnchor.sourceNodeId)
            : undefined
        const sourceAnchor =
            card.sourceAnchor &&
                anchorSourceCard &&
                anchorSourceCard.id !== card.id &&
                isTextAnchorFieldCompatible(anchorSourceCard, card.sourceAnchor)
                ? { ...card.sourceAnchor }
                : undefined

        return {
            ...card,
            sourceAnchor,
            referenceNodeIds:
                card.referenceNodeIds && card.referenceNodeIds.length > 0
                    ? card.referenceNodeIds
                    : undefined,
        }
    })
}

/**
 * 解析外部会话对象
 * 重复节点 id 会直接拒绝 因为无法确定关系应指向哪一个节点
 */
function parseThread(
    input: unknown,
    path: string,
    now: string,
): { ok: true; value: ConversationThread } | { ok: false; error: WorkspaceValidationError } {
    if (!isUnknownRecord(input)) {
        return {
            ok: false,
            error: { code: "invalid_thread", message: "会话必须是对象", path },
        }
    }

    const id = readString(input.id).trim()
    if (!id) {
        return {
            ok: false,
            error: { code: "invalid_thread_id", message: "会话 id 不能为空", path: `${path}.id` },
        }
    }

    if (!Array.isArray(input.cards)) {
        return {
            ok: false,
            error: { code: "invalid_cards", message: "会话 cards 必须是数组", path: `${path}.cards` },
        }
    }

    const cards: ConversationCard[] = []
    const nodeIdSet = new Set<string>()
    for (const [cardIndex, cardInput] of input.cards.entries()) {
        const cardResult = parseCard(cardInput, `${path}.cards[${cardIndex}]`, now)
        if (!cardResult.ok) {
            return cardResult
        }
        if (nodeIdSet.has(cardResult.value.id)) {
            return {
                ok: false,
                error: {
                    code: "duplicate_node_id",
                    message: `节点 id 重复: ${cardResult.value.id}`,
                    path: `${path}.cards[${cardIndex}].id`,
                },
            }
        }

        nodeIdSet.add(cardResult.value.id)
        cards.push(cardResult.value)
    }

    return {
        ok: true,
        value: {
            id,
            title: readString(input.title, "未命名会话").trim() || "未命名会话",
            cards: normalizeCardRelations(cards),
            createdAt: normalizeTimestamp(input.createdAt, now),
            updatedAt: normalizeTimestamp(input.updatedAt, now),
        },
    }
}

function parseSettings(input: unknown): PersistedOpenAISettings {
    const settings = isUnknownRecord(input) ? input : {}

    return {
        baseUrl: readString(settings.baseUrl, DEFAULT_OPENAI_BASE_URL).trim() || DEFAULT_OPENAI_BASE_URL,
        model: readString(settings.model, DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
    }
}

/**
 * 校验并规范化 ForkMind 工作区 JSON
 * @param input 入参来自 Wails 本地文件或系统剪贴板解析后的 unknown
 * @returns 成功时返回完整领域文档 失败时返回可展示的 code message path
 * 所有外部数据进入 Zustand 前必须经过该函数
 */
export function validateAndNormalizeWorkspace(input: unknown): WorkspaceValidationResult {
    if (!isUnknownRecord(input)) {
        return createValidationError("invalid_workspace", "工作区必须是对象", "$")
    }
    if (input.format !== FORKMIND_WORKSPACE_FORMAT) {
        return createValidationError(
            "invalid_format",
            `文件格式必须是 ${FORKMIND_WORKSPACE_FORMAT}`,
            "$.format",
        )
    }
    if (input.version !== FORKMIND_WORKSPACE_VERSION) {
        return createValidationError(
            "unsupported_version",
            `暂不支持工作区版本 ${readString(input.version, "unknown")}`,
            "$.version",
        )
    }
    if (!Array.isArray(input.threads) || input.threads.length === 0) {
        return createValidationError(
            "invalid_threads",
            "工作区至少需要一个会话",
            "$.threads",
        )
    }

    const now = new Date().toISOString()
    const threads: ConversationThread[] = []
    const threadIdSet = new Set<string>()
    for (const [threadIndex, threadInput] of input.threads.entries()) {
        const threadResult = parseThread(threadInput, `$.threads[${threadIndex}]`, now)
        if (!threadResult.ok) {
            return threadResult
        }
        if (threadIdSet.has(threadResult.value.id)) {
            return createValidationError(
                "duplicate_thread_id",
                `会话 id 重复: ${threadResult.value.id}`,
                `$.threads[${threadIndex}].id`,
            )
        }

        threadIdSet.add(threadResult.value.id)
        threads.push(threadResult.value)
    }

    const requestedActiveThreadId = readString(input.activeThreadId)
    const activeThreadId = threadIdSet.has(requestedActiveThreadId)
        ? requestedActiveThreadId
        : threads[0].id

    const document: ForkMindWorkspaceDocument = {
        format: FORKMIND_WORKSPACE_FORMAT,
        version: FORKMIND_WORKSPACE_VERSION,
        activeThreadId,
        threads,
        settings: parseSettings(input.settings),
        lastModified: normalizeTimestamp(input.lastModified, now),
    }

    return { ok: true, value: document }
}
