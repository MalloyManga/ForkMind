import {
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type SyntheticEvent,
} from "react"
import {
    Check,
    FileText,
    GitFork,
    Globe2,
    ImageIcon,
    Link2,
    MessageSquareText,
    Paperclip,
    PenLine,
    Send,
    Sparkles,
    Square,
    SquareMousePointer,
    UserRound,
    Workflow,
    X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { assertNever } from "@/lib/utils"
import {
    CHAT_EDITOR_ESTIMATED_LINE_HEIGHT,
    CHAT_EDITOR_SECTION_CHROME_HEIGHT,
    CHAT_PROMPT_AUTO_MAX_RATIO,
    CHAT_PROMPT_MAX_RATIO,
    CHAT_PROMPT_MIN_RATIO,
} from "../constants/layout"
import type {
    ConversationCard,
    ConversationNodeStatus,
    ConversationTextAnchor,
    ConversationTextField,
    ManagedAssetReference,
} from "../domain/conversation/types"
import type { ManagedAssetKind } from "../bridge"
import { ManagedImagePreview } from "./ManagedImagePreview"
import type { PendingCanvasPlan } from "../domain/canvasPlan"

interface RightEditorSidebarProps {
    activeNode: ConversationCard | undefined
    onUpdateChatPrompt: (nodeId: string, value: string) => void
    onUpdateChatResponse: (nodeId: string, value: string) => void
    onUpdateNoteContent: (nodeId: string, value: string) => void
    onUpdateImageNode: (
        nodeId: string,
        update: Partial<{ asset: ManagedAssetReference | null; caption: string; altText: string }>,
    ) => void
    onUpdateLinkNode: (
        nodeId: string,
        update: Partial<{ url: string; title: string; description: string }>,
    ) => void
    onUpdateFileNode: (
        nodeId: string,
        update: Partial<{ asset: ManagedAssetReference | null; description: string }>,
    ) => void
    onSelectManagedAsset: (nodeId: string, kind: ManagedAssetKind) => void
    managedAssetErrorMessage: string | null
    onBeginTextEdit: (nodeId: string, field: ConversationTextField) => void
    onEndTextEdit: () => void
    activeAIRequestNodeId: string | null
    canStartAIRequest: boolean
    aiErrorMessage: string | null
    onStartAIRequest: (nodeId: string, allowWebSearch: boolean) => void
    onCancelAIRequest: (nodeId: string) => void
    onForkTextSelection: (anchor: ConversationTextAnchor) => void
    pendingCanvasPlan: PendingCanvasPlan | null
    onAcceptCanvasPlan: () => void
    onRejectCanvasPlan: () => void
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

function getNodePresentation(node: ConversationCard): {
    label: string
    icon: ReactNode
    accent: string
} {
    switch (node.cardType) {
        case "chat":
            return {
                label: "Chat node",
                icon: <MessageSquareText className="h-4 w-4" />,
                accent: "bg-sky-500/15 text-sky-600 theme-dark:text-sky-400",
            }
        case "note":
            return {
                label: "Note node",
                icon: <FileText className="h-4 w-4" />,
                accent: "bg-amber-400/20 text-amber-600 theme-dark:text-amber-400",
            }
        case "image":
            return {
                label: "Image node",
                icon: <ImageIcon className="h-4 w-4" />,
                accent: "bg-cyan-500/15 text-cyan-600 theme-dark:text-cyan-400",
            }
        case "link":
            return {
                label: "Link node",
                icon: <Link2 className="h-4 w-4" />,
                accent: "bg-emerald-500/15 text-emerald-600 theme-dark:text-emerald-400",
            }
        case "file":
            return {
                label: "File node",
                icon: <Paperclip className="h-4 w-4" />,
                accent: "bg-fuchsia-500/15 text-fuchsia-600 theme-dark:text-fuchsia-400",
            }
    }

    return assertNever(node)
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

/**
 * 估算右侧 Chat 编辑器中一个字段的内容高度
 * @param content 入参来自当前 Chat 节点的 Prompt 或 Response 文本
 * @returns 返回包含标题区域和文本行的估算高度 空内容仍保留一行输入空间
 * 当前节点内容变化且用户尚未手动拖动分隔条时用于自动分配上下区域
 */
function estimateChatEditorSectionHeight(content: string): number {
    const visualLineCount = content.trim().split(/\r?\n/).reduce((lineCount, line) => {
        const visualCharacterCount = Array.from(line).reduce(
            (characterCount, character) => characterCount + (character.charCodeAt(0) > 0xff ? 1 : 0.55),
            0,
        )
        return lineCount + Math.max(1, Math.ceil(visualCharacterCount / 36))
    }, 0)

    return CHAT_EDITOR_SECTION_CHROME_HEIGHT + visualLineCount * CHAT_EDITOR_ESTIMATED_LINE_HEIGHT
}

/**
 * 根据 Prompt 和 Response 的内容量计算右侧编辑器自动分区比例
 * @param userPrompt 入参来自当前 Chat 节点的用户输入
 * @param aiResponse 入参来自当前 Chat 节点的 AI 回答 包含流式追加中的中间状态
 * @returns 返回经过自动模式上下限约束的 Prompt 占比 短 Prompt 会把更多空间留给 Response
 * 切换 Chat 节点或内容变化时触发 手动拖动后的当前节点不会继续采用此结果
 */
function getAutoChatPromptRatio(userPrompt: string, aiResponse: string): number {
    const promptHeight = estimateChatEditorSectionHeight(userPrompt)
    const responseHeight = estimateChatEditorSectionHeight(aiResponse)

    return clamp(
        promptHeight / (promptHeight + responseHeight),
        CHAT_PROMPT_MIN_RATIO,
        CHAT_PROMPT_AUTO_MAX_RATIO,
    )
}

function formatAssetSize(sizeBytes: number): string {
    if (sizeBytes < 1024) {
        return `${sizeBytes} B`
    }
    if (sizeBytes < 1024 * 1024) {
        return `${(sizeBytes / 1024).toFixed(1)} KB`
    }
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
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
    onUpdateImageNode,
    onUpdateLinkNode,
    onUpdateFileNode,
    onSelectManagedAsset,
    managedAssetErrorMessage,
    onBeginTextEdit,
    onEndTextEdit,
    activeAIRequestNodeId,
    canStartAIRequest,
    aiErrorMessage,
    onStartAIRequest,
    onCancelAIRequest,
    onForkTextSelection,
    pendingCanvasPlan,
    onAcceptCanvasPlan,
    onRejectCanvasPlan,
}: RightEditorSidebarProps) {
    const [manualChatPromptRatio, setManualChatPromptRatio] = useState<number | null>(null)
    const [allowWebSearch, setAllowWebSearch] = useState(false)
    const chatEditorContainerRef = useRef<HTMLDivElement | null>(null)
    const chatResizeStateRef = useRef<ChatEditorResizeState | null>(null)
    const [textSelection, setTextSelection] = useState<ConversationTextAnchor | null>(null)
    const pendingPlanRelationCount = pendingCanvasPlan
        ? pendingCanvasPlan.plan.nodes.reduce(
            (relationCount, node) => relationCount + (node.parentTempId ? 1 : 0) + node.referenceTempIds.length,
            0,
        )
        : 0

    useEffect(() => {
        setTextSelection(null)
        setManualChatPromptRatio(null)
        setAllowWebSearch(false)
    }, [activeNode?.id])

    const chatPromptRatio = activeNode?.cardType === "chat"
        ? manualChatPromptRatio ?? getAutoChatPromptRatio(activeNode.userPrompt, activeNode.aiResponse)
        : CHAT_PROMPT_MIN_RATIO

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

            setManualChatPromptRatio(nextPromptRatio)
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
        event.currentTarget.setPointerCapture(event.pointerId)

        chatResizeStateRef.current = {
            startY: event.clientY,
            startPromptRatio: chatPromptRatio,
        }

        document.body.style.cursor = "row-resize"
        document.body.style.userSelect = "none"
    }

    const status = activeNode ? STATUS_META[activeNode.status] : null
    const nodePresentation = activeNode ? getNodePresentation(activeNode) : null
    const isActiveNodeStreaming =
        activeNode?.cardType === "chat" && activeAIRequestNodeId === activeNode.id

    /**
     * 从右侧 textarea 捕获精确字符选区
     * @param event 入参来自 textarea 原生 select 事件
     * @param nodeId 入参是当前右侧编辑节点 id
     * @param field 入参表示选区属于 Prompt Response 或 Note
     * @returns 无返回值 有效选区写入局部动作态 空选区会清除旧动作
     * 用户拖选或使用键盘扩展选区时触发
     */
    const captureTextareaSelection = (
        event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
        nodeId: string,
        field: ConversationTextField,
    ) => {
        const textarea = event.currentTarget
        const startOffset = textarea.selectionStart ?? 0
        const endOffset = textarea.selectionEnd ?? startOffset
        if (endOffset <= startOffset) {
            setTextSelection((currentSelection) =>
                currentSelection?.sourceNodeId === nodeId && currentSelection.field === field
                    ? null
                    : currentSelection,
            )
            return
        }

        const quote = textarea.value.slice(startOffset, endOffset).trim()
        if (!quote) {
            setTextSelection(null)
            return
        }

        setTextSelection({
            sourceNodeId: nodeId,
            field,
            quote,
            startOffset,
            endOffset,
            origin: "editor",
        })
    }

    const renderForkSelectionButton = (field: ConversationTextField) => {
        if (!textSelection || textSelection.field !== field) {
            return null
        }

        return (
            <Button
                type="button"
                size="xs"
                variant="ghost"
                title="基于当前选区创建追问"
                onPointerDown={(event) => {
                    // 保持 textarea 选区直到 click 完成
                    event.preventDefault()
                }}
                onClick={() => {
                    onForkTextSelection(textSelection)
                    setTextSelection(null)
                }}
            >
                <GitFork className="h-3 w-3" />
                追问选区
            </Button>
        )
    }

    const activeEditorContent = (() => {
        if (!activeNode) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/60 px-6 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-muted/80 to-muted/40 text-muted-foreground/40">
                        <SquareMousePointer className="h-7 w-7" strokeWidth={1.6} />
                    </div>
                    <div className="space-y-1.5">
                        <p className="text-sm font-medium text-foreground/70">选中一张卡片开始编辑</p>
                        <p className="text-xs leading-relaxed text-muted-foreground/50">
                            在画布中点选节点 即可在此编辑内容
                        </p>
                    </div>
                </div>
            )
        }

        switch (activeNode.cardType) {
            case "chat":
                return (
                    <div ref={chatEditorContainerRef} className="flex h-full min-h-0 flex-col">
                        {activeNode.sourceAnchor ? (
                            <div className="mb-2 shrink-0 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2">
                                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-600 theme-dark:text-sky-400">
                                    <GitFork className="h-3 w-3" />
                                    Anchored from {activeNode.sourceAnchor.field}
                                </div>
                                <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-foreground/70">
                                    {activeNode.sourceAnchor.quote}
                                </p>
                            </div>
                        ) : null}
                        <section
                            className="flex min-h-0 shrink-0 flex-col"
                            style={{ flexBasis: `${chatPromptRatio * 100}%` }}
                        >
                            <SectionLabel
                                icon={<UserRound className="h-3 w-3" />}
                                title="Prompt"
                                accent="bg-sky-500/15 text-sky-600 theme-dark:text-sky-400"
                                action={renderForkSelectionButton("userPrompt")}
                            />
                            <Textarea
                                className="h-full min-h-0 w-full resize-none rounded-xl border-border/70 bg-card/80 text-sm leading-relaxed shadow-inner focus-visible:ring-sky-500/40"
                                placeholder="用户 Prompt（支持 Markdown / LaTeX）"
                                value={activeNode.userPrompt}
                                disabled={isActiveNodeStreaming}
                                onFocus={() => onBeginTextEdit(activeNode.id, "userPrompt")}
                                onBlur={onEndTextEdit}
                                onChange={(event) => onUpdateChatPrompt(activeNode.id, event.target.value)}
                                onSelect={(event) => captureTextareaSelection(event, activeNode.id, "userPrompt")}
                            />
                        </section>

                        <div
                            className="group flex h-4 shrink-0 touch-none cursor-row-resize items-center justify-center"
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
                                action={(
                                    <div className="flex items-center gap-1">
                                        {renderForkSelectionButton("aiResponse")}
                                        {isActiveNodeStreaming ? (
                                            <Button type="button" size="xs" variant="destructive" onClick={() => onCancelAIRequest(activeNode.id)}>
                                                <Square className="h-3 w-3 fill-current" />
                                                Stop
                                            </Button>
                                        ) : (
                                            <>
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="ghost"
                                                    className={cn(
                                                        allowWebSearch
                                                            ? "cursor-pointer bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-300 hover:bg-sky-200 theme-dark:bg-sky-500/20 theme-dark:text-sky-300 theme-dark:ring-sky-400/40 theme-dark:hover:bg-sky-500/30"
                                                            : "cursor-pointer text-muted-foreground",
                                                    )}
                                                    aria-pressed={allowWebSearch}
                                                    aria-label={allowWebSearch ? "关闭本轮联网" : "允许本轮联网"}
                                                    title="仅允许本轮请求使用 Provider 原生联网能力 是否支持由当前模型与服务决定"
                                                    onClick={() => setAllowWebSearch((currentValue) => !currentValue)}
                                                >
                                                    <Globe2 className="h-3 w-3" />
                                                    联网
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="xs"
                                                    variant="secondary"
                                                    disabled={!canStartAIRequest}
                                                    onClick={() => {
                                                        onStartAIRequest(activeNode.id, allowWebSearch)
                                                        // 联网权限只作用于当前一次发送 下一轮需要用户再次明确开启
                                                        setAllowWebSearch(false)
                                                    }}
                                                >
                                                    <Send className="h-3 w-3" />
                                                    {activeNode.aiResponse.trim().length > 0 ? "Regenerate" : "Send"}
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                )}
                            />
                            <Textarea
                                className="h-full min-h-0 w-full resize-none rounded-xl border-border/70 bg-card/80 text-sm leading-relaxed shadow-inner focus-visible:ring-violet-500/40"
                                placeholder="AI Response（支持 Markdown / LaTeX）"
                                value={activeNode.aiResponse}
                                disabled={isActiveNodeStreaming}
                                onFocus={() => onBeginTextEdit(activeNode.id, "aiResponse")}
                                onBlur={onEndTextEdit}
                                onChange={(event) => onUpdateChatResponse(activeNode.id, event.target.value)}
                                onSelect={(event) => captureTextareaSelection(event, activeNode.id, "aiResponse")}
                            />
                            {aiErrorMessage ? (
                                <p role="alert" className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
                                    {aiErrorMessage}
                                </p>
                            ) : null}
                        </section>
                    </div>
                )
            case "note":
                return (
                    <div className="flex h-full min-h-0 flex-col">
                        <SectionLabel
                            icon={<FileText className="h-3 w-3" />}
                            title="Note"
                            accent="bg-amber-400/20 text-amber-600 theme-dark:text-amber-400"
                            action={renderForkSelectionButton("noteContent")}
                        />
                        <Textarea
                            className="h-full min-h-0 flex-1 resize-none rounded-xl border-border/70 bg-card/80 text-sm leading-relaxed shadow-inner focus-visible:ring-amber-400/40"
                            placeholder="Markdown 笔记"
                            value={activeNode.noteContent}
                            onFocus={() => onBeginTextEdit(activeNode.id, "noteContent")}
                            onBlur={onEndTextEdit}
                            onChange={(event) => onUpdateNoteContent(activeNode.id, event.target.value)}
                            onSelect={(event) => captureTextareaSelection(event, activeNode.id, "noteContent")}
                        />
                    </div>
                )
            case "image":
                return (
                    <div className="flex h-full min-h-0 flex-col gap-3">
                        <SectionLabel
                            icon={<ImageIcon className="h-3 w-3" />}
                            title="Local Image"
                            accent="bg-cyan-500/15 text-cyan-600 theme-dark:text-cyan-400"
                            action={(
                                <Button type="button" size="xs" variant="secondary" onClick={() => onSelectManagedAsset(activeNode.id, "image")}>
                                    选择图片
                                </Button>
                            )}
                        />
                        <div className="h-40 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-card/80">
                            <ManagedImagePreview assetId={activeNode.asset?.id ?? ""} altText={activeNode.altText} />
                        </div>
                        {activeNode.asset ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                                {activeNode.asset.name} · {formatAssetSize(activeNode.asset.sizeBytes)}
                            </p>
                        ) : null}
                        <SectionLabel
                            icon={<ImageIcon className="h-3 w-3" />}
                            title="Alt Text"
                            accent="bg-cyan-500/15 text-cyan-600 theme-dark:text-cyan-400"
                            action={renderForkSelectionButton("altText")}
                        />
                        <Input
                            value={activeNode.altText}
                            placeholder="图片替代文本"
                            onFocus={() => onBeginTextEdit(activeNode.id, "altText")}
                            onBlur={onEndTextEdit}
                            onChange={(event) => onUpdateImageNode(activeNode.id, { altText: event.target.value })}
                            onSelect={(event) => captureTextareaSelection(event, activeNode.id, "altText")}
                        />
                        <SectionLabel
                            icon={<PenLine className="h-3 w-3" />}
                            title="Caption"
                            accent="bg-cyan-500/15 text-cyan-600 theme-dark:text-cyan-400"
                            action={renderForkSelectionButton("caption")}
                        />
                        <Textarea
                            className="min-h-0 flex-1 resize-none"
                            value={activeNode.caption}
                            placeholder="图片说明 只以文本元数据提供给 AI"
                            onFocus={() => onBeginTextEdit(activeNode.id, "caption")}
                            onBlur={onEndTextEdit}
                            onChange={(event) => onUpdateImageNode(activeNode.id, { caption: event.target.value })}
                            onSelect={(event) => captureTextareaSelection(event, activeNode.id, "caption")}
                        />
                        {managedAssetErrorMessage ? <p role="alert" className="text-xs text-destructive">{managedAssetErrorMessage}</p> : null}
                    </div>
                )
            case "link":
                return (
                    <div className="flex h-full min-h-0 flex-col gap-3">
                        <SectionLabel icon={<Link2 className="h-3 w-3" />} title="URL" accent="bg-emerald-500/15 text-emerald-600 theme-dark:text-emerald-400" action={renderForkSelectionButton("url")} />
                        <Input
                            value={activeNode.url}
                            placeholder="https://example.com"
                            onFocus={() => onBeginTextEdit(activeNode.id, "url")}
                            onBlur={onEndTextEdit}
                            onChange={(event) => onUpdateLinkNode(activeNode.id, { url: event.target.value })}
                            onSelect={(event) => captureTextareaSelection(event, activeNode.id, "url")}
                        />
                        <SectionLabel icon={<PenLine className="h-3 w-3" />} title="Title" accent="bg-emerald-500/15 text-emerald-600 theme-dark:text-emerald-400" action={renderForkSelectionButton("title")} />
                        <Input
                            value={activeNode.title}
                            placeholder="链接标题"
                            onFocus={() => onBeginTextEdit(activeNode.id, "title")}
                            onBlur={onEndTextEdit}
                            onChange={(event) => onUpdateLinkNode(activeNode.id, { title: event.target.value })}
                            onSelect={(event) => captureTextareaSelection(event, activeNode.id, "title")}
                        />
                        <SectionLabel icon={<FileText className="h-3 w-3" />} title="Description" accent="bg-emerald-500/15 text-emerald-600 theme-dark:text-emerald-400" action={renderForkSelectionButton("description")} />
                        <Textarea
                            className="min-h-0 flex-1 resize-none"
                            value={activeNode.description}
                            placeholder="链接说明 不会联网抓取页面"
                            onFocus={() => onBeginTextEdit(activeNode.id, "description")}
                            onBlur={onEndTextEdit}
                            onChange={(event) => onUpdateLinkNode(activeNode.id, { description: event.target.value })}
                            onSelect={(event) => captureTextareaSelection(event, activeNode.id, "description")}
                        />
                    </div>
                )
            case "file":
                return (
                    <div className="flex h-full min-h-0 flex-col gap-3">
                        <SectionLabel
                            icon={<Paperclip className="h-3 w-3" />}
                            title="Local File"
                            accent="bg-fuchsia-500/15 text-fuchsia-600 theme-dark:text-fuchsia-400"
                            action={(
                                <Button type="button" size="xs" variant="secondary" onClick={() => onSelectManagedAsset(activeNode.id, "file")}>
                                    选择文件
                                </Button>
                            )}
                        />
                        <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                            <div className="flex items-center gap-3">
                                <Paperclip className="h-5 w-5 text-fuchsia-500" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{activeNode.asset?.name ?? "尚未选择本地文件"}</p>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                        {activeNode.asset ? `${activeNode.asset.mimeType} · ${formatAssetSize(activeNode.asset.sizeBytes)}` : "最大 64 MB"}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <SectionLabel icon={<FileText className="h-3 w-3" />} title="Description" accent="bg-fuchsia-500/15 text-fuchsia-600 theme-dark:text-fuchsia-400" action={renderForkSelectionButton("description")} />
                        <Textarea
                            className="min-h-0 flex-1 resize-none"
                            value={activeNode.description}
                            placeholder="文件说明 AI 只会接收这些文本元数据"
                            onFocus={() => onBeginTextEdit(activeNode.id, "description")}
                            onBlur={onEndTextEdit}
                            onChange={(event) => onUpdateFileNode(activeNode.id, { description: event.target.value })}
                            onSelect={(event) => captureTextareaSelection(event, activeNode.id, "description")}
                        />
                        {managedAssetErrorMessage ? <p role="alert" className="text-xs text-destructive">{managedAssetErrorMessage}</p> : null}
                    </div>
                )
        }

        return assertNever(activeNode)
    })()

    return (
        <aside className="flex h-full flex-col bg-background/95 backdrop-blur-sm">
            {/* 头部：节点身份 + 状态 */}
            <header className="flex h-14 shrink-0 items-center gap-2.5 px-4">
                {activeNode ? (
                    <>
                        <span
                            className={cn("flex h-7 w-7 items-center justify-center rounded-lg", nodePresentation?.accent)}
                        >
                            {nodePresentation?.icon}
                        </span>
                        <div className="min-w-0 flex-1 leading-none">
                            <div className="text-sm font-semibold capitalize tracking-tight">
                                {nodePresentation?.label}
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

            {pendingCanvasPlan ? (
                <section
                    className="border-b border-border/70 bg-muted/35 px-4 py-3"
                    aria-live="polite"
                    aria-label="AI 画布提案"
                >
                    <div className="flex items-start gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 theme-dark:text-sky-400">
                            <Workflow className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-foreground">Canvas proposal ready</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                {pendingCanvasPlan.plan.nodes.length} cards · {pendingPlanRelationCount} relations
                            </p>
                        </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={onRejectCanvasPlan}>
                            <X data-icon="inline-start" />
                            Reject
                        </Button>
                        <Button type="button" size="sm" onClick={onAcceptCanvasPlan}>
                            <Check data-icon="inline-start" />
                            Accept
                        </Button>
                    </div>
                </section>
            ) : null}

            {/* 正文编辑区 */}
            <div className="min-h-0 flex-1 p-3">
                {activeEditorContent}
            </div>
        </aside>
    )
}
