import {
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react"
import {
    FileText,
    MessageSquareText,
    PenLine,
    Send,
    Sparkles,
    Square,
    SquareMousePointer,
    UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
    CHAT_PROMPT_MAX_RATIO,
    CHAT_PROMPT_MIN_RATIO,
    DEFAULT_CHAT_PROMPT_RATIO,
} from "../constants/layout"
import type { ConversationCard, ConversationNodeStatus } from "../domain/conversation/types"
import type { ConversationTextField } from "../stores/conversationStore"

interface RightEditorSidebarProps {
    activeNode: ConversationCard | undefined
    onUpdateChatPrompt: (nodeId: string, value: string) => void
    onUpdateChatResponse: (nodeId: string, value: string) => void
    onUpdateNoteContent: (nodeId: string, value: string) => void
    onBeginTextEdit: (nodeId: string, field: ConversationTextField) => void
    onEndTextEdit: () => void
    activeAIRequestNodeId: string | null
    canStartAIRequest: boolean
    aiErrorMessage: string | null
    onStartAIRequest: (nodeId: string) => void
    onCancelAIRequest: (nodeId: string) => void
}

interface ChatEditorResizeState {
    startY: number
    startPromptRatio: number
}

const STATUS_META: Record<ConversationNodeStatus, { label: string; dot: string; text: string }> = {
    idle: { label: "Idle", dot: "bg-zinc-400", text: "text-muted-foreground" },
    streaming: { label: "Streaming", dot: "bg-sky-500", text: "text-sky-600 theme-dark:text-sky-400" },
    done: { label: "Done", dot: "bg-emerald-500", text: "text-emerald-600 theme-dark:text-emerald-400" },
    error: { label: "Error", dot: "bg-rose-500", text: "text-rose-600 theme-dark:text-rose-400" },
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

function SectionLabel({
    icon,
    title,
    accent,
    action,
}: {
    icon: ReactNode
    title: string
    accent: string
    action?: ReactNode
}) {
    return (
        <div className="mb-2 flex items-center gap-2 px-0.5">
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-md", accent)}>{icon}</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                {title}
            </span>
            {action ? <span className="ml-auto">{action}</span> : null}
        </div>
    )
}

/**
 * 右侧编辑栏：头部展示节点身份与状态，正文根据卡片类型渲染 Markdown 编辑区。
 */
export function RightEditorSidebar({
    activeNode,
    onUpdateChatPrompt,
    onUpdateChatResponse,
    onUpdateNoteContent,
    onBeginTextEdit,
    onEndTextEdit,
    activeAIRequestNodeId,
    canStartAIRequest,
    aiErrorMessage,
    onStartAIRequest,
    onCancelAIRequest,
}: RightEditorSidebarProps) {
    const [chatPromptRatio, setChatPromptRatio] = useState(DEFAULT_CHAT_PROMPT_RATIO)
    const chatEditorContainerRef = useRef<HTMLDivElement | null>(null)
    const chatResizeStateRef = useRef<ChatEditorResizeState | null>(null)

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const resizeState = chatResizeStateRef.current
            const chatEditorContainer = chatEditorContainerRef.current

            if (!resizeState || !chatEditorContainer) {
                return
            }

            const containerHeight = chatEditorContainer.getBoundingClientRect().height
            if (containerHeight <= 0) {
                return
            }

            const pointerDeltaY = event.clientY - resizeState.startY
            const nextPromptRatio = clamp(
                resizeState.startPromptRatio + pointerDeltaY / containerHeight,
                CHAT_PROMPT_MIN_RATIO,
                CHAT_PROMPT_MAX_RATIO,
            )

            setChatPromptRatio(nextPromptRatio)
        }

        const handlePointerUp = () => {
            if (!chatResizeStateRef.current) {
                return
            }

            chatResizeStateRef.current = null
            document.body.style.removeProperty("cursor")
            document.body.style.removeProperty("user-select")
        }

        window.addEventListener("pointermove", handlePointerMove, true)
        window.addEventListener("pointerup", handlePointerUp, true)

        return () => {
            window.removeEventListener("pointermove", handlePointerMove, true)
            window.removeEventListener("pointerup", handlePointerUp, true)
            document.body.style.removeProperty("cursor")
            document.body.style.removeProperty("user-select")
        }
    }, [])

    const startResizeChatEditors = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault()

        chatResizeStateRef.current = {
            startY: event.clientY,
            startPromptRatio: chatPromptRatio,
        }

        document.body.style.cursor = "row-resize"
        document.body.style.userSelect = "none"
    }

    const status = activeNode ? STATUS_META[activeNode.status] : null
    const isActiveNodeStreaming =
        activeNode?.cardType === "chat" && activeAIRequestNodeId === activeNode.id

    return (
        <aside className="flex h-full flex-col bg-background/95 backdrop-blur-sm">
            {/* 头部：节点身份 + 状态 */}
            <header className="flex h-14 shrink-0 items-center gap-2.5 px-4">
                {activeNode ? (
                    <>
                        <span
                            className={cn(
                                "flex h-7 w-7 items-center justify-center rounded-lg",
                                activeNode.cardType === "chat"
                                    ? "bg-sky-500/15 text-sky-600 theme-dark:text-sky-400"
                                    : "bg-amber-400/20 text-amber-600 theme-dark:text-amber-400",
                            )}
                        >
                            {activeNode.cardType === "chat" ? (
                                <MessageSquareText className="h-4 w-4" />
                            ) : (
                                <FileText className="h-4 w-4" />
                            )}
                        </span>
                        <div className="min-w-0 flex-1 leading-none">
                            <div className="text-sm font-semibold capitalize tracking-tight">
                                {activeNode.cardType === "chat" ? "Chat node" : "Note node"}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-muted-foreground/50">
                                #{activeNode.id.slice(-6)}
                            </div>
                        </div>
                        {status ? (
                            <span className="flex items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1">
                                <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                                <span className={cn("text-[10px] font-medium", status.text)}>{status.label}</span>
                            </span>
                        ) : null}
                    </>
                ) : (
                    <>
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground/60">
                            <PenLine className="h-4 w-4" />
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
                            Editor
                        </span>
                    </>
                )}
            </header>

            <div className="mx-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            {/* 正文编辑区 */}
            <div className="min-h-0 flex-1 p-3">
                {!activeNode ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/60 px-6 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-muted/80 to-muted/40 text-muted-foreground/40">
                            <SquareMousePointer className="h-7 w-7" strokeWidth={1.6} />
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-sm font-medium text-foreground/70">选中一张卡片开始编辑</p>
                            <p className="text-xs leading-relaxed text-muted-foreground/50">
                                在画布中点选节点，即可在此
                                <br />
                                编辑 Markdown 与 LaTeX 内容
                            </p>
                        </div>
                    </div>
                ) : activeNode.cardType === "chat" ? (
                    <div ref={chatEditorContainerRef} className="flex h-full min-h-0 flex-col">
                        <section
                            className="flex min-h-0 shrink-0 flex-col"
                            style={{ flexBasis: `${chatPromptRatio * 100}%` }}
                        >
                            <SectionLabel
                                icon={<UserRound className="h-3 w-3" />}
                                title="Prompt"
                                accent="bg-sky-500/15 text-sky-600 theme-dark:text-sky-400"
                            />
                            <Textarea
                                className="h-full min-h-0 w-full resize-none rounded-xl border-border/70 bg-card/80 text-sm leading-relaxed shadow-inner focus-visible:ring-sky-500/40"
                                placeholder="用户 Prompt（支持 Markdown / LaTeX）"
                                value={activeNode.userPrompt}
                                disabled={isActiveNodeStreaming}
                                onFocus={() => {
                                    onBeginTextEdit(activeNode.id, "userPrompt")
                                }}
                                onBlur={onEndTextEdit}
                                onChange={(event) => {
                                    onUpdateChatPrompt(activeNode.id, event.target.value)
                                }}
                            />
                        </section>

                        <div
                            className="group flex h-4 shrink-0 cursor-row-resize items-center justify-center"
                            onPointerDown={startResizeChatEditors}
                            role="separator"
                            aria-label="调整 Prompt 与 AI Response 区域高度"
                        >
                            <span className="h-1 w-10 rounded-full bg-border transition-all group-hover:w-16 group-hover:bg-sky-400/70" />
                        </div>

                        <section className="flex min-h-0 flex-1 flex-col">
                            <SectionLabel
                                icon={<Sparkles className="h-3 w-3" />}
                                title="AI Response"
                                accent="bg-violet-500/15 text-violet-600 theme-dark:text-violet-400"
                                action={isActiveNodeStreaming ? (
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="destructive"
                                        onClick={() => {
                                            onCancelAIRequest(activeNode.id)
                                        }}
                                    >
                                        <Square className="h-3 w-3 fill-current" />
                                        Stop
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="secondary"
                                        disabled={!canStartAIRequest}
                                        onClick={() => {
                                            onStartAIRequest(activeNode.id)
                                        }}
                                    >
                                        <Send className="h-3 w-3" />
                                        {activeNode.aiResponse.trim().length > 0 ? "Regenerate" : "Send"}
                                    </Button>
                                )}
                            />
                            <Textarea
                                className="h-full min-h-0 w-full resize-none rounded-xl border-border/70 bg-card/80 text-sm leading-relaxed shadow-inner focus-visible:ring-violet-500/40"
                                placeholder="AI Response（支持 Markdown / LaTeX）"
                                value={activeNode.aiResponse}
                                disabled={isActiveNodeStreaming}
                                onFocus={() => {
                                    onBeginTextEdit(activeNode.id, "aiResponse")
                                }}
                                onBlur={onEndTextEdit}
                                onChange={(event) => {
                                    onUpdateChatResponse(activeNode.id, event.target.value)
                                }}
                            />
                            {aiErrorMessage ? (
                                <p
                                    role="alert"
                                    className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] leading-relaxed text-destructive"
                                >
                                    {aiErrorMessage}
                                </p>
                            ) : null}
                        </section>
                    </div>
                ) : (
                    <div className="flex h-full min-h-0 flex-col">
                        <SectionLabel
                            icon={<FileText className="h-3 w-3" />}
                            title="Note"
                            accent="bg-amber-400/20 text-amber-600 theme-dark:text-amber-400"
                        />
                        <Textarea
                            className="h-full min-h-0 flex-1 resize-none rounded-xl border-border/70 bg-card/80 text-sm leading-relaxed shadow-inner focus-visible:ring-amber-400/40"
                            placeholder="Markdown 笔记"
                            value={activeNode.noteContent}
                            onFocus={() => {
                                onBeginTextEdit(activeNode.id, "noteContent")
                            }}
                            onBlur={onEndTextEdit}
                            onChange={(event) => {
                                onUpdateNoteContent(activeNode.id, event.target.value)
                            }}
                        />
                    </div>
                )}
            </div>
        </aside>
    )
}
