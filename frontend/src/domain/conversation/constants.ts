// 连接线类型：reply 走主上下文链，reference 走补充资料链。
export const EDGE_TYPE_REPLY = "reply"
export const EDGE_TYPE_REFERENCE = "reference"

// 卡片运行状态：后续流式输出、失败重试都依赖这组枚举值。
export const NODE_STATUS_IDLE = "idle"
export const NODE_STATUS_STREAMING = "streaming"
export const NODE_STATUS_DONE = "done"
export const NODE_STATUS_ERROR = "error"

// 撤销/重做历史上限，防止无限增长造成内存压力。
export const HISTORY_LIMIT = 100


// 新建会话在用户第一次输入前使用的稳定默认标题
export const DEFAULT_THREAD_TITLE = "未命名会话"

// 自动标题只截取首段内容 避免长 Prompt 挤压左侧会话列表
export const THREAD_TITLE_MAX_LENGTH = 36

// 卡片布局默认值：先给出统一基准，后续接入真实 UI 可调优。
export const DEFAULT_CARD_WIDTH = 360
export const DEFAULT_CARD_MIN_HEIGHT = 160

// 从父卡片 Fork 子卡片时的默认偏移量，避免新卡片与父卡片重叠。
export const CARD_FORK_OFFSET_X = 420
export const CARD_FORK_OFFSET_Y = 60
