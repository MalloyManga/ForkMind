import type { PersistedOpenAISettings } from "../../domain/workspace"

/**
 * OpenAI-compatible 设置 Store
 * persistedSettings 可以落盘 apiKey 只在当前运行时内存中存在
 */
export interface AISettingsStoreState {
    persistedSettings: PersistedOpenAISettings
    apiKey: string

    hydratePersistedSettings: (settings: PersistedOpenAISettings) => void
    updatePersistedSettings: (settings: Partial<PersistedOpenAISettings>) => void
    setAPIKey: (apiKey: string) => void
}
