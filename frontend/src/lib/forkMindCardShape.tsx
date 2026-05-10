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
import type { BaseNode, ConversationCard } from "../domain/conversation/types"
import type { DistributiveOmit } from "../types/typeUtils"
import { assertNever } from "./utils"

/**
 * 卡片唯一身份标识
 */
export const FORK_MIND_CARD_SHAPE_TYPE = "forkmind-card"

// BaseNode 接口里删除掉了type字段之后 剩下的字段A 再从ConversationCard当中分别删除字段A 得到联合类型
type CardShapeOwnProps = DistributiveOmit<ConversationCard, keyof Omit<BaseNode, "cardType">>

/**
 * 每种卡片独有字段
 */
export type ForkMindCardShapeProps = {
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
        cardType: T.string,
    }

    /**
     * 仅用于实现抽象类 实际上没有任何作用
     */
    override getDefaultProps(): ForkMindCardShape["props"] {
        return {
            w: 320,
            h: 220,
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
        const cardContent = (() => {
            switch (shape.props.cardType) {
                case "chat":
                    return (
                        <>
                            <section className="flex min-h-0 flex-1 flex-col border-b border-zinc-200/80 px-4 py-3 theme-dark:border-zinc-800">
                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Prompt
                                </div>
                                <div className="fm-card-scroll min-h-0 flex-1 overflow-y-auto pr-1">
                                    <ReactMarkdown
                                        components={markdownComponents} // 识别公式和表格
                                        remarkPlugins={markdownRemarkPlugins} // 杀毒防 XSS + 渲染数学符号
                                        rehypePlugins={markdownRehypePlugins} // 修改 css 样式
                                    >
                                        {normalizeMarkdownForPreview(shape.props.userPrompt.trim()) || "_empty prompt_"}
                                    </ReactMarkdown>
                                </div>
                            </section>

                            <section className="flex min-h-0 flex-1 flex-col px-4 py-3">
                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    AI
                                </div>
                                <div className="fm-card-scroll min-h-0 flex-1 overflow-y-auto pr-1">
                                    <ReactMarkdown
                                        components={markdownComponents}
                                        remarkPlugins={markdownRemarkPlugins}
                                        rehypePlugins={markdownRehypePlugins}
                                    >
                                        {normalizeMarkdownForPreview(shape.props.aiResponse.trim()) || "_empty response_"}
                                    </ReactMarkdown>
                                </div>
                            </section>
                        </>
                    )
                case "note":
                    return (
                        <section className="flex min-h-0 flex-1 flex-col px-4 py-3">
                            <div className="fm-card-scroll min-h-0 flex-1 overflow-y-auto pr-1">
                                <ReactMarkdown
                                    components={markdownComponents}
                                    remarkPlugins={markdownRemarkPlugins}
                                    rehypePlugins={markdownRehypePlugins}
                                >
                                    {normalizeMarkdownForPreview(shape.props.noteContent.trim()) || "_empty note_"}
                                </ReactMarkdown>
                            </div>
                        </section>
                    )
            }

            return assertNever(shape.props)
        })()

        return (
            <HTMLContainer
                id={shape.id}
                className="fm-card pointer-events-auto h-full w-full overflow-hidden rounded-2xl border border-zinc-300/80 bg-card shadow-sm theme-dark:border-zinc-700/80"
            >
                <div className="flex h-full w-full flex-col overflow-hidden">
                    {cardContent}
                </div>
            </HTMLContainer>
        )
    }
}
