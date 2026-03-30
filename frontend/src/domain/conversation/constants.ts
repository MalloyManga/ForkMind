// 连接线类型 主链关系 参考关系
export const EDGE_TYPE_REPLY = "reply" as const
export const EDGE_TYPE_REFERENCE = "reference" as const

// 卡片运行状态：后续流式输出、失败重试都依赖这组枚举值。
export const NODE_STATUS_IDLE = "idle" as const
export const NODE_STATUS_STREAMING = "streaming" as const
export const NODE_STATUS_DONE = "done" as const
export const NODE_STATUS_ERROR = "error" as const

// 单个对话根节点数量阈值
export const ROOT_NODE_WARNING_THRESHOLD = 3
