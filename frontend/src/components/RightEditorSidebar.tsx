import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Textarea } from "@/components/ui/textarea"
import {
    CHAT_PROMPT_MAX_RATIO,
    CHAT_PROMPT_MIN_RATIO,
    DEFAULT_CHAT_PROMPT_RATIO,
} from "../constants/layout"
import type { ConversationCard } from "../domain/conversation/types"

interface RightEditorSidebarProps {
    activeNode: ConversationCard | undefined
    onUpdateChatPrompt: (nodeId: string, value: string) => void
    onUpdateChatResponse: (nodeId: string, value: string) => void
    onUpdateNoteContent: (nodeId: string, value: string) => void
}

interface ChatEditorResizeState {
    startY: number
    startPromptRatio: number
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

/**
 * 右侧编辑栏。
 */
export function RightEditorSidebar({
    activeNode,
    onUpdateChatPrompt,
    onUpdateChatResponse,
    onUpdateNoteContent,
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

    return (
        <aside className="h-full border-l bg-background">
            <div className="flex h-full flex-col p-4">
                {!activeNode ? (
                    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-sm text-muted-foreground">
                        选中画布卡片后，可在这里直接编辑 Markdown 内容。
                    </div>
                ) : activeNode.type === "chat" ? (
                    <div ref={chatEditorContainerRef} className="flex h-full min-h-0 flex-col">
                        <div
                            className="min-h-0 shrink-0"
                            style={{
                                flexBasis: `${chatPromptRatio * 100}%`,
                            }}
                        >
                            <Textarea
                                className="h-full min-h-0 w-full resize-none rounded-xl bg-card"
                                placeholder="用户 Prompt（Markdown）"
                                value={activeNode.userPrompt}
                                onChange={(event) => {
                                    onUpdateChatPrompt(activeNode.id, event.target.value)
                                }}
                            />
                        </div>

                        <div
                            className="my-2 h-1.5 shrink-0 cursor-row-resize rounded-full bg-border/80 transition-colors hover:bg-border"
                            onPointerDown={startResizeChatEditors}
                            role="separator"
                            aria-label="调整 Prompt 与 AI Response 区域高度"
                        />

                        <div className="min-h-0 flex-1">
                            <Textarea
                                className="h-full min-h-0 w-full resize-none rounded-xl bg-card"
                                placeholder="AI Response（Markdown）"
                                value={activeNode.aiResponse}
                                onChange={(event) => {
                                    onUpdateChatResponse(activeNode.id, event.target.value)
                                }}
                            />
                        </div>
                    </div>
                ) : (
                    <Textarea
                        className="h-full min-h-0 flex-1 resize-none rounded-xl bg-card"
                        placeholder="Markdown 笔记"
                        value={activeNode.noteContent}
                        onChange={(event) => {
                            onUpdateNoteContent(activeNode.id, event.target.value)
                        }}
                    />
                )}
            </div>
        </aside>
    )
}
