import { create } from "zustand"
import { HISTORY_LIMIT } from "../../domain/conversation/constants"
import type { ConversationThread } from "../../domain/conversation/types"
import type { ConversationSnapshot, ConversationStoreState } from "./contracts"
import { initialThread } from "./initialData"
import {
    cloneNode,
    cloneThread,
    createForkPosition,
    createTimestamp,
    findNodeById,
    isSameStringArrayShallow,
    normalizeParentId,
    normalizeReferenceIds,
    willCreateParentCycle,
} from "./helpers"
import { createChatNode, createNoteNode } from "./nodeFactories"

/**
 * Zustand Store（可类比 Nuxt composable 组织方式）：
 * - activeThread: 当前会话数据
 * - activeNodeId: 当前选中的节点（右侧编辑栏核心驱动字段）
 * - past/future: 撤销/重做历史快照
 */
export const useConversationStore = create<ConversationStoreState>()((set, get) => ({
    activeThread: initialThread,
    activeNodeId: initialThread.cards[0]?.id ?? null,
    pastSnapshots: [],
    futureSnapshots: [],

    /**
     * 切换到指定线程。
     * 语义：会话切换属于“上下文切换”，默认重置历史栈。
     */
    setActiveThread: (thread) => {
        const nextThread = cloneThread(thread)
        set({
            activeThread: nextThread,
            activeNodeId: nextThread.cards[0]?.id ?? null,
            pastSnapshots: [],
            futureSnapshots: [],
        })
    },

    /**
     * 设置当前选中节点。
     * 场景：用户点击画布节点后，右侧编辑栏切换到对应内容。
     */
    setActiveNodeId: (nodeId) => {
        set((state) => {
            if (nodeId === null) {
                return { activeNodeId: null }
            }

            // 情境：用户点击了一个已被删除/不存在的节点 id，此时忽略本次选择。
            const isNodeExists = state.activeThread.cards.some((node) => node.id === nodeId)
            if (!isNodeExists) {
                return {}
            }

            return { activeNodeId: nodeId }
        })
    },

    /**
     * 批量替换当前线程节点。
     * 主要用于导入/恢复，不建议组件层当作常规业务写接口使用。
     */
    setActiveThreadCards: (cards) => {
        set((state) => {
            // 场景：导入会话 JSON 后，先把外部节点深拷贝进 store，隔离引用副作用。
            const nextThread: ConversationThread = {
                ...state.activeThread,
                cards: cards.map((node) => cloneNode(node)),
            }

            // 如果原 active 节点已不存在（例如导入内容里没有它），就降级到第一个节点。
            /**
             * 导入后 active 选择策略：
             * - 若当前就是失焦态（null），继续保持 null
             * - 若当前有 active 且导入后仍存在，保持该 active
             * - 若当前有 active 但导入后丢失，降级为 null（不强制抢焦到第一张）
             */
            const nextActiveNodeId =
                state.activeNodeId === null
                    ? null
                    : nextThread.cards.some((node) => node.id === state.activeNodeId)
                        ? state.activeNodeId
                        : null

            // 进入可撤销历史：保证“批量替换卡片”也能被 Ctrl+Z 回退。
            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            const nextPast = [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT)

            return {
                activeThread: nextThread,
                activeNodeId: nextActiveNodeId,
                pastSnapshots: nextPast,
                futureSnapshots: [],
            }
        })
    },

    /**
     * 新增 chat 节点，并将其设为 active。
     */
    addChatNode: (input = {}) => {
        let createdNodeId = ""

        set((state) => {
            const nextNode = createChatNode(input, state.activeThread.cards)
            createdNodeId = nextNode.id

            const nextThread: ConversationThread = {
                ...state.activeThread,
                cards: [...state.activeThread.cards, nextNode],
            }

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: nextThread,
                activeNodeId: nextNode.id,
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })

        return createdNodeId
    },

    /**
     * 新增 note 节点，并将其设为 active。
     */
    addNoteNode: (input = {}) => {
        let createdNodeId = ""

        set((state) => {
            const nextNode = createNoteNode(input, state.activeThread.cards)
            createdNodeId = nextNode.id

            const nextThread: ConversationThread = {
                ...state.activeThread,
                cards: [...state.activeThread.cards, nextNode],
            }

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: nextThread,
                activeNodeId: nextNode.id,
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })

        return createdNodeId
    },

    /**
     * 从指定源节点 Fork 一个新的 chat 节点。
     */
    forkChatNode: (input) => {
        let createdNodeId: string | null = null

        set((state) => {
            const sourceNode = findNodeById(state.activeThread.cards, input.sourceNodeId)
            if (!sourceNode) {
                return {}
            }

            const nextNode = createChatNode(
                {
                    parentId: sourceNode.id,
                    userPrompt: input.userPrompt,
                    aiResponse: input.aiResponse,
                    referenceNodeIds: input.referenceNodeIds,
                    position: createForkPosition(sourceNode),
                },
                state.activeThread.cards,
            )

            createdNodeId = nextNode.id

            const nextThread: ConversationThread = {
                ...state.activeThread,
                cards: [...state.activeThread.cards, nextNode],
            }

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: nextThread,
                activeNodeId: nextNode.id,
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })

        return createdNodeId
    },

    /**
     * 从指定源节点 Fork 一个新的 note 节点。
     * 业务场景：从任意讨论节点旁边快速拉出“人工补充笔记”分支。
     */
    forkNoteNode: (input) => {
        let createdNodeId: string | null = null

        set((state) => {
            const sourceNode = findNodeById(state.activeThread.cards, input.sourceNodeId)
            if (!sourceNode) {
                return {}
            }

            const nextNode = createNoteNode(
                {
                    parentId: sourceNode.id,
                    noteContent: input.noteContent,
                    referenceNodeIds: input.referenceNodeIds,
                    position: createForkPosition(sourceNode),
                },
                state.activeThread.cards,
            )

            createdNodeId = nextNode.id

            const nextThread: ConversationThread = {
                ...state.activeThread,
                cards: [...state.activeThread.cards, nextNode],
            }

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: nextThread,
                activeNodeId: nextNode.id,
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })

        return createdNodeId
    },

    /**
     * 更新 chat 节点的用户输入内容。
     */
    updateChatPrompt: (nodeId, userPrompt) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.type !== "chat" || targetNode.userPrompt === userPrompt) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) => {
                if (node.id !== nodeId || node.type !== "chat") {
                    return node
                }

                return {
                    ...node,
                    userPrompt,
                    updatedAt: now,
                }
            })

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: { ...state.activeThread, cards: nextCards },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })
    },

    /**
     * 更新 chat 节点的 AI 输出内容。
     */
    updateChatResponse: (nodeId, aiResponse) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.type !== "chat" || targetNode.aiResponse === aiResponse) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) => {
                if (node.id !== nodeId || node.type !== "chat") {
                    return node
                }

                return {
                    ...node,
                    aiResponse,
                    updatedAt: now,
                }
            })

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: { ...state.activeThread, cards: nextCards },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })
    },

    /**
     * 更新 note 节点内容。
     */
    updateNoteContent: (nodeId, noteContent) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.type !== "note" || targetNode.noteContent === noteContent) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) => {
                if (node.id !== nodeId || node.type !== "note") {
                    return node
                }

                return {
                    ...node,
                    noteContent,
                    updatedAt: now,
                }
            })

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: { ...state.activeThread, cards: nextCards },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })
    },

    /**
     * 移动节点位置。
     * 语义：仅更新 position，不改 parent/reference 等结构关系。
     */
    moveNode: (nodeId, nextPosition) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (
                !targetNode ||
                (targetNode.position.x === nextPosition.x && targetNode.position.y === nextPosition.y)
            ) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) =>
                node.id === nodeId
                    ? {
                        ...node,
                        position: { ...nextPosition },
                        updatedAt: now,
                    }
                    : node,
            )

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: { ...state.activeThread, cards: nextCards },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })
    },

    /**
     * 变更父节点关系。
     * 关键约束：禁止自指向、禁止成环、父节点不存在时自动降级为根节点。
     */
    setNodeParent: (nodeId, parentId) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode) {
                return {}
            }

            // 若传入父 id 不存在于当前线程，按业务规则自动降级为根节点（null）。
            const normalizedParentId = normalizeParentId(state.activeThread.cards, parentId)

            if (
                targetNode.parentId === normalizedParentId ||
                normalizedParentId === nodeId ||
                // 如果命中：未变化/自指向/会成环，则拒绝本次父子关系修改。
                willCreateParentCycle(state.activeThread.cards, nodeId, normalizedParentId)
            ) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) =>
                node.id === nodeId
                    ? {
                        ...node,
                        parentId: normalizedParentId,
                        updatedAt: now,
                    }
                    : node,
            )

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: { ...state.activeThread, cards: nextCards },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })
    },

    /**
     * 更新参考链（referenceNodeIds）。
     * 参考链不参与主链遍历，但会参与后续“补充参考资料”上下文拼装。
     */
    setNodeReferences: (nodeId, referenceNodeIds) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode) {
                return {}
            }

            const normalizedReferences = normalizeReferenceIds(
                referenceNodeIds,
                nodeId,
                state.activeThread.cards,
            )

            if (isSameStringArrayShallow(targetNode.referenceNodeIds, normalizedReferences)) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) =>
                node.id === nodeId
                    ? {
                        ...node,
                        referenceNodeIds: normalizedReferences,
                        updatedAt: now,
                    }
                    : node,
            )

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: { ...state.activeThread, cards: nextCards },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })
    },

    /**
     * 批量删除节点（Figma 风格）。
     * 支持框选后直接 Backspace 删除，并自动修复 parent/reference 引用。
     */
    deleteNodes: (nodeIds) => {
        set((state) => {
            if (nodeIds.length === 0) {
                return {}
            }

            const deletedIdSet = new Set(nodeIds)
            const hasAnyDeletion = state.activeThread.cards.some((node) => deletedIdSet.has(node.id))
            if (!hasAnyDeletion) {
                return {}
            }

            const now = createTimestamp()
            const remainingNodes = state.activeThread.cards.filter(
                (node) => !deletedIdSet.has(node.id),
            )

            /**
             * Figma 风格删除策略：
             * - 被选中节点直接删除
             * - 子节点若父节点被删，自动降级为根节点
             * - 引用链自动去除已删除节点
             */
            const nextCards = remainingNodes.map((node) => {
                const nextParentId =
                    node.parentId && deletedIdSet.has(node.parentId) ? null : node.parentId

                const nextReferences = node.referenceNodeIds?.filter(
                    (id) => !deletedIdSet.has(id),
                )
                const normalizedReferences =
                    nextReferences && nextReferences.length > 0 ? nextReferences : undefined

                if (
                    nextParentId === node.parentId &&
                    isSameStringArrayShallow(node.referenceNodeIds, normalizedReferences)
                ) {
                    return node
                }

                return {
                    ...node,
                    parentId: nextParentId,
                    referenceNodeIds: normalizedReferences,
                    updatedAt: now,
                }
            })

            const nextActiveNodeId =
                state.activeNodeId && !deletedIdSet.has(state.activeNodeId)
                    ? state.activeNodeId
                    : nextCards[0]?.id ?? null

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: { ...state.activeThread, cards: nextCards },
                activeNodeId: nextActiveNodeId,
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
            }
        })
    },

    /**
     * 撤销：回到上一个历史快照。
     */
    undo: () => {
        set((state) => {
            if (state.pastSnapshots.length === 0) {
                return {}
            }

            const previousSnapshot = state.pastSnapshots[state.pastSnapshots.length - 1]
            const nextPastSnapshots = state.pastSnapshots.slice(0, -1)
            const currentSnapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: cloneThread(previousSnapshot.thread),
                activeNodeId: previousSnapshot.activeNodeId,
                pastSnapshots: nextPastSnapshots,
                futureSnapshots: [currentSnapshot, ...state.futureSnapshots],
            }
        })
    },

    /**
     * 重做：应用 future 栈的下一条快照。
     */
    redo: () => {
        set((state) => {
            if (state.futureSnapshots.length === 0) {
                return {}
            }

            const [nextSnapshot, ...restFutureSnapshots] = state.futureSnapshots
            const currentSnapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: cloneThread(nextSnapshot.thread),
                activeNodeId: nextSnapshot.activeNodeId,
                pastSnapshots: [...state.pastSnapshots, currentSnapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: restFutureSnapshots,
            }
        })
    },

    /**
     * 是否可撤销/重做：用于按钮禁用态与快捷键保护判断。
     */
    canUndo: () => get().pastSnapshots.length > 0,
    canRedo: () => get().futureSnapshots.length > 0,
}))
