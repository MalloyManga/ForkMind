import { HTMLContainer, Rectangle2d, ShapeUtil, T, type TLShape } from "tldraw"
import type { HTMLAttributes } from "react"
import ReactMarkdown from "react-markdown"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"

export const FORK_MIND_CARD_SHAPE_TYPE = "forkmind-card"

export interface ForkMindCardShapeProps {
    w: number
    h: number
    cardType: "chat" | "note"
    userPrompt: string
    aiResponse: string
    noteContent: string
}

declare module "@tldraw/tlschema" {
    interface TLGlobalShapePropsMap {
        [FORK_MIND_CARD_SHAPE_TYPE]: ForkMindCardShapeProps
    }
}

export type ForkMindCardShape = TLShape<typeof FORK_MIND_CARD_SHAPE_TYPE>

const markdownComponents = {
    h1: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h1 {...props} className="mb-2 text-base font-semibold leading-tight text-foreground" />
    ),
    h2: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h2 {...props} className="mb-2 text-sm font-semibold leading-tight text-foreground" />
    ),
    h3: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h3 {...props} className="mb-1.5 text-[13px] font-semibold leading-tight text-foreground" />
    ),
    p: (props: HTMLAttributes<HTMLParagraphElement>) => (
        <p {...props} className="mb-2 text-xs leading-5 text-foreground" />
    ),
    ul: (props: HTMLAttributes<HTMLUListElement>) => (
        <ul {...props} className="mb-2 list-disc pl-4 text-xs leading-5 text-foreground" />
    ),
    ol: (props: HTMLAttributes<HTMLOListElement>) => (
        <ol {...props} className="mb-2 list-decimal pl-4 text-xs leading-5 text-foreground" />
    ),
    li: (props: HTMLAttributes<HTMLLIElement>) => (
        <li {...props} className="mb-1 text-xs leading-5 text-foreground" />
    ),
    code: (props: HTMLAttributes<HTMLElement>) => (
        <code
            {...props}
            className="rounded bg-zinc-950/8 px-1 py-0.5 font-mono text-[11px] text-foreground theme-dark:bg-white/10"
        />
    ),
    pre: (props: HTMLAttributes<HTMLPreElement>) => (
        <pre
            {...props}
            className="mb-2 overflow-x-auto rounded-lg bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-5 text-zinc-100 theme-dark:bg-black"
        />
    ),
    blockquote: (props: HTMLAttributes<HTMLQuoteElement>) => (
        <blockquote
            {...props}
            className="mb-2 border-l-2 border-zinc-300 pl-3 text-xs leading-5 text-muted-foreground theme-dark:border-zinc-700"
        />
    ),
}

/**
 * ForkMind 自定义卡片 shape。
 * 业务场景：画布卡片需要真正渲染 Markdown，而不是继续借用 tldraw 默认 note 的纯文本展示。
 */
export class ForkMindCardShapeUtil extends ShapeUtil<ForkMindCardShape> {
    static override type = FORK_MIND_CARD_SHAPE_TYPE

    static override props = {
        w: T.number,
        h: T.number,
        cardType: T.string,
        userPrompt: T.string,
        aiResponse: T.string,
        noteContent: T.string,
    }

    override getDefaultProps(): ForkMindCardShape["props"] {
        return {
            w: 320,
            h: 220,
            cardType: "note",
            userPrompt: "",
            aiResponse: "",
            noteContent: "",
        }
    }

    override canEdit() {
        return false
    }

    override canResize() {
        return false
    }

    override hideResizeHandles() {
        return true
    }

    override hideRotateHandle() {
        return true
    }

    override getGeometry(shape: ForkMindCardShape) {
        return new Rectangle2d({
            width: shape.props.w,
            height: shape.props.h,
            isFilled: true,
        })
    }

    override component(shape: ForkMindCardShape) {
        return (
            <HTMLContainer
                id={shape.id}
                className="pointer-events-auto h-full w-full overflow-hidden rounded-2xl border border-zinc-300/80 bg-card shadow-sm theme-dark:border-zinc-700/80"
            >
                <div className="flex h-full w-full flex-col overflow-hidden">
                    {shape.props.cardType === "chat" ? (
                        <>
                            <section className="flex min-h-0 flex-1 flex-col border-b border-zinc-200/80 px-4 py-3 theme-dark:border-zinc-800">
                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Prompt
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                    <ReactMarkdown
                                        components={markdownComponents}
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeSanitize]}
                                    >
                                        {shape.props.userPrompt.trim() || "_empty prompt_"}
                                    </ReactMarkdown>
                                </div>
                            </section>

                            <section className="flex min-h-0 flex-1 flex-col px-4 py-3">
                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    AI
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                    <ReactMarkdown
                                        components={markdownComponents}
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeSanitize]}
                                    >
                                        {shape.props.aiResponse.trim() || "_empty response_"}
                                    </ReactMarkdown>
                                </div>
                            </section>
                        </>
                    ) : (
                        <section className="flex min-h-0 flex-1 flex-col px-4 py-3">
                            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                <ReactMarkdown
                                    components={markdownComponents}
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[rehypeSanitize]}
                                >
                                    {shape.props.noteContent.trim() || "_empty note_"}
                                </ReactMarkdown>
                            </div>
                        </section>
                    )}
                </div>
            </HTMLContainer>
        )
    }

    override indicator(shape: ForkMindCardShape) {
        return <rect width={shape.props.w} height={shape.props.h} rx={24} ry={24} />
    }
}
