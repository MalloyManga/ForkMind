import {
    HTMLContainer,
    Rectangle2d,
    resizeBox,
    ShapeUtil,
    T,
    type TLResizeInfo,
    type TLShape,
} from "tldraw"
import ReactMarkdown from "react-markdown"
import {
    markdownComponents,
    markdownRehypePlugins,
    markdownRemarkPlugins,
    normalizeMarkdownForPreview,
} from "./markdownRendering"
import type { ConversationTextField } from "../domain/conversation/types"
import { assertNever } from "./utils"
import { PersonIcon } from "../components/icons/PersonIcon"
import { RobotIcon } from "../components/icons/RobotIcon"
import { NotePlusIcon } from "../components/icons/NotePlusIcon"
import { FileIcon, ImageIcon, Link2 } from "lucide-react"
import { ManagedImagePreview } from "../components/ManagedImagePreview"
import {
    CANVAS_CARD_ACTIVATE_EVENT,
    CANVAS_TEXT_SELECTION_EVENT,
    type CanvasCardActivateEventDetail,
    type CanvasTextSelectionEventDetail,
} from "../domain/conversation/textSelection"

/**
 * 卡片唯一身份标识
 */
export const FORK_MIND_CARD_SHAPE_TYPE = "forkmind-card"

function formatAssetSize(sizeBytes: number): string {
    if (sizeBytes <= 0) {
        return "No local asset"
    }
    if (sizeBytes < 1024) {
        return `${sizeBytes} B`
    }
    if (sizeBytes < 1024 * 1024) {
        return `${(sizeBytes / 1024).toFixed(1)} KB`
    }
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

// BaseNode 接口里删除掉了type字段之后 剩下的字段A 再从ConversationCard当中分别删除字段A 得到联合类型
type CardShapeOwnProps =
    | { cardType: "chat"; userPrompt: string; aiResponse: string }
    | { cardType: "note"; noteContent: string }
    | {
        cardType: "image"
        assetId: string
        assetName: string
        assetMimeType: string
        assetSizeBytes: number
        caption: string
        altText: string
    }
    | { cardType: "link"; url: string; title: string; description: string }
    | {
        cardType: "file"
        assetName: string
        assetMimeType: string
        assetSizeBytes: number
        description: string
    }

/**
 * 每种卡片独有字段
 */
export type ForkMindCardShapeProps = {
    nodeId: string
    w: number
    h: number
} & CardShapeOwnProps

declare module "@tldraw/tlschema" {
    interface TLGlobalShapePropsMap {
        [FORK_MIND_CARD_SHAPE_TYPE]: ForkMindCardShapeProps
    }
}

/**
 * TLShape 基础属性方法 和 ForkMindCardShapeProps 的组合
 */
export type ForkMindCardShape = TLShape<typeof FORK_MIND_CARD_SHAPE_TYPE>

/**
 * ShapeUtil 传入泛型 ForkMindCardShape(TLShape 子类型) 声明传入类的属性方法
 */
export class ForkMindCardShapeUtil extends ShapeUtil<ForkMindCardShape> {
    static override type = FORK_MIND_CARD_SHAPE_TYPE

    static override props = {
        // T 为 tldraw 内部的数据校验器
        w: T.number,
        h: T.number,
        nodeId: T.string,
        cardType: T.literalEnum("chat", "note", "image", "link", "file"),
        userPrompt: T.string.optional(),
        aiResponse: T.string.optional(),
        noteContent: T.string.optional(),
        assetId: T.string.optional(),
        assetName: T.string.optional(),
        assetMimeType: T.string.optional(),
        assetSizeBytes: T.number.optional(),
        caption: T.string.optional(),
        altText: T.string.optional(),
        url: T.string.optional(),
        title: T.string.optional(),
        description: T.string.optional(),
    }

    /**
     * 仅用于实现抽象类 实际上没有任何作用
     */
    override getDefaultProps(): ForkMindCardShape["props"] {
        return {
            w: 320,
            h: 220,
            nodeId: "preview",
            cardType: "note",
            noteContent: "",
        }
    }

    override onResize(shape: ForkMindCardShape, info: TLResizeInfo<ForkMindCardShape>) {
        // tldraw 只负责计算 resize 过程中的临时 shape Store 回写由 pointerup 的 bridge 层完成
        return resizeBox(shape, info, { minWidth: 180, minHeight: 120 })
    }

    /**
     * 从 component 里编写的 DOM 当中计算出自定义图形的逻辑命中边框
     */
    override getGeometry(shape: ForkMindCardShape) {
        return new Rectangle2d({
            width: shape.props.w,
            height: shape.props.h,
            isFilled: true,
        })
    }

    /**
     * active card 周围的蓝色高亮边框
     */
    override indicator(shape: ForkMindCardShape) {
        return <rect width={shape.props.w} height={shape.props.h} rx={24} ry={24} />
    }

    override canEdit() {
        return false
    }

    override canResize() {
        return true
    }

    override hideResizeHandles() {
        return false
    }

    override hideRotateHandle() {
        return true
    }

    override component(shape: ForkMindCardShape) {
        const activateCard = () => {
            window.dispatchEvent(new CustomEvent<CanvasCardActivateEventDetail>(
                CANVAS_CARD_ACTIVATE_EVENT,
                { detail: { nodeId: shape.props.nodeId } },
            ))
        }

        const captureCanvasTextSelection = (
            event: React.PointerEvent<HTMLDivElement>,
            field: ConversationTextField,
        ) => {
            const selection = window.getSelection()
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                return
            }

            const range = selection.getRangeAt(0)
            const selectionHost = event.currentTarget
            if (!selectionHost.contains(range.commonAncestorContainer)) {
                return
            }

            const quote = selection.toString().trim()
            if (!quote) {
                return
            }

            window.dispatchEvent(new CustomEvent<CanvasTextSelectionEventDetail>(
                CANVAS_TEXT_SELECTION_EVENT,
                {
                    detail: {
                        anchor: {
                            sourceNodeId: shape.props.nodeId,
                            field,
                            quote,
                            startOffset: null,
                            endOffset: null,
                            origin: "canvas",
                        },
                        clientX: event.clientX,
                        clientY: event.clientY,
                    },
                },
            ))
        }

        const createSelectableTextProps = (field: ConversationTextField) => ({
            onPointerDown: () => {
                activateCard()
            },
            onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
                captureCanvasTextSelection(event, field)
            },
        })

        const cardContent = (() => {
            switch (shape.props.cardType) {
                case "chat":
                    return (
                        <>
                            <section className="flex min-h-0 flex-1 flex-col border-b border-zinc-200/70 theme-dark:border-zinc-800/80">
                                <div className="fm-card-scroll min-h-0 flex-1 overflow-y-auto py-3 pl-3 pr-2 text-sm leading-relaxed">
                                    <div className="flex gap-2.5">
                                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/12 text-sky-600 theme-dark:text-sky-400">
                                            <PersonIcon className="h-3.5 w-3.5" />
                                        </span>
                                        <div
                                            className="min-w-0 flex-1 select-text pt-0.5"
                                            {...createSelectableTextProps("userPrompt")}
                                        >
                                            <ReactMarkdown
                                                components={markdownComponents} // 识别公式和表格
                                                remarkPlugins={markdownRemarkPlugins} // 杀毒防 XSS + 渲染数学符号
                                                rehypePlugins={markdownRehypePlugins} // 修改 css 样式
                                            >
                                                {normalizeMarkdownForPreview(shape.props.userPrompt.trim()) || "_empty prompt_"}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section className="flex min-h-0 flex-1 flex-col bg-violet-500/[0.03] theme-dark:bg-violet-500/[0.04]">
                                <div className="fm-card-scroll min-h-0 flex-1 overflow-y-auto py-3 pl-3 pr-2 text-sm leading-relaxed">
                                    <div className="flex gap-2.5">
                                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 theme-dark:text-violet-400">
                                            <RobotIcon className="h-3.5 w-3.5" />
                                        </span>
                                        <div
                                            className="min-w-0 flex-1 select-text pt-0.5"
                                            {...createSelectableTextProps("aiResponse")}
                                        >
                                            <ReactMarkdown
                                                components={markdownComponents}
                                                remarkPlugins={markdownRemarkPlugins}
                                                rehypePlugins={markdownRehypePlugins}
                                            >
                                                {normalizeMarkdownForPreview(shape.props.aiResponse.trim()) || "_empty response_"}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </>
                    )
                case "note":
                    return (
                        <section className="flex min-h-0 flex-1 flex-col">
                            <div className="fm-card-scroll min-h-0 flex-1 overflow-y-auto py-3 pl-3 pr-2 text-sm leading-relaxed">
                                <div className="flex gap-2.5">
                                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-amber-600 theme-dark:text-amber-400">
                                        <NotePlusIcon className="h-3.5 w-3.5" />
                                    </span>
                                    <div
                                        className="min-w-0 flex-1 select-text pt-0.5"
                                        {...createSelectableTextProps("noteContent")}
                                    >
                                        <ReactMarkdown
                                            components={markdownComponents}
                                            remarkPlugins={markdownRemarkPlugins}
                                            rehypePlugins={markdownRehypePlugins}
                                        >
                                            {normalizeMarkdownForPreview(shape.props.noteContent.trim()) || "_empty note_"}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )
                case "image":
                    return (
                        <section className="flex min-h-0 flex-1 flex-col">
                            <div className="min-h-0 flex-1 overflow-hidden bg-zinc-100/70 theme-dark:bg-zinc-900/70">
                                <ManagedImagePreview
                                    assetId={shape.props.assetId}
                                    altText={shape.props.altText}
                                />
                            </div>
                            <div className="shrink-0 border-t border-zinc-200/70 px-3 py-2 theme-dark:border-zinc-800/80">
                                <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <ImageIcon className="h-3.5 w-3.5" />
                                    <span className="min-w-0 flex-1 truncate">{shape.props.assetName || "Local image"}</span>
                                    <span>{formatAssetSize(shape.props.assetSizeBytes)}</span>
                                </div>
                                <div
                                    className="line-clamp-2 select-text text-xs leading-relaxed"
                                    {...createSelectableTextProps("caption")}
                                >
                                    {shape.props.caption || shape.props.altText || "_empty image caption_"}
                                </div>
                            </div>
                        </section>
                    )
                case "link":
                    return (
                        <section className="flex min-h-0 flex-1 flex-col px-3 py-3">
                            <div className="mb-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 theme-dark:text-emerald-400">
                                <Link2 className="h-4 w-4" />
                            </div>
                            <div
                                className="select-text text-sm font-semibold"
                                {...createSelectableTextProps("title")}
                            >
                                {shape.props.title || "Untitled link"}
                            </div>
                            <div
                                className="mt-1 truncate select-text text-[11px] text-emerald-600 theme-dark:text-emerald-400"
                                {...createSelectableTextProps("url")}
                            >
                                {shape.props.url || "https://"}
                            </div>
                            <div
                                className="fm-card-scroll mt-3 min-h-0 flex-1 overflow-y-auto select-text text-xs leading-relaxed text-muted-foreground"
                                {...createSelectableTextProps("description")}
                            >
                                {shape.props.description || "_empty link description_"}
                            </div>
                        </section>
                    )
                case "file":
                    return (
                        <section className="flex min-h-0 flex-1 flex-col px-3 py-3">
                            <div className="flex items-start gap-3">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/12 text-fuchsia-600 theme-dark:text-fuchsia-400">
                                    <FileIcon className="h-5 w-5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold">{shape.props.assetName || "Local file"}</div>
                                    <div className="mt-1 text-[11px] text-muted-foreground">
                                        {shape.props.assetMimeType || "No file selected"} · {formatAssetSize(shape.props.assetSizeBytes)}
                                    </div>
                                </div>
                            </div>
                            <div
                                className="fm-card-scroll mt-4 min-h-0 flex-1 overflow-y-auto select-text text-xs leading-relaxed text-muted-foreground"
                                {...createSelectableTextProps("description")}
                            >
                                {shape.props.description || "_empty file description_"}
                            </div>
                        </section>
                    )
            }

            return assertNever(shape.props)
        })()

        // 左侧类型色条：Chat=靛蓝渐变，Note=琥珀，是卡片在画布上的第一眼身份标识
        const accentBar = (() => {
            switch (shape.props.cardType) {
                case "chat":
                    return "before:bg-gradient-to-b before:from-sky-400 before:to-violet-500"
                case "note":
                    return "before:bg-amber-400"
                case "image":
                    return "before:bg-cyan-400"
                case "link":
                    return "before:bg-emerald-400"
                case "file":
                    return "before:bg-fuchsia-400"
            }

            return assertNever(shape.props)
        })()

        return (
            <HTMLContainer
                id={shape.id}
                className={`fm-card pointer-events-auto relative h-full w-full overflow-hidden rounded-2xl border border-zinc-200/80 bg-card shadow-[0_2px_4px_rgba(15,23,42,0.04),0_10px_28px_-10px_rgba(15,23,42,0.16)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] theme-dark:border-zinc-700/70 theme-dark:shadow-[0_2px_4px_rgba(0,0,0,0.24),0_14px_36px_-10px_rgba(0,0,0,0.6)] ${accentBar}`}
            >
                <div className="flex h-full w-full flex-col overflow-hidden pl-[3px]">
                    {cardContent}
                </div>
            </HTMLContainer>
        )
    }
}
