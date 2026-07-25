import { useEffect, useState, type FormEvent } from "react"
import { KeyRound, ServerCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useAISettingsStore } from "../stores/useAISettingsStore"

interface AISettingsSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

interface AISettingsDraft {
    baseUrl: string
    model: string
    apiKey: string
    systemPrompt: string
    temperature: string
    maxTokens: string
}

/**
 * OpenAI-compatible 连接设置面板
 * @param open 入参来自 App 页面状态 用于控制 Sheet 显示
 * @param onOpenChange 入参由 Radix Sheet 关闭动作触发 用于同步 App 页面状态
 * @returns 返回右侧设置 Sheet API Key 只写入运行时 Store 不进入工作区 JSON
 * 用户点击左栏 Settings 时打开 保存后由持久化 Hook 自动落盘非敏感字段
 */
export function AISettingsSheet({ open, onOpenChange }: AISettingsSheetProps) {
    const persistedSettings = useAISettingsStore((state) => state.persistedSettings)
    const apiKey = useAISettingsStore((state) => state.apiKey)
    const updatePersistedSettings = useAISettingsStore((state) => state.updatePersistedSettings)
    const setAPIKey = useAISettingsStore((state) => state.setAPIKey)
    const [draft, setDraft] = useState<AISettingsDraft>(() => ({
        baseUrl: persistedSettings.baseUrl,
        model: persistedSettings.model,
        apiKey,
        systemPrompt: persistedSettings.systemPrompt,
        temperature: String(persistedSettings.temperature),
        maxTokens: String(persistedSettings.maxTokens),
    }))
    const [validationError, setValidationError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) {
            return
        }

        setDraft({
            baseUrl: persistedSettings.baseUrl,
            model: persistedSettings.model,
            apiKey,
            systemPrompt: persistedSettings.systemPrompt,
            temperature: String(persistedSettings.temperature),
            maxTokens: String(persistedSettings.maxTokens),
        })
        setValidationError(null)
    }, [apiKey, open, persistedSettings])

    /**
     * 校验并保存设置草稿
     * @param event 入参来自 Sheet 表单 submit 用于阻止浏览器默认刷新
     * @returns 无返回值 校验失败时保持 Sheet 打开并显示具体字段规则
     * 用户点击保存或在字段内提交表单时触发
     */
    const saveSettings = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        const normalizedBaseUrl = draft.baseUrl.trim()
        const normalizedModel = draft.model.trim()
        const temperature = Number(draft.temperature)
        const maxTokens = Number(draft.maxTokens)

        if (!normalizedBaseUrl || !normalizedModel) {
            setValidationError("Base URL 和模型名称不能为空")
            return
        }
        if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
            setValidationError("Temperature 必须是 0 到 2 之间的数字")
            return
        }
        if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
            setValidationError("Max Tokens 必须是正整数")
            return
        }

        updatePersistedSettings({
            baseUrl: normalizedBaseUrl,
            model: normalizedModel,
            systemPrompt: draft.systemPrompt,
            temperature,
            maxTokens,
        })
        setAPIKey(draft.apiKey)
        setValidationError(null)
        onOpenChange(false)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-[min(92vw,420px)] sm:max-w-[420px]">
                <SheetHeader className="border-b border-border/70 px-5 py-4">
                    <div className="flex items-center gap-3 pr-8">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-[0_5px_16px_-5px_rgba(56,189,248,0.7)]">
                            <ServerCog className="h-4 w-4" />
                        </span>
                        <div>
                            <SheetTitle>AI Connection</SheetTitle>
                            <SheetDescription className="mt-0.5 text-xs">
                                OpenAI-compatible /chat/completions
                            </SheetDescription>
                        </div>
                    </div>
                </SheetHeader>

                <form className="flex min-h-0 flex-1 flex-col" onSubmit={saveSettings}>
                    <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                        <div className="space-y-1.5">
                            <label htmlFor="ai-base-url" className="text-xs font-medium text-foreground">
                                Base URL
                            </label>
                            <Input
                                id="ai-base-url"
                                value={draft.baseUrl}
                                onChange={(event) => {
                                    setDraft((currentDraft) => ({
                                        ...currentDraft,
                                        baseUrl: event.target.value,
                                    }))
                                }}
                                placeholder="http://localhost:11434/v1"
                                spellCheck={false}
                            />
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                可填写 Ollama 或任意兼容服务地址 路径会自动补全
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <label htmlFor="ai-model" className="text-xs font-medium text-foreground">
                                Model
                            </label>
                            <Input
                                id="ai-model"
                                value={draft.model}
                                onChange={(event) => {
                                    setDraft((currentDraft) => ({
                                        ...currentDraft,
                                        model: event.target.value,
                                    }))
                                }}
                                placeholder="例如 qwen3:8b"
                                spellCheck={false}
                            />
                        </div>

                        <div className="space-y-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                            <label htmlFor="ai-api-key" className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                <KeyRound className="h-3.5 w-3.5 text-amber-500" />
                                API Key
                            </label>
                            <Input
                                id="ai-api-key"
                                type="password"
                                value={draft.apiKey}
                                onChange={(event) => {
                                    setDraft((currentDraft) => ({
                                        ...currentDraft,
                                        apiKey: event.target.value,
                                    }))
                                }}
                                placeholder="本地 Ollama 通常留空"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <p className="text-[11px] leading-relaxed text-amber-700 theme-dark:text-amber-300/80">
                                仅保存在当前运行时内存 关闭 ForkMind 后自动清除
                            </p>
                        </div>

                        <div className="space-y-1.5">
                            <label htmlFor="ai-system-prompt" className="text-xs font-medium text-foreground">
                                System Prompt
                            </label>
                            <Textarea
                                id="ai-system-prompt"
                                value={draft.systemPrompt}
                                onChange={(event) => {
                                    setDraft((currentDraft) => ({
                                        ...currentDraft,
                                        systemPrompt: event.target.value,
                                    }))
                                }}
                                className="min-h-28 resize-y text-xs leading-relaxed"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label htmlFor="ai-temperature" className="text-xs font-medium text-foreground">
                                    Temperature
                                </label>
                                <Input
                                    id="ai-temperature"
                                    type="number"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value={draft.temperature}
                                    onChange={(event) => {
                                        setDraft((currentDraft) => ({
                                            ...currentDraft,
                                            temperature: event.target.value,
                                        }))
                                    }}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="ai-max-tokens" className="text-xs font-medium text-foreground">
                                    Max Tokens
                                </label>
                                <Input
                                    id="ai-max-tokens"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={draft.maxTokens}
                                    onChange={(event) => {
                                        setDraft((currentDraft) => ({
                                            ...currentDraft,
                                            maxTokens: event.target.value,
                                        }))
                                    }}
                                />
                            </div>
                        </div>

                        {validationError ? (
                            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                {validationError}
                            </p>
                        ) : null}
                    </div>

                    <SheetFooter className="border-t border-border/70 px-5 py-4 sm:flex-row sm:justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                onOpenChange(false)
                            }}
                        >
                            取消
                        </Button>
                        <Button type="submit">保存设置</Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    )
}
