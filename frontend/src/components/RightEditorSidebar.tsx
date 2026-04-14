import { Textarea } from "@/components/ui/textarea"
import type { ConversationCard } from "../domain/conversation/types"

interface RightEditorSidebarProps {
    activeNode: ConversationCard | undefined
    onUpdateChatPrompt: (nodeId: string, value: string) => void
    onUpdateChatResponse: (nodeId: string, value: string) => void
    onUpdateNoteContent: (nodeId: string, value: string) => void
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
    return (
        <aside className="h-full border-l bg-background">
            <div className="flex h-full flex-col p-4">
                {!activeNode ? (
                    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-sm text-muted-foreground">
                        选中画布卡片后，可在这里直接编辑 Markdown 内容。
                    </div>
                ) : activeNode.type === "chat" ? (
                    <div className="flex h-full min-h-0 flex-col gap-3">
                        <Textarea
                            className="min-h-0 flex-1 resize-none rounded-xl bg-card"
                            placeholder="用户 Prompt（Markdown）"
                            value={activeNode.userPrompt}
                            onChange={(event) => {
                                onUpdateChatPrompt(activeNode.id, event.target.value)
                            }}
                        />
                        <Textarea
                            className="min-h-0 flex-1 resize-none rounded-xl bg-card"
                            placeholder="AI Response（Markdown）"
                            value={activeNode.aiResponse}
                            onChange={(event) => {
                                onUpdateChatResponse(activeNode.id, event.target.value)
                            }}
                        />
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
