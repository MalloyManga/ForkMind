import { create } from "zustand"
import {
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
    type PersistedOpenAISettings,
} from "../../domain/workspace"
import type { AISettingsStoreState } from "./contracts"

export const defaultPersistedOpenAISettings: PersistedOpenAISettings = {
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    model: DEFAULT_OPENAI_MODEL,
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
