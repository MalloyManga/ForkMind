import {
    NODE_STATUS_DONE,
    NODE_STATUS_ERROR,
    NODE_STATUS_IDLE,
    NODE_STATUS_STREAMING,
} from "./constants"

// 对话节点状态(卡片状态)
export type ConversationNodeStatus =
    | typeof NODE_STATUS_IDLE
    | typeof NODE_STATUS_STREAMING
    | typeof NODE_STATUS_DONE
    | typeof NODE_STATUS_ERROR


// 对话卡片接口
export interface ConversationCard {
    id: string
    userPrompt: string
    aiResponse: string
    // 当前版本只使用单父链路构造上下文（可预测、可复现）。
    parentId: string | null
    /**
     * 未来预留：跨分支“参考关联”节点集合（不参与主链向上遍历）。
     * 主链继续使用 parentId；参考节点在提示词里作为“补充参考资料”注入。
     */
    referenceNodeIds?: string[]
    status: ConversationNodeStatus
    createdAt: string
    updatedAt: string
}

// 一个对话(画布) 内部持有多张卡片
export interface ConversationThread {
    id: string
    title: string
    cards: ConversationCard[]
}
