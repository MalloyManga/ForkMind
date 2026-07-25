export const FORKMIND_WORKSPACE_FORMAT = "forkmind-workspace"
export const FORKMIND_WORKSPACE_VERSION = "1.0.0"

export const DEFAULT_OPENAI_BASE_URL = "http://localhost:11434/v1"
export const DEFAULT_OPENAI_MODEL = ""
export const DEFAULT_OPENAI_SYSTEM_PROMPT = [
    "你是 ForkMind 无限画布中的 AI 助手",
    "请严格依据主对话链和补充参考资料回答当前问题",
    "不要假设未提供的其它画布分支内容",
].join("\n")
export const DEFAULT_OPENAI_TEMPERATURE = 0.7
export const DEFAULT_OPENAI_MAX_TOKENS = 4096
