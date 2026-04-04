import { NODE_STATUS_DONE, NODE_STATUS_IDLE } from "../../domain/conversation/constants"
import type { ConversationCard, ChatNode, NoteNode } from "../../domain/conversation/types"
import type { AddChatNodeInput, AddNoteNodeInput } from "./contracts"
import {
    createDefaultSize,
    createForkPosition,
    createNodeId,
    createTimestamp,
    findNodeById,
    normalizeParentId,
    normalizeReferenceIds,
} from "./helpers"

/**
 * 创建 chat 节点。
 * 业务场景：点击“新增对话卡片”或从现有卡片分叉提问时调用。
 */
export function createChatNode(
    input: AddChatNodeInput,
    nodes: readonly ConversationCard[],
): ChatNode {
    // 统一节点创建时间，保证 createdAt/updatedAt 在首次创建时一致。
    const now = createTimestamp()
    const validParentId = normalizeParentId(nodes, input.parentId)
    const parentNode = validParentId ? findNodeById(nodes, validParentId) : undefined

    const defaultPosition = parentNode ? createForkPosition(parentNode) : { x: 0, y: 0 }
    const nodeId = createNodeId()

    // 构造 chat 节点主体。
    const nextNode: ChatNode = {
        id: nodeId,
        type: "chat",
        userPrompt: input.userPrompt ?? "",
        aiResponse: input.aiResponse ?? "",
        parentId: validParentId,
        referenceNodeIds: undefined,
        position: {
            x: input.position?.x ?? defaultPosition.x,
            y: input.position?.y ?? defaultPosition.y,
        },
        size: createDefaultSize(input.size),
        status: input.status ?? NODE_STATUS_IDLE,
        createdAt: now,
        updatedAt: now,
    }

    // 构造完成后做 reference 规范化，避免脏数据写入 store。
    nextNode.referenceNodeIds = normalizeReferenceIds(
        input.referenceNodeIds,
        nodeId,
        [...nodes, nextNode],
    )

    return nextNode
}

/**
 * 创建 note 节点。
 * 业务场景：用户在画布上创建“纯笔记卡片”时调用，不依赖 AI 回复。
 */
export function createNoteNode(
    input: AddNoteNodeInput,
    nodes: readonly ConversationCard[],
): NoteNode {
    // note 节点与 chat 节点使用同一套父子/布局规则。
    const now = createTimestamp()
    const validParentId = normalizeParentId(nodes, input.parentId)
    const parentNode = validParentId ? findNodeById(nodes, validParentId) : undefined

    const defaultPosition = parentNode ? createForkPosition(parentNode) : { x: 0, y: 0 }
    const nodeId = createNodeId()

    // 构造 note 节点主体。
    const nextNode: NoteNode = {
        id: nodeId,
        type: "note",
        noteContent: input.noteContent ?? "",
        parentId: validParentId,
        referenceNodeIds: undefined,
        position: {
            x: input.position?.x ?? defaultPosition.x,
            y: input.position?.y ?? defaultPosition.y,
        },
        size: createDefaultSize(input.size),
        status: input.status ?? NODE_STATUS_DONE,
        createdAt: now,
        updatedAt: now,
    }

    // 构造完成后做 reference 规范化，避免脏数据写入 store。
    nextNode.referenceNodeIds = normalizeReferenceIds(
        input.referenceNodeIds,
        nodeId,
        [...nodes, nextNode],
    )

    return nextNode
}
