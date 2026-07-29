import type {
    CanvasPlan,
    CanvasPlanCardType,
    CanvasPlanContentMap,
    CanvasPlanNode,
} from "./types"

const CANVAS_PLAN_SCHEMA_VERSION = 1
const CANVAS_PLAN_MAX_NODES = 40
const CANVAS_PLAN_TEMP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

type UnknownRecord = Record<string, unknown>

function isUnknownRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(record: UnknownRecord, allowedKeys: readonly string[]): boolean {
    const allowedKeySet = new Set(allowedKeys)
    return Object.keys(record).every((key) => allowedKeySet.has(key))
}

function parseStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return null
    }
    return [...value]
}

function parseContent<CardType extends CanvasPlanCardType>(
    cardType: CardType,
    value: unknown,
): CanvasPlanContentMap[CardType] | null {
    if (!isUnknownRecord(value)) {
        return null
    }

    switch (cardType) {
        case "chat":
            return hasOnlyKeys(value, ["userPrompt", "aiResponse"]) &&
                typeof value.userPrompt === "string" && typeof value.aiResponse === "string"
                ? { userPrompt: value.userPrompt, aiResponse: value.aiResponse } as CanvasPlanContentMap[CardType]
                : null
        case "note":
            return hasOnlyKeys(value, ["noteContent"]) && typeof value.noteContent === "string"
                ? { noteContent: value.noteContent } as CanvasPlanContentMap[CardType]
                : null
        case "image":
            return hasOnlyKeys(value, ["caption", "altText"]) &&
                typeof value.caption === "string" && typeof value.altText === "string"
                ? { caption: value.caption, altText: value.altText } as CanvasPlanContentMap[CardType]
                : null
        case "link":
            return hasOnlyKeys(value, ["url", "title", "description"]) &&
                typeof value.url === "string" && typeof value.title === "string" &&
                typeof value.description === "string"
                ? { url: value.url, title: value.title, description: value.description } as CanvasPlanContentMap[CardType]
                : null
        case "file":
            return hasOnlyKeys(value, ["description"]) && typeof value.description === "string"
                ? { description: value.description } as CanvasPlanContentMap[CardType]
                : null
    }
}

function parseNode(value: unknown): CanvasPlanNode | null {
    if (!isUnknownRecord(value) || !hasOnlyKeys(value, [
        "tempId",
        "cardType",
        "content",
        "parentTempId",
        "referenceTempIds",
    ])) {
        return null
    }
    if (
        typeof value.tempId !== "string" ||
        !CANVAS_PLAN_TEMP_ID_PATTERN.test(value.tempId) ||
        (value.parentTempId !== null && typeof value.parentTempId !== "string")
    ) {
        return null
    }
    const referenceTempIds = parseStringArray(value.referenceTempIds)
    if (!referenceTempIds) {
        return null
    }

    const cardType = value.cardType
    if (cardType !== "chat" && cardType !== "note" && cardType !== "image" && cardType !== "link" && cardType !== "file") {
        return null
    }
    const content = parseContent(cardType, value.content)
    if (!content) {
        return null
    }

    const relationFields = {
        tempId: value.tempId,
        parentTempId: value.parentTempId,
        referenceTempIds,
    }
    switch (cardType) {
        case "chat":
            return { ...relationFields, cardType, content: content as CanvasPlanContentMap["chat"] }
        case "note":
            return { ...relationFields, cardType, content: content as CanvasPlanContentMap["note"] }
        case "image":
            return { ...relationFields, cardType, content: content as CanvasPlanContentMap["image"] }
        case "link":
            return { ...relationFields, cardType, content: content as CanvasPlanContentMap["link"] }
        case "file":
            return { ...relationFields, cardType, content: content as CanvasPlanContentMap["file"] }
    }
}

/**
 * 从 Wails unknown 事件解析经过 Go 校验的 CanvasPlan
 * @param value 入参来自 canvas-plan 事件中的 plan 字段
 * @returns 返回独立的类型安全提案 非法或版本漂移数据返回 null
 * 模型工具调用完成后由 AI 事件订阅器触发
 */
export function parseCanvasPlan(value: unknown): CanvasPlan | null {
    if (!isUnknownRecord(value) || !hasOnlyKeys(value, ["nodes"]) || !Array.isArray(value.nodes)) {
        return null
    }
    if (value.nodes.length === 0 || value.nodes.length > CANVAS_PLAN_MAX_NODES) {
        return null
    }

    const nodes: CanvasPlanNode[] = []
    for (const nodeValue of value.nodes) {
        const node = parseNode(nodeValue)
        if (!node) {
            return null
        }
        nodes.push(node)
    }
    return { nodes }
}

export function isSupportedCanvasPlanSchemaVersion(value: unknown): value is 1 {
    return value === CANVAS_PLAN_SCHEMA_VERSION
}
