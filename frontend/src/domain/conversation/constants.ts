// 连接线类型：reply 走主上下文链，reference 走补充资料链。
export const EDGE_TYPE_REPLY = "reply" as const
export const EDGE_TYPE_REFERENCE = "reference" as const

// 卡片运行状态：后续流式输出、失败重试都依赖这组枚举值。
export const NODE_STATUS_IDLE = "idle" as const
export const NODE_STATUS_STREAMING = "streaming" as const
export const NODE_STATUS_DONE = "done" as const
export const NODE_STATUS_ERROR = "error" as const

// 撤销/重做历史上限，防止无限增长造成内存压力。
export const HISTORY_LIMIT = 100

// 单个对话根节点数量阈值。
export const ROOT_NODE_WARNING_THRESHOLD = 3

// 卡片布局默认值：先给出统一基准，后续接入真实 UI 可调优。
export const DEFAULT_CARD_WIDTH = 360
export const DEFAULT_CARD_MIN_HEIGHT = 160

// 从父卡片 Fork 子卡片时的默认偏移量，避免新卡片与父卡片重叠。
export const CARD_FORK_OFFSET_X = 420
export const CARD_FORK_OFFSET_Y = 60
