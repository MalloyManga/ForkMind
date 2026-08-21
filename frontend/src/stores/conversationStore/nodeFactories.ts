import { NODE_STATUS_DONE, NODE_STATUS_IDLE } from "../../domain/conversation/constants"
import type {
    ConversationCard,
    FileNode,
    ImageNode,
    LinkNode,
    ChatNode,
    NoteNode,
} from "../../domain/conversation/types"
import type { AddNodeDraftInput } from "./contracts"
import {
    createDefaultSize,
    createForkPosition,
    createNodeId,
    createTimestamp,
    findNodeById,
    normalizeParentId,
    normalizeReferenceIds,
    normalizeTextAnchor,
} from "./helpers"

/**
 * 创建 chat 节点
 * 输入卡片创建的入参 补齐其他生成字段 返回完整 node 对象
 */
export function createChatNode(
    input: AddNodeDraftInput<"chat">,
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
        cardType: "chat",
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
    nextNode.sourceAnchor = normalizeTextAnchor(
        input.sourceAnchor,
        nodeId,
        [...nodes, nextNode],
    )

    return nextNode
}

/**
 * 创建 note 节点
 */
export function createNoteNode(
    input: AddNodeDraftInput<"note">,
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
        cardType: "note",
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
    nextNode.sourceAnchor = normalizeTextAnchor(
        input.sourceAnchor,
        nodeId,
        [...nodes, nextNode],
    )

    return nextNode
}

function createNodeBase<T extends ConversationCard>(
    input: AddNodeDraftInput<T["cardType"]>,
    nodes: readonly ConversationCard[],
    node: { cardType: T["cardType"] } & Omit<T, keyof import("../../domain/conversation/types").BaseNode>,
): T {
    const now = createTimestamp()
    const validParentId = normalizeParentId(nodes, input.parentId)
    const parentNode = validParentId ? findNodeById(nodes, validParentId) : undefined
    const defaultPosition = parentNode ? createForkPosition(parentNode) : { x: 0, y: 0 }
    const nodeId = createNodeId()
    const nextNode = {
        ...node,
        id: nodeId,
        parentId: validParentId,
        referenceNodeIds: undefined,
        sourceAnchor: undefined,
        position: {
            x: input.position?.x ?? defaultPosition.x,
            y: input.position?.y ?? defaultPosition.y,
        },
        size: createDefaultSize(input.size),
        status: input.status ?? NODE_STATUS_DONE,
        createdAt: now,
        updatedAt: now,
    } as T
    nextNode.referenceNodeIds = normalizeReferenceIds(input.referenceNodeIds, nodeId, [...nodes, nextNode])
    nextNode.sourceAnchor = normalizeTextAnchor(input.sourceAnchor, nodeId, [...nodes, nextNode])
    return nextNode
}

/** 创建本地图片节点 用户从 ModeBar 新增时 asset 为空 */
export function createImageNode(
    input: AddNodeDraftInput<"image">,
    nodes: readonly ConversationCard[],
): ImageNode {
    return createNodeBase<ImageNode>(input, nodes, {
        cardType: "image",
        asset: input.asset ? { ...input.asset } : null,
        caption: input.caption ?? "",
        altText: input.altText ?? "",
    })
}

/** 创建纯文本链接节点 不进行远端抓取 */
export function createLinkNode(
    input: AddNodeDraftInput<"link">,
    nodes: readonly ConversationCard[],
): LinkNode {
    return createNodeBase<LinkNode>(input, nodes, {
        cardType: "link",
        url: input.url ?? "",
        title: input.title ?? "",
        description: input.description ?? "",
    })
}

/** 创建本地文件节点 用户选择文件后再写入 asset */
export function createFileNode(
    input: AddNodeDraftInput<"file">,
    nodes: readonly ConversationCard[],
): FileNode {
    return createNodeBase<FileNode>(input, nodes, {
        cardType: "file",
        asset: input.asset ? { ...input.asset } : null,
        description: input.description ?? "",
    })
}
