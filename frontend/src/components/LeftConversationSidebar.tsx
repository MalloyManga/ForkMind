import { PanelsToggleIcon } from "./icons/PanelsToggleIcon"

interface LeftConversationSidebarProps {
    threadTitle: string
    cardCount: number
    rootNodeCount: number
    themeMode: "dark" | "light"
    onTogglePanels: () => void
    onToggleTheme: () => void
}

/**
 * 左侧会话栏。
 * 业务场景：阶段三先承载当前会话概览与主题切换，后续阶段再接入完整的多会话列表。
 */
export function LeftConversationSidebar({
    threadTitle,
    cardCount,
    rootNodeCount,
    themeMode,
    onTogglePanels,
    onToggleTheme,
}: LeftConversationSidebarProps) {
    return (
        <aside className="h-full border-r bg-background">
            <div className="flex h-full flex-col p-4">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Conversations
                    </h2>
                    <button
                        type="button"
                        className="rounded-md p-1.5 text-foreground transition-colors hover:bg-accent"
                        onClick={onTogglePanels}
                        aria-label="隐藏界面栏"
                    >
                        <PanelsToggleIcon className="h-4 w-4" />
                    </button>
                </div>

                <div className="rounded-xl border bg-card p-3">
                    <div className="text-sm font-semibold text-card-foreground">{threadTitle}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                        卡片：{cardCount} · 根节点：{rootNodeCount}
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                        当前阶段先保留单会话壳层，后续阶段再接入完整会话列表与本地持久化。
                    </div>
                </div>

                <div className="mt-3 rounded-xl border bg-card p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Theme
                    </div>
                    <button
                        type="button"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                        onClick={onToggleTheme}
                    >
                        当前模式：{themeMode === "dark" ? "Dark" : "Light"}（点击切换）
                    </button>
                </div>
            </div>
        </aside>
    )
}
