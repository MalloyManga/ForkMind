import { create } from "zustand"
import {
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MAX_TOKENS,
    DEFAULT_OPENAI_MODEL,
    DEFAULT_OPENAI_SYSTEM_PROMPT,
    DEFAULT_OPENAI_TEMPERATURE,
    type PersistedOpenAISettings,
} from "../../domain/workspace"
import type { AISettingsStoreState } from "./contracts"

export const defaultPersistedOpenAISettings: PersistedOpenAISettings = {
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    model: DEFAULT_OPENAI_MODEL,
    systemPrompt: DEFAULT_OPENAI_SYSTEM_PROMPT,
    temperature: DEFAULT_OPENAI_TEMPERATURE,
    maxTokens: DEFAULT_OPENAI_MAX_TOKENS,
}

/**
 * OpenAI-compatible 运行时设置
 * 可持久化字段与敏感 API Key 通过结构隔离避免序列化泄漏
 */
export const useAISettingsStore = create<AISettingsStoreState>()((set) => ({
    persistedSettings: { ...defaultPersistedOpenAISettings },
    apiKey: "",

    hydratePersistedSettings: (settings) => {
        set({ persistedSettings: { ...settings } })
    },

    updatePersistedSettings: (settings) => {
        set((state) => ({
            persistedSettings: {
                ...state.persistedSettings,
                ...settings,
            },
        }))
    },

    setAPIKey: (apiKey) => {
        set({ apiKey })
    },
}))
