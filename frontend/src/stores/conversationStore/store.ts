import { create } from "zustand"
import { assertNever } from "@/lib/utils"
import {
    DEFAULT_THREAD_TITLE,
    HISTORY_LIMIT,
    NODE_STATUS_DONE,
    NODE_STATUS_ERROR,
    NODE_STATUS_IDLE,
    NODE_STATUS_STREAMING,
} from "../../domain/conversation/constants"
import { deriveThreadTitleFromPrompt } from "../../domain/conversation/helpers"
import type {
    BaseNode,
    ConversationCard,
    ConversationCardPosition,
    ConversationThread,
} from "../../domain/conversation/types"
import type {
    AddConversationNodeDraftInput,
    AddNodeDraftInput,
    CanvasClipboardPayload,
    ClipboardNodeSnapshot,
    ConversationSnapshot,
    ConversationStoreState,
    ConversationTextField,
    ConversationThreadRuntime,
} from "./contracts"
import { initialThread } from "./initialData"
import {
    cloneNode,
    cloneSnapshot,
    cloneThread,
    createForkPosition,
    createNodeId,
    createTimestamp,
    findNodeById,
    isSameStringArrayShallow,
    normalizeParentId,
    normalizeReferenceIds,
    normalizeTextAnchor,
    willCreateParentCycle,
} from "./helpers"
import {
    createChatNode,
    createFileNode,
    createImageNode,
    createLinkNode,
    createNoteNode,
} from "./nodeFactories"

interface RemappedClipboardRelations {
    parentId: string | null
    referenceNodeIds?: string[]
    sourceAnchor?: BaseNode["sourceAnchor"]
}

interface CreatePastedNodesResult {
    pastedNodeIds: string[]
    pastedNodes: ConversationCard[]
}

interface TextMutationHistoryResult {
    pastSnapshots: ConversationSnapshot[]
    futureSnapshots: ConversationSnapshot[]
    textEditSession: ConversationStoreState["textEditSession"]
}

/**
 * 深拷贝单个会话的编辑器运行时
 * @param runtime 入参来自 threadRuntimeById 中的历史状态
 * @returns 返回与缓存断开引用的新运行时对象
 * 用户切回旧会话时触发 防止撤销栈跨会话共享对象
 */
function cloneThreadRuntime(runtime: ConversationThreadRuntime): ConversationThreadRuntime {
    return {
        activeNodeId: runtime.activeNodeId,
        pastSnapshots: runtime.pastSnapshots.map((snapshot) => cloneSnapshot(snapshot)),
        futureSnapshots: runtime.futureSnapshots.map((snapshot) => cloneSnapshot(snapshot)),
    }
}

/**
 * 计算一次文本变化对应的历史状态
 * @param state 入参是当前 Zustand 状态 用于读取编辑事务与历史栈
 * @param nodeId 入参来自右侧编辑栏当前节点 用于确认本次变化属于哪张卡片
 * @param field 入参表示当前修改的业务文本字段
 * @returns 返回本次更新应写回的历史栈与编辑事务状态
 * 用户连续输入时仅第一次变化保存撤销基线 避免每个字符深拷贝整棵节点树
 */
function resolveTextMutationHistory(
    state: ConversationStoreState,
    nodeId: string,
    field: ConversationTextField,
): TextMutationHistoryResult {
    const currentSession = state.textEditSession
    const isMatchingSession =
        currentSession?.nodeId === nodeId && currentSession.field === field
    const shouldCaptureSnapshot = !isMatchingSession || !currentSession.hasChanges

    const nextPastSnapshots = shouldCaptureSnapshot
        ? [
            ...state.pastSnapshots,
            {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            },
        ].slice(-HISTORY_LIMIT)
        : state.pastSnapshots

    return {
        pastSnapshots: nextPastSnapshots,
        futureSnapshots: [],
        textEditSession: isMatchingSession
            ? {
                nodeId,
                field,
                hasChanges: true,
            }
            : null,
    }
}

/**
 * Store 内部 chat 节点创建实现
 * input 来自 addNode 的统一 draft 入口 或 fork 业务动作
 * 返回值是补齐 id 时间戳 关系和尺寸后的完整 Store 节点
 */
function addChatNode(
    input: AddNodeDraftInput<"chat">,
    nodes: readonly ConversationCard[],
): ConversationCard {
    return createChatNode(input, nodes)
}

/**
 * Store 内部 note 节点创建实现
 * input 来自 addNode 的统一 draft 入口 或 fork 业务动作
 * 返回值是补齐 id 时间戳 关系和尺寸后的完整 Store 节点
 */
function addNoteNode(
    input: AddNodeDraftInput<"note">,
    nodes: readonly ConversationCard[],
): ConversationCard {
    return createNoteNode(input, nodes)
}

function addImageNode(
    input: AddNodeDraftInput<"image">,
    nodes: readonly ConversationCard[],
): ConversationCard {
    return createImageNode(input, nodes)
}

function addLinkNode(
    input: AddNodeDraftInput<"link">,
    nodes: readonly ConversationCard[],
): ConversationCard {
    return createLinkNode(input, nodes)
}

function addFileNode(
    input: AddNodeDraftInput<"file">,
    nodes: readonly ConversationCard[],
): ConversationCard {
    return createFileNode(input, nodes)
}

/**
 * Store 新增节点的唯一分发点
 * input.cardType 是业务判别字段 用来选择具体节点工厂
 * hooks/components 只调用 addNode 不再直接依赖 chat/note 分支函数
 */
function createNodeFromDraft(
    input: AddConversationNodeDraftInput,
    nodes: readonly ConversationCard[],
): ConversationCard {
    switch (input.cardType) {
        case "chat":
            return addChatNode(input, nodes)
        case "note":
            return addNoteNode(input, nodes)
        case "image":
            return addImageNode(input, nodes)
        case "link":
            return addLinkNode(input, nodes)
        case "file":
            return addFileNode(input, nodes)
    }

    return assertNever(input)
}

/**
 * 计算一组卡片的左上角坐标
 */
function getCardsTopLeft(cards: ConversationCard[]): ConversationCardPosition {
    if (cards.length === 0) {
        throw new Error("Cannot calculate top left point from empty cards")
    }

    return cards.reduce(
        (currentTopLeft, card) => ({
            x: Math.min(currentTopLeft.x, card.position.x),
            y: Math.min(currentTopLeft.y, card.position.y),
        }),
        { x: cards[0].position.x, y: cards[0].position.y },
    )
}

/**
 * 从 old node id 映射表读取新 node id
 * originalNodeId 来自剪贴板快照
 * 找不到说明 payload 或映射表已经损坏 直接抛错比静默丢关系更安全
 */
function getRequiredPastedNodeId(
    originalNodeId: string,
    pastedIdByOriginalId: Map<string, string>,
): string {
    const pastedNodeId = pastedIdByOriginalId.get(originalNodeId)
    if (!pastedNodeId) {
        throw new Error(`Missing pasted node id for ${originalNodeId}`)
    }

    return pastedNodeId
}

/**
 * 重建剪贴板节点内部关系
 * 只保留复制集合内部的 parent/reference 避免新节点指向未复制的旧外部节点
 */
function remapClipboardRelations(
    clipboardNode: ClipboardNodeSnapshot,
    copiedOriginalIdSet: Set<string>,
    pastedIdByOriginalId: Map<string, string>,
): RemappedClipboardRelations {
    const parentId =
        clipboardNode.parentId && copiedOriginalIdSet.has(clipboardNode.parentId)
            ? getRequiredPastedNodeId(clipboardNode.parentId, pastedIdByOriginalId)
            : null

    const referenceNodeIds = clipboardNode.referenceNodeIds
        ?.filter((referenceNodeId) => copiedOriginalIdSet.has(referenceNodeId))
        .map((referenceNodeId) => getRequiredPastedNodeId(referenceNodeId, pastedIdByOriginalId))

    const sourceAnchor = clipboardNode.sourceAnchor &&
        copiedOriginalIdSet.has(clipboardNode.sourceAnchor.sourceNodeId)
        ? {
            ...clipboardNode.sourceAnchor,
            sourceNodeId: getRequiredPastedNodeId(
                clipboardNode.sourceAnchor.sourceNodeId,
                pastedIdByOriginalId,
            ),
        }
        : undefined

    return {
        parentId,
        referenceNodeIds: referenceNodeIds && referenceNodeIds.length > 0 ? referenceNodeIds : undefined,
        sourceAnchor,
    }
}

/**
 * 从剪贴板 payload 创建真正写入 Store 的新节点
 */
function createPastedNodesFromPayload(
    payload: CanvasClipboardPayload,
    pastePoint: ConversationCardPosition,
    now: string,
): CreatePastedNodesResult {
    const copiedOriginalIdSet = new Set(payload.nodes.map((clipboardNode) => clipboardNode.originalNodeId))
    const pastedIdByOriginalId = new Map(
        payload.nodes.map((clipboardNode) => [clipboardNode.originalNodeId, createNodeId()] as const),
    )

    const pastedNodeIds: string[] = []
    const pastedNodes = payload.nodes.map((clipboardNode): ConversationCard => {
        const nextNodeId = getRequiredPastedNodeId(clipboardNode.originalNodeId, pastedIdByOriginalId)
        const nextRelations = remapClipboardRelations(clipboardNode, copiedOriginalIdSet, pastedIdByOriginalId)

        pastedNodeIds.push(nextNodeId)

        const pastedBaseNode: BaseNode = {
            id: nextNodeId,
            cardType: clipboardNode.cardType,
            parentId: nextRelations.parentId,
            referenceNodeIds: nextRelations.referenceNodeIds,
            sourceAnchor: nextRelations.sourceAnchor,
            position: {
                x: pastePoint.x + (clipboardNode.position.x - payload.sourceTopLeft.x),
                y: pastePoint.y + (clipboardNode.position.y - payload.sourceTopLeft.y),
            },
            size: { ...clipboardNode.size },
            status: clipboardNode.status,
            createdAt: now,
            updatedAt: now,
        }

        switch (clipboardNode.cardType) {
            case "chat":
                return {
                    ...pastedBaseNode,
                    cardType: "chat",
                    userPrompt: clipboardNode.userPrompt,
                    aiResponse: clipboardNode.aiResponse,
                }
            case "note":
                return {
                    ...pastedBaseNode,
                    cardType: "note",
                    noteContent: clipboardNode.noteContent,
                }
            case "image":
                return {
                    ...pastedBaseNode,
                    cardType: "image",
                    asset: clipboardNode.asset ? { ...clipboardNode.asset } : null,
                    caption: clipboardNode.caption,
                    altText: clipboardNode.altText,
                }
            case "link":
                return {
                    ...pastedBaseNode,
                    cardType: "link",
                    url: clipboardNode.url,
                    title: clipboardNode.title,
                    description: clipboardNode.description,
                }
            case "file":
                return {
                    ...pastedBaseNode,
                    cardType: "file",
                    asset: clipboardNode.asset ? { ...clipboardNode.asset } : null,
                    description: clipboardNode.description,
                }
        }

        return assertNever(clipboardNode)
    })

    const normalizedPastedNodes = pastedNodes.map((pastedNode) => ({
        ...pastedNode,
        sourceAnchor: normalizeTextAnchor(pastedNode.sourceAnchor, pastedNode.id, pastedNodes),
    }))

    return {
        pastedNodeIds,
        pastedNodes: normalizedPastedNodes,
    }
}

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
    textEditSession: null,
    threadRuntimeById: {},

    /**
     * 切换到指定线程
     */
    setActiveThread: (thread) => {
        set((state) => {
            const nextThread = cloneThread(thread)
            const currentRuntime: ConversationThreadRuntime = {
                activeNodeId: state.activeNodeId,
                pastSnapshots: state.pastSnapshots.map((snapshot) => cloneSnapshot(snapshot)),
                futureSnapshots: state.futureSnapshots.map((snapshot) => cloneSnapshot(snapshot)),
            }
            const nextRuntimeById = {
                ...state.threadRuntimeById,
                [state.activeThread.id]: currentRuntime,
            }
            const cachedNextRuntime = nextRuntimeById[nextThread.id]
            const nextRuntime = cachedNextRuntime
                ? cloneThreadRuntime(cachedNextRuntime)
                : {
                    activeNodeId: nextThread.cards[0]?.id ?? null,
                    pastSnapshots: [],
                    futureSnapshots: [],
                }
            const normalizedActiveNodeId =
                nextRuntime.activeNodeId !== null &&
                    nextThread.cards.some((card) => card.id === nextRuntime.activeNodeId)
                    ? nextRuntime.activeNodeId
                    : nextThread.cards[0]?.id ?? null

            return {
                activeThread: nextThread,
                activeNodeId: normalizedActiveNodeId,
                pastSnapshots: nextRuntime.pastSnapshots,
                futureSnapshots: nextRuntime.futureSnapshots,
                textEditSession: null,
                threadRuntimeById: nextRuntimeById,
            }
        })
    },

    /**
     * 重命名当前会话
     * title 来自左侧栏内联输入 空字符串降级为默认标题
     * 返回值为空 因为工作区同步层会自动接收新的 activeThread
     */
    renameActiveThread: (title) => {
        const normalizedTitle = title.trim() || DEFAULT_THREAD_TITLE
        const now = createTimestamp()

        set((state) => ({
            activeThread: {
                ...state.activeThread,
                title: normalizedTitle,
                updatedAt: now,
            },
        }))
    },

    /**
     * 删除某个会话对应的临时编辑器运行时
     * threadId 来自工作区删除动作 防止已删除会话继续占用历史快照内存
     */
    forgetThreadRuntime: (threadId) => {
        set((state) => {
            if (!(threadId in state.threadRuntimeById)) {
                return {}
            }

            const nextRuntimeById = { ...state.threadRuntimeById }
            delete nextRuntimeById[threadId]
            return { threadRuntimeById: nextRuntimeById }
        })
    },

    /**
     * 清空所有会话的编辑器运行时缓存
     * @returns 无返回值 activeThread 会由后续导入水化动作整体替换
     * 用户导入完整工作区时触发 防止相同 Thread id 复用导入前的撤销栈和选中节点
     */
    resetThreadRuntimes: () => {
        set({
            pastSnapshots: [],
            futureSnapshots: [],
            textEditSession: null,
            threadRuntimeById: {},
        })
    },

    /**
     * 设置当前选中节点
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
     * 批量替换当前线程节点
     * 主要用于导入/恢复
     */
    setActiveThreadCards: (cards) => {
        set((state) => {
            // 导入会话 JSON 后 先把外部节点深拷贝进 store 隔离引用副作用
            const nextThread: ConversationThread = {
                ...state.activeThread,
                cards: cards.map((node) => cloneNode(node)),
                updatedAt: createTimestamp(),
            }

            // 如果原 active 节点已不存在（例如导入内容里没有它） 就降级到第一个节点
            /**
             * 导入后 active 选择策略
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
                textEditSession: null,
            }
        })
    },

    /**
     * 统一新增节点入口
     * input 为 UI 或画布桥接层提交的节点草稿
     * 返回值是新节点 id 用于同步 activeNodeId 和 tldraw 选择态
     */
    addNode: (input) => {
        let createdNodeId = ""

        set((state) => {
            const nextNode = createNodeFromDraft(input, state.activeThread.cards)
            createdNodeId = nextNode.id

            const nextThread: ConversationThread = {
                ...state.activeThread,
                cards: [...state.activeThread.cards, nextNode],
                updatedAt: nextNode.updatedAt,
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
                textEditSession: null,
            }
        })

        return createdNodeId
    },

    /**
     * 从指定源节点 Fork 一个新的 chat 节点
     */
    forkChatNode: (input) => {
        let createdNodeId: string | null = null

        set((state) => {
            const sourceNode = findNodeById(state.activeThread.cards, input.sourceNodeId)
            if (!sourceNode) {
                return {}
            }

            const nextNode = addChatNode(
                {
                    parentId: sourceNode.id,
                    userPrompt: input.userPrompt,
                    aiResponse: input.aiResponse,
                    referenceNodeIds: input.referenceNodeIds,
                    sourceAnchor: input.sourceAnchor,
                    position: createForkPosition(sourceNode),
                },
                state.activeThread.cards,
            )

            createdNodeId = nextNode.id

            const nextThread: ConversationThread = {
                ...state.activeThread,
                cards: [...state.activeThread.cards, nextNode],
                updatedAt: nextNode.updatedAt,
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
                textEditSession: null,
            }
        })

        return createdNodeId
    },

    /**
     * 从指定源节点 Fork 一个新的 note 节点
     */
    forkNoteNode: (input) => {
        let createdNodeId: string | null = null

        set((state) => {
            const sourceNode = findNodeById(state.activeThread.cards, input.sourceNodeId)
            if (!sourceNode) {
                return {}
            }

            const nextNode = addNoteNode(
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
                updatedAt: nextNode.updatedAt,
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
                textEditSession: null,
            }
        })

        return createdNodeId
    },

    /**
     * 更新 chat 节点的用户输入内容
     */
    updateChatPrompt: (nodeId, userPrompt) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.cardType !== "chat" || targetNode.userPrompt === userPrompt) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) => {
                if (node.id !== nodeId || node.cardType !== "chat") {
                    return node
                }

                return {
                    ...node,
                    userPrompt,
                    updatedAt: now,
                }
            })

            const textMutationHistory = resolveTextMutationHistory(
                state,
                nodeId,
                "userPrompt",
            )
            const shouldDeriveThreadTitle =
                state.activeThread.title === DEFAULT_THREAD_TITLE &&
                targetNode.userPrompt.trim().length === 0 &&
                userPrompt.trim().length > 0
            const nextThreadTitle = shouldDeriveThreadTitle
                ? deriveThreadTitleFromPrompt(userPrompt)
                : state.activeThread.title

            return {
                activeThread: {
                    ...state.activeThread,
                    title: nextThreadTitle,
                    cards: nextCards,
                    updatedAt: now,
                },
                ...textMutationHistory,
            }
        })
    },

    /**
     * 更新 chat 节点的 AI 输出内容
     */
    updateChatResponse: (nodeId, aiResponse) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.cardType !== "chat" || targetNode.aiResponse === aiResponse) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) => {
                if (node.id !== nodeId || node.cardType !== "chat") {
                    return node
                }

                return {
                    ...node,
                    aiResponse,
                    updatedAt: now,
                }
            })

            const textMutationHistory = resolveTextMutationHistory(
                state,
                nodeId,
                "aiResponse",
            )

            return {
                activeThread: {
                    ...state.activeThread,
                    cards: nextCards,
                    updatedAt: now,
                },
                ...textMutationHistory,
            }
        })
    },

    /**
     * 开始生成 chat 节点的 AI 输出
     * @param nodeId 入参来自发送或重新生成按钮 用于定位当前 Chat 节点
     * @returns 返回 true 表示已建立请求前历史基线 false 表示节点无效或 Prompt 为空
     * 用户触发发送时清空旧回答并进入 streaming 后续 chunk 不再重复写撤销历史
     */
    startChatResponse: (nodeId) => {
        let didStart = false

        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (
                !targetNode ||
                targetNode.cardType !== "chat" ||
                targetNode.userPrompt.trim().length === 0 ||
                targetNode.status === NODE_STATUS_STREAMING
            ) {
                return {}
            }

            const now = createTimestamp()
            const nextCards: ConversationCard[] = state.activeThread.cards.map((node) =>
                node.id === nodeId && node.cardType === "chat"
                    ? {
                        ...node,
                        aiResponse: "",
                        status: NODE_STATUS_STREAMING,
                        updatedAt: now,
                    }
                    : node,
            )
            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            didStart = true
            return {
                activeThread: {
                    ...state.activeThread,
                    cards: nextCards,
                    updatedAt: now,
                },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
                textEditSession: null,
            }
        })

        return didStart
    },

    /**
     * 追加单个流式文本片段
     * @param nodeId 入参来自已校验的 Wails chunk 事件 用于防止响应写入其他节点
     * @param delta 入参是 Provider 本次增量文本 空字符串不会产生状态变化
     * @returns 无返回值 chunk 只更新当前回答和时间戳 不创建逐字符撤销快照
     * OpenAI-compatible SSE 每到达一个 content delta 时触发
     */
    appendChatResponseChunk: (nodeId, delta) => {
        if (delta.length === 0) {
            return
        }

        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (
                !targetNode ||
                targetNode.cardType !== "chat" ||
                targetNode.status !== NODE_STATUS_STREAMING
            ) {
                return {}
            }

            const now = createTimestamp()
            return {
                activeThread: {
                    ...state.activeThread,
                    cards: state.activeThread.cards.map((node) =>
                        node.id === nodeId && node.cardType === "chat"
                            ? {
                                ...node,
                                aiResponse: `${node.aiResponse}${delta}`,
                                updatedAt: now,
                            }
                            : node,
                    ),
                    updatedAt: now,
                },
            }
        })
    },

    /**
     * 标记流式回答正常完成
     * @param nodeId 入参来自 done 事件 用于定位本次请求对应的 Chat 节点
     * @returns 无返回值 非 streaming 节点会被忽略
     * Provider 正常结束 SSE 后触发并把节点收口为 done
     */
    completeChatResponse: (nodeId) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (
                !targetNode ||
                targetNode.cardType !== "chat" ||
                targetNode.status !== NODE_STATUS_STREAMING
            ) {
                return {}
            }

            const now = createTimestamp()
            return {
                activeThread: {
                    ...state.activeThread,
                    cards: state.activeThread.cards.map((node) =>
                        node.id === nodeId
                            ? { ...node, status: NODE_STATUS_DONE, updatedAt: now }
                            : node,
                    ),
                    updatedAt: now,
                },
            }
        })
    },

    /**
     * 收口被用户取消的流式回答
     * @param nodeId 入参来自 Stop 动作对应的 done cancelled 事件
     * @returns 无返回值 有部分回答时保留为 done 无任何回答时恢复 idle
     * 用户主动停止生成后触发并保留已经收到的可用文本
     */
    cancelChatResponse: (nodeId) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (
                !targetNode ||
                targetNode.cardType !== "chat" ||
                targetNode.status !== NODE_STATUS_STREAMING
            ) {
                return {}
            }

            const now = createTimestamp()
            const nextStatus = targetNode.aiResponse.length > 0
                ? NODE_STATUS_DONE
                : NODE_STATUS_IDLE
            return {
                activeThread: {
                    ...state.activeThread,
                    cards: state.activeThread.cards.map((node) =>
                        node.id === nodeId
                            ? { ...node, status: nextStatus, updatedAt: now }
                            : node,
                    ),
                    updatedAt: now,
                },
            }
        })
    },

    /**
     * 标记流式回答失败
     * @param nodeId 入参来自 Bridge 启动错误或 Wails error 事件
     * @returns 无返回值 非 streaming 节点会被忽略
     * 网络 Provider 或响应协议失败时触发 回答文本保留用于问题诊断
     */
    failChatResponse: (nodeId) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (
                !targetNode ||
                targetNode.cardType !== "chat" ||
                targetNode.status !== NODE_STATUS_STREAMING
            ) {
                return {}
            }

            const now = createTimestamp()
            return {
                activeThread: {
                    ...state.activeThread,
                    cards: state.activeThread.cards.map((node) =>
                        node.id === nodeId
                            ? { ...node, status: NODE_STATUS_ERROR, updatedAt: now }
                            : node,
                    ),
                    updatedAt: now,
                },
            }
        })
    },

    /**
     * 更新 note 节点内容
     */
    updateNoteContent: (nodeId, noteContent) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.cardType !== "note" || targetNode.noteContent === noteContent) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) => {
                if (node.id !== nodeId || node.cardType !== "note") {
                    return node
                }

                return {
                    ...node,
                    noteContent,
                    updatedAt: now,
                }
            })

            const textMutationHistory = resolveTextMutationHistory(
                state,
                nodeId,
                "noteContent",
            )

            return {
                activeThread: {
                    ...state.activeThread,
                    cards: nextCards,
                    updatedAt: now,
                },
                ...textMutationHistory,
            }
        })
    },

    /**
     * 更新图片节点的本地资产或文本说明
     * update 来自选择图片 Alt Text 和 Caption 编辑动作
     */
    updateImageNode: (nodeId, update) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.cardType !== "image") {
                return {}
            }

            const nextAsset = update.asset === undefined
                ? targetNode.asset
                : update.asset
                    ? { ...update.asset }
                    : null
            const nextCaption = update.caption ?? targetNode.caption
            const nextAltText = update.altText ?? targetNode.altText
            if (
                targetNode.caption === nextCaption &&
                targetNode.altText === nextAltText &&
                JSON.stringify(targetNode.asset) === JSON.stringify(nextAsset)
            ) {
                return {}
            }

            const now = createTimestamp()
            const changedTextField: ConversationTextField | undefined =
                update.caption !== undefined
                    ? "caption"
                    : update.altText !== undefined
                        ? "altText"
                        : undefined
            const mutationHistory = changedTextField
                ? resolveTextMutationHistory(state, nodeId, changedTextField)
                : {
                    pastSnapshots: [
                        ...state.pastSnapshots,
                        { thread: cloneThread(state.activeThread), activeNodeId: state.activeNodeId },
                    ].slice(-HISTORY_LIMIT),
                    futureSnapshots: [],
                    textEditSession: null,
                }

            return {
                activeThread: {
                    ...state.activeThread,
                    cards: state.activeThread.cards.map((node) =>
                        node.id === nodeId && node.cardType === "image"
                            ? { ...node, asset: nextAsset, caption: nextCaption, altText: nextAltText, updatedAt: now }
                            : node,
                    ),
                    updatedAt: now,
                },
                ...mutationHistory,
            }
        })
    },

    /** 更新链接节点 URL 标题或描述 不执行网络抓取 */
    updateLinkNode: (nodeId, update) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.cardType !== "link") {
                return {}
            }

            const nextURL = update.url ?? targetNode.url
            const nextTitle = update.title ?? targetNode.title
            const nextDescription = update.description ?? targetNode.description
            if (targetNode.url === nextURL && targetNode.title === nextTitle && targetNode.description === nextDescription) {
                return {}
            }

            const now = createTimestamp()
            const changedTextField: ConversationTextField =
                update.url !== undefined ? "url" : update.title !== undefined ? "title" : "description"
            return {
                activeThread: {
                    ...state.activeThread,
                    cards: state.activeThread.cards.map((node) =>
                        node.id === nodeId && node.cardType === "link"
                            ? { ...node, url: nextURL, title: nextTitle, description: nextDescription, updatedAt: now }
                            : node,
                    ),
                    updatedAt: now,
                },
                ...resolveTextMutationHistory(state, nodeId, changedTextField),
            }
        })
    },

    /** 更新文件节点的本地资产或文本描述 */
    updateFileNode: (nodeId, update) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode || targetNode.cardType !== "file") {
                return {}
            }

            const nextAsset = update.asset === undefined
                ? targetNode.asset
                : update.asset
                    ? { ...update.asset }
                    : null
            const nextDescription = update.description ?? targetNode.description
            if (
                targetNode.description === nextDescription &&
                JSON.stringify(targetNode.asset) === JSON.stringify(nextAsset)
            ) {
                return {}
            }

            const now = createTimestamp()
            const mutationHistory = update.description !== undefined
                ? resolveTextMutationHistory(state, nodeId, "description")
                : {
                    pastSnapshots: [
                        ...state.pastSnapshots,
                        { thread: cloneThread(state.activeThread), activeNodeId: state.activeNodeId },
                    ].slice(-HISTORY_LIMIT),
                    futureSnapshots: [],
                    textEditSession: null,
                }
            return {
                activeThread: {
                    ...state.activeThread,
                    cards: state.activeThread.cards.map((node) =>
                        node.id === nodeId && node.cardType === "file"
                            ? { ...node, asset: nextAsset, description: nextDescription, updatedAt: now }
                            : node,
                    ),
                    updatedAt: now,
                },
                ...mutationHistory,
            }
        })
    },

    /**
     * 开始右侧文本编辑事务
     * nodeId 和 field 来自获得焦点的 textarea
     * 真正的撤销快照会延迟到第一次内容变化时创建
     */
    beginTextEdit: (nodeId, field) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (!targetNode) {
                return {}
            }

            return {
                textEditSession: {
                    nodeId,
                    field,
                    hasChanges: false,
                },
            }
        })
    },

    /**
     * 结束当前文本编辑事务
     * 用户离开 textarea 或切换节点时触发 null 表示当前没有连续输入需要合并
     */
    endTextEdit: () => {
        set({ textEditSession: null })
    },

    /**
     * 从剪贴板批量粘贴节点
     * 返回 pastedNodeIds(string)[]
     */
    pasteNodesFromClipboard: ({ payload, pastePoint }) => {
        if (payload.nodes.length === 0) {
            return []
        }

        const pastedNodeIds: string[] = []

        set((state) => {
            const now = createTimestamp()
            const { pastedNodeIds: nextPastedNodeIds, pastedNodes: nextNodes } = createPastedNodesFromPayload(
                payload,
                pastePoint,
                now,
            )
            pastedNodeIds.push(...nextPastedNodeIds)

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: {
                    ...state.activeThread,
                    cards: [...state.activeThread.cards, ...nextNodes],
                    updatedAt: now,
                },
                activeNodeId: pastedNodeIds[0] ?? state.activeNodeId,
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
                textEditSession: null,
            }
        })

        return pastedNodeIds
    },

    /**
     * paste to replace 粘贴替换节点
     * payload 来自 App 层剪贴板 targetNodeIds 来自 tldraw 当前选区
     * 返回新生成的节点 id 数组 空数组表示本次替换没有生效
     */
    replaceNodesFromClipboard: ({ payload, targetNodeIds }) => {
        if (payload.nodes.length === 0 || targetNodeIds.length === 0) {
            return []
        }

        const pastedNodeIds: string[] = []

        set((state) => {
            // 过滤掉重复的以及不存在的 nodeId
            const targetIdSet = new Set(targetNodeIds)
            const targetNodes = state.activeThread.cards.filter((node) => targetIdSet.has(node.id))
            if (targetNodes.length === 0) {
                return {}
            }

            const now = createTimestamp()
            const targetTopLeft = getCardsTopLeft(targetNodes)
            const { pastedNodeIds: nextPastedNodeIds, pastedNodes } = createPastedNodesFromPayload(
                payload,
                targetTopLeft,
                now,
            )
            pastedNodeIds.push(...nextPastedNodeIds)

            // 除去被替换的节点之后剩下的节点
            const remainingNodes = state.activeThread.cards.filter((node) => !targetIdSet.has(node.id))
            const nextCardsBeforePaste = remainingNodes.map((node) => {
                // 如果剩下的 node 当中 某一个的 parentNode 刚好处在被替换的节点当中 那么就删除 parent 关系降级为 null
                const nextParentId = node.parentId && targetIdSet.has(node.parentId) ? null : node.parentId
                // 如果某个剩余节点 reference 了被删除的旧节点 就把这条 reference 移除
                const nextReferenceNodeIds = node.referenceNodeIds?.filter(
                    (referenceNodeId) => !targetIdSet.has(referenceNodeId),
                )

                // 如果这个节点的关系完全没变 就返回原对象
                const normalizedReferenceNodeIds =
                    nextReferenceNodeIds && nextReferenceNodeIds.length > 0 ? nextReferenceNodeIds : undefined
                if (
                    nextParentId === node.parentId &&
                    isSameStringArrayShallow(node.referenceNodeIds, normalizedReferenceNodeIds)
                ) {
                    return node
                }

                return {
                    ...node,
                    parentId: nextParentId,
                    referenceNodeIds: normalizedReferenceNodeIds,
                    updatedAt: now,
                }
            })

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: {
                    ...state.activeThread,
                    cards: [...nextCardsBeforePaste, ...pastedNodes],
                    updatedAt: now,
                },
                activeNodeId: pastedNodeIds[0] ?? state.activeNodeId,
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
                textEditSession: null,
            }
        })

        return pastedNodeIds
    },

    /**
     * 移动节点位置
     * 仅更新 position 不改 parent/reference 等结构关系
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
                activeThread: { ...state.activeThread, cards: nextCards, updatedAt: now },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
                textEditSession: null,
            }
        })
    },

    /**
     * 调整节点尺寸
     * 由 tldraw 原生 resize 在 pointerup 后提交
     * 用户手动调整过尺寸后进入 fixed 模式 避免后续内容变化立即覆盖用户尺寸选择
     */
    resizeNode: (nodeId, nextSize) => {
        set((state) => {
            const targetNode = findNodeById(state.activeThread.cards, nodeId)
            if (
                !targetNode ||
                (
                    targetNode.size.mode === nextSize.mode &&
                    targetNode.size.width === nextSize.width &&
                    targetNode.size.minHeight === nextSize.minHeight
                )
            ) {
                return {}
            }

            const now = createTimestamp()
            const nextCards = state.activeThread.cards.map((node) =>
                node.id === nodeId
                    ? {
                        ...node,
                        size: { ...nextSize },
                        updatedAt: now,
                    }
                    : node,
            )

            const snapshot: ConversationSnapshot = {
                thread: cloneThread(state.activeThread),
                activeNodeId: state.activeNodeId,
            }

            return {
                activeThread: { ...state.activeThread, cards: nextCards, updatedAt: now },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
                textEditSession: null,
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
                activeThread: { ...state.activeThread, cards: nextCards, updatedAt: now },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
                textEditSession: null,
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
                activeThread: { ...state.activeThread, cards: nextCards, updatedAt: now },
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
                textEditSession: null,
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
                activeThread: { ...state.activeThread, cards: nextCards, updatedAt: now },
                activeNodeId: nextActiveNodeId,
                pastSnapshots: [...state.pastSnapshots, snapshot].slice(-HISTORY_LIMIT),
                futureSnapshots: [],
                textEditSession: null,
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
                textEditSession: null,
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
                textEditSession: null,
            }
        })
    },

    /**
     * 是否可撤销/重做：用于按钮禁用态与快捷键保护判断。
     */
    canUndo: () => get().pastSnapshots.length > 0,
    canRedo: () => get().futureSnapshots.length > 0,
}))
