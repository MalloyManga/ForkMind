import {
    CARD_FORK_OFFSET_X,
    CARD_FORK_OFFSET_Y,
    DEFAULT_CARD_MIN_HEIGHT,
    DEFAULT_CARD_WIDTH,
} from "../../domain/conversation/constants"
import type {
    BaseNode,
    ConversationCard,
    ConversationCardPosition,
    ConversationCardSize,
    ConversationThread,
} from "../../domain/conversation/types"
import type { ConversationSnapshot } from "./contracts"

/**
 * 统一生成更新时间戳。
 * 业务场景：所有写操作都用同一时间源，避免时间语义不一致。
 */
export function createTimestamp(): string {
    return new Date().toISOString()
}

/**
 * 生成节点 ID。
 * 优先使用浏览器 randomUUID，兜底使用时间戳 + 随机串。
 */
export function createNodeId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID()
    }
    return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 合并卡片尺寸默认值。
 */
export function createDefaultSize(partial?: Partial<ConversationCardSize>): ConversationCardSize {
    return {
        mode: partial?.mode ?? "auto",
        width: partial?.width ?? DEFAULT_CARD_WIDTH,
        minHeight: partial?.minHeight ?? DEFAULT_CARD_MIN_HEIGHT,
    }
}

/**
 * 深拷贝单个节点。
 * 业务场景：历史快照、导入替换、撤销重做都不能共享引用。
 */
export function cloneNode(node: ConversationCard): ConversationCard {
    const base: BaseNode = {
        ...node,
        referenceNodeIds: node.referenceNodeIds ? [...node.referenceNodeIds] : undefined,
        position: { ...node.position },
        size: { ...node.size },
    }

    switch (node.type) {
        case "chat":
            return {
                ...base,
                type: "chat",
                userPrompt: node.userPrompt,
                aiResponse: node.aiResponse,
            }
        case "note":
            return {
                ...base,
                type: "note",
                noteContent: node.noteContent,
            }
    }

    // 编译期穷尽检查：新增节点类型但漏写分支时，TS 会在这里报错。
    const exhaustiveNode: never = node
    throw new Error(
        `Unsupported node type: ${String((exhaustiveNode as { type?: unknown }).type)}`,
    )
}

/**
 * 深拷贝线程（含 cards）。
 */
export function cloneThread(thread: ConversationThread): ConversationThread {
    return {
        ...thread,
        cards: thread.cards.map((node) => cloneNode(node)),
    }
}

/**
 * 深拷贝历史快照。
 */
export function cloneSnapshot(snapshot: ConversationSnapshot): ConversationSnapshot {
    return {
        thread: cloneThread(snapshot.thread),
        activeNodeId: snapshot.activeNodeId,
    }
}

/**
 * 按 id 查找节点。
 */
export function findNodeById(
    nodes: readonly ConversationCard[],
    nodeId: string,
): ConversationCard | undefined {
    return nodes.find((node) => node.id === nodeId)
}

/**
 * 规范化 parentId：
 * - 未传或不存在时统一返回 null
 * - 存在时返回合法 parent id
 * 业务场景：导入 JSON 被手改、拖拽改父节点传入失效 id 时，保证结构稳定。
 */
export function normalizeParentId(
    nodes: readonly ConversationCard[],
    requestedParentId: string | null | undefined,
): string | null {
    if (!requestedParentId) {
        return null
    }

    const parentNode = findNodeById(nodes, requestedParentId)
    return parentNode ? parentNode.id : null
}

/**
 * 规范化 reference ids：
 * - 去重
 * - 去掉 self 引用
 * - 去掉不存在的 id
 */
export function normalizeReferenceIds(
    ids: string[] | undefined,
    selfId: string,
    nodes: readonly ConversationCard[],
): string[] | undefined {
    if (!ids || ids.length === 0) {
        return undefined
    }

    // 真实节点集合：用于 O(1) 校验引用 id 是否存在。
    const existingNodeIdSet = new Set(nodes.map((node) => node.id))

    // 输入去重 + 去自引用 + 去无效 id。
    const normalized = Array.from(new Set(ids)).filter(
        (id) => id !== selfId && existingNodeIdSet.has(id),
    )

    return normalized.length > 0 ? normalized : undefined
}

/**
 * 计算 Fork 子节点默认位置（相对父节点偏移）。
 */
export function createForkPosition(sourceNode: ConversationCard): ConversationCardPosition {
    return {
        x: sourceNode.position.x + CARD_FORK_OFFSET_X,
        y: sourceNode.position.y + CARD_FORK_OFFSET_Y,
    }
}

/**
 * 判断两个字符串数组是否浅层相同。
 * 返回 true 表示“没有变化”，返回 false 表示“有变化”。
 */
export function isSameStringArrayShallow(
    previousValues?: string[],
    nextValues?: string[],
): boolean {
    if (!previousValues && !nextValues) {
        return true
    }
    if (!previousValues || !nextValues) {
        return false
    }
    if (previousValues.length !== nextValues.length) {
        return false
    }

    return previousValues.every((value, index) => value === nextValues[index])
}

/**
 * 防成环算法：当 nodeId 想挂到 nextParentId 下时，沿 parent 向上追溯。
 * 如果追溯链上再次遇到 nodeId，说明会形成环，直接拒绝此次修改。
 * @param nodes 当前线程的全量节点集合
 * @param nodeId 准备被改挂载关系的节点 id
 * @param nextParentId 用户希望挂载到的新父节点 id
 */
export function willCreateParentCycle(
    nodes: readonly ConversationCard[],
    nodeId: string,
    nextParentId: string | null,
): boolean {
    if (nextParentId === null) {
        return false
    }

    // 每轮沿 parent 链向上爬一层，直到根节点或命中成环。
    let cursor: string | null = nextParentId
    while (cursor) {
        if (cursor === nodeId) {
            return true
        }

        const currentNode = findNodeById(nodes, cursor)
        cursor = currentNode?.parentId ?? null
    }

    return false
}