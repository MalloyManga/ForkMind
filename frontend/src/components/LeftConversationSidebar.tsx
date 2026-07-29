import { useState, type ReactNode } from "react"
import {
    Check,
    AlertCircle,
    Download,
    GitFork,
    HardDrive,
    Layers,
    Moon,
    Network,
    Pencil,
    Plus,
    Sparkles,
    Settings2,
    Sun,
    Trash2,
    Upload,
    X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import type { ConversationThread } from "../domain/conversation/types"
import type { WorkspacePersistenceStatus } from "../hooks/useWorkspacePersistence"

interface LeftConversationSidebarProps {
    threadTitle: string
    cardCount: number
    rootNodeCount: number
    rootNodeWarning: string | null
    threads: ConversationThread[]
    activeThreadId: string
    persistenceStatus: WorkspacePersistenceStatus
    persistenceErrorMessage: string | null
    isThreadManagementDisabled: boolean
    workspaceTransferMessage: string | null
    workspaceTransferErrorMessage: string | null
    isWorkspaceTransferBusy: boolean
    themeMode: "dark" | "light"
    panelsToggleControl: ReactNode
    onCreateThread: () => void
    onSwitchThread: (threadId: string) => void
    onRenameThread: (threadId: string, title: string) => void
    onDeleteThread: (threadId: string) => void
    onExportWorkspace: () => void
    onImportWorkspace: () => void
    onOpenAISettings: () => void
    onToggleTheme: () => void
}

interface StatChipProps {
    icon: ReactNode
    value: number
    label: string
}

function StatChip({ icon, value, label }: StatChipProps) {
    return (
        <div className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5">
            <span className="text-muted-foreground/70">{icon}</span>
            <span className="text-xs font-semibold tabular-nums text-foreground/90">{value}</span>
            <span className="text-[11px] text-muted-foreground/60">{label}</span>
        </div>
    )
}

/**
 * 左侧会话栏：品牌头部 + 当前会话概览 + 主题切换
 */
export function LeftConversationSidebar({
    threadTitle,
    cardCount,
    rootNodeCount,
    rootNodeWarning,
    threads,
    activeThreadId,
    persistenceStatus,
    persistenceErrorMessage,
    isThreadManagementDisabled,
    workspaceTransferMessage,
    workspaceTransferErrorMessage,
    isWorkspaceTransferBusy,
    themeMode,
    panelsToggleControl,
    onCreateThread,
    onSwitchThread,
    onRenameThread,
    onDeleteThread,
    onExportWorkspace,
    onImportWorkspace,
    onOpenAISettings,
    onToggleTheme,
}: LeftConversationSidebarProps) {
    const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
    const [editingTitle, setEditingTitle] = useState("")

    /**
     * 进入会话标题编辑态
     * @param thread 入参来自当前列表项 用于初始化编辑框与保存目标 id
     * 用户点击铅笔按钮时触发 不会切换当前画布会话
     */
    const beginThreadRename = (thread: ConversationThread) => {
        setEditingThreadId(thread.id)
        setEditingTitle(thread.title)
    }

    /**
     * 提交会话标题
     * 空标题的默认值由 Store 领域规则统一处理
     * 用户按 Enter 或点击确认按钮时触发
     */
    const commitThreadRename = () => {
        if (!editingThreadId) {
            return
        }

        onRenameThread(editingThreadId, editingTitle)
        setEditingThreadId(null)
        setEditingTitle("")
    }

    const cancelThreadRename = () => {
        setEditingThreadId(null)
        setEditingTitle("")
    }

    const persistenceLabel = (() => {
        switch (persistenceStatus) {
            case "loading":
                return "正在加载本地工作区"
            case "dirty":
                return "等待自动保存"
            case "saving":
                return "正在保存到本地"
            case "saved":
                return "已保存到本地"
            case "idle":
                return "本地工作区已就绪"
            case "unavailable":
                return "桌面 Bridge 未连接"
            case "error":
                return persistenceErrorMessage ?? "本地保存失败"
        }
    })()

    return (
        <aside className="flex h-full flex-col bg-background">
            {/* 品牌头部 */}
            <header className="flex h-14 shrink-0 items-center justify-between px-4">
                <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-[0_4px_12px_-2px_rgba(56,189,248,0.5)]">
                        <GitFork className="h-4 w-4" strokeWidth={2.4} />
                    </div>
                    <div className="leading-none">
                        <div className="text-sm font-semibold tracking-tight">ForkMind</div>
                        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/50">
                            Canvas
                        </div>
                    </div>
                </div>
                {panelsToggleControl}
            </header>

            <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            {/* 会话概览 */}
            <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-4">
                <div className="flex items-center gap-1.5 px-1">
                    <Sparkles className="h-3 w-3 text-muted-foreground/50" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
                        Active Thread
                    </span>
                </div>

                <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18)]">
                    <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-sky-400 via-indigo-400 to-transparent opacity-80" />
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-600 theme-dark:text-emerald-400">
                            Live
                        </span>
                    </div>
                    <h2 className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-card-foreground">
                        {threadTitle}
                    </h2>
                    <div className="mt-3.5 flex flex-wrap gap-2">
                        <StatChip icon={<Layers className="h-3 w-3" />} value={cardCount} label="cards" />
                        <StatChip icon={<Network className="h-3 w-3" />} value={rootNodeCount} label="roots" />
                    </div>
                    {rootNodeWarning ? (
                        <p className="mt-3 text-[10px] leading-relaxed text-amber-600 theme-dark:text-amber-400">
                            {rootNodeWarning}
                        </p>
                    ) : null}
                </div>

                <div className="mt-2 flex items-center justify-between px-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
                        Threads
                    </span>
                    <button
                        type="button"
                        onClick={onCreateThread}
                        disabled={isThreadManagementDisabled}
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="新建会话"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="space-y-1.5">
                    {threads.map((thread) => {
                        const isActive = thread.id === activeThreadId
                        const isEditing = thread.id === editingThreadId

                        return (
                            <div
                                key={thread.id}
                                className={cn(
                                    "group flex min-h-10 items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors",
                                    isActive
                                        ? "border-sky-400/40 bg-sky-500/10"
                                        : "border-transparent hover:border-border/70 hover:bg-accent/60",
                                )}
                            >
                                {isEditing ? (
                                    <Input
                                        autoFocus
                                        value={editingTitle}
                                        onChange={(event) => {
                                            setEditingTitle(event.target.value)
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                                commitThreadRename()
                                            }
                                            if (event.key === "Escape") {
                                                cancelThreadRename()
                                            }
                                        }}
                                        className="h-7 min-w-0 flex-1 text-xs"
                                        aria-label="会话标题"
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        disabled={isThreadManagementDisabled}
                                        className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
                                        onClick={() => {
                                            onSwitchThread(thread.id)
                                        }}
                                    >
                                        {thread.title}
                                    </button>
                                )}

                                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                    {isEditing ? (
                                        <>
                                            <button
                                                type="button"
                                                disabled={isThreadManagementDisabled}
                                                onClick={commitThreadRename}
                                                className="flex h-6 w-6 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-500/10"
                                                aria-label="保存会话标题"
                                            >
                                                <Check className="h-3 w-3" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isThreadManagementDisabled}
                                                onClick={cancelThreadRename}
                                                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                                                aria-label="取消重命名"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                disabled={isThreadManagementDisabled}
                                                onClick={() => {
                                                    beginThreadRename(thread)
                                                }}
                                                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label={`重命名 ${thread.title}`}
                                            >
                                                <Pencil className="h-3 w-3" />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isThreadManagementDisabled}
                                                onClick={() => {
                                                    onDeleteThread(thread.id)
                                                }}
                                                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label={`删除 ${thread.title}`}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* 主题切换 */}
            <div className="p-3">
                <div
                    className={cn(
                        "mb-2 flex items-center gap-2 px-2 text-[10px]",
                        persistenceStatus === "error"
                            ? "text-rose-500"
                            : "text-muted-foreground/60",
                    )}
                    title={persistenceErrorMessage ?? undefined}
                >
                    {persistenceStatus === "error" ? (
                        <AlertCircle className="h-3 w-3 shrink-0" />
                    ) : (
                        <HardDrive className="h-3 w-3 shrink-0" />
                    )}
                    <span className="truncate">{persistenceLabel}</span>
                </div>
                {workspaceTransferMessage || workspaceTransferErrorMessage ? (
                    <p
                        className={cn(
                            "mb-2 truncate px-2 text-[10px]",
                            workspaceTransferErrorMessage
                                ? "text-rose-500"
                                : "text-emerald-600 theme-dark:text-emerald-400",
                        )}
                        title={workspaceTransferErrorMessage ?? workspaceTransferMessage ?? undefined}
                    >
                        {workspaceTransferErrorMessage ?? workspaceTransferMessage}
                    </p>
                ) : null}
                <div className="mb-2 grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={onImportWorkspace}
                        disabled={isThreadManagementDisabled || isWorkspaceTransferBusy}
                        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card/50 px-2 py-2 text-[11px] font-medium text-foreground transition-colors duration-200 hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Upload className="h-3.5 w-3.5" />
                        Import
                    </button>
                    <button
                        type="button"
                        onClick={onExportWorkspace}
                        disabled={isThreadManagementDisabled || isWorkspaceTransferBusy}
                        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-card/50 px-2 py-2 text-[11px] font-medium text-foreground transition-colors duration-200 hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Download className="h-3.5 w-3.5" />
                        Export
                    </button>
                </div>
                <button
                    type="button"
                    onClick={onOpenAISettings}
                    className="group mb-2 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-left transition-colors duration-200 hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 theme-dark:text-sky-400">
                        <Settings2 className="h-4 w-4" />
                    </span>
                    <span className="flex-1">
                        <span className="block text-xs font-medium text-foreground">AI Connection</span>
                        <span className="block text-[10px] text-muted-foreground/60">Base URL 与运行时密钥</span>
                    </span>
                </button>
                <button
                    type="button"
                    onClick={onToggleTheme}
                    className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent"
                >
                    <span
                        className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                            themeMode === "dark"
                                ? "bg-indigo-500/15 text-indigo-400"
                                : "bg-amber-400/20 text-amber-500",
                        )}
                    >
                        {themeMode === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                    </span>
                    <span className="flex-1">
                        <span className="block text-xs font-medium text-foreground">
                            {themeMode === "dark" ? "Dark" : "Light"} mode
                        </span>
                        <span className="block text-[10px] text-muted-foreground/60">点击切换主题</span>
                    </span>
                </button>
            </div>
        </aside>
    )
}
