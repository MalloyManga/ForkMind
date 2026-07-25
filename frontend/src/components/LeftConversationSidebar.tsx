import type { ReactNode } from "react"
import { GitFork, Layers, Moon, Network, Sparkles, Sun } from "lucide-react"
import { cn } from "@/lib/utils"

interface LeftConversationSidebarProps {
    threadTitle: string
    cardCount: number
    rootNodeCount: number
    themeMode: "dark" | "light"
    panelsToggleControl: ReactNode
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
    themeMode,
    panelsToggleControl,
    onToggleTheme,
}: LeftConversationSidebarProps) {
    return (
        <aside className="flex h-full flex-col bg-background/95 backdrop-blur-sm">
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
                </div>

                <div className="mt-1 flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border/50 px-4 py-6 text-center">
                    <span className="text-[11px] font-medium text-muted-foreground/50">多会话与本地持久化</span>
                    <span className="text-[10px] text-muted-foreground/35">即将到来</span>
                </div>
            </div>

            {/* 主题切换 */}
            <div className="p-3">
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
