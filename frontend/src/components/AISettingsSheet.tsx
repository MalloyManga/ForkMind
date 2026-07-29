import { useEffect, useState, type FormEvent } from "react"
import { KeyRound, ServerCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useAISettingsStore } from "../stores/useAISettingsStore"

interface AISettingsSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

interface AISettingsDraft {
    baseUrl: string
    model: string
    apiKey: string
}

/**
 * OpenAI-compatible 连接设置弹窗
 * @param open 入参来自 App 页面状态 用于控制居中 Dialog 显示
 * @param onOpenChange 入参由 Radix Dialog 关闭动作触发 用于同步 App 页面状态
 * @returns 返回 Base URL Model 与 API Key 表单 API Key 不进入工作区 JSON
 * 用户点击左栏 AI Connection 时打开 系统提示词和生成参数由 Go 运行时统一管理
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
        })
        setValidationError(null)
    }, [apiKey, open, persistedSettings])

    /**
     * 校验并保存设置草稿
     * @param event 入参来自 Dialog 表单 submit 用于阻止浏览器默认刷新
     * @returns 无返回值 校验失败时保持 Dialog 打开并显示 Base URL 规则
     * 用户点击保存或在字段内提交表单时触发
     */
    const saveSettings = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        const normalizedBaseUrl = draft.baseUrl.trim()
        const normalizedModel = draft.model.trim()

        if (!normalizedBaseUrl || !normalizedModel) {
            setValidationError("Base URL 和模型名称不能为空")
            return
        }

        updatePersistedSettings({
            baseUrl: normalizedBaseUrl,
            model: normalizedModel,
        })
        setAPIKey(draft.apiKey)
        setValidationError(null)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader className="border-b border-border/70 px-5 py-4">
                    <div className="flex items-center gap-3 pr-8">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-[0_5px_16px_-5px_rgba(56,189,248,0.7)]">
                            <ServerCog className="h-4 w-4" />
                        </span>
                        <div>
                            <DialogTitle>AI Connection</DialogTitle>
                            <DialogDescription className="mt-0.5 text-xs">
                                OpenAI-compatible connection
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <form onSubmit={saveSettings}>
                    <div className="space-y-5 px-5 py-5">
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

                        <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/35 p-3">
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
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                仅保存在当前运行时内存 关闭 ForkMind 后自动清除
                            </p>
                        </div>

                        {validationError ? (
                            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                {validationError}
                            </p>
                        ) : null}
                    </div>

                    <DialogFooter className="border-t border-border/70 px-5 py-4">
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
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
