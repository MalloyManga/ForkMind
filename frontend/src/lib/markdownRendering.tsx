import {
    isValidElement,
    type ReactNode,
    useEffect,
    useMemo,
    useState,
    type AnchorHTMLAttributes,
    type HTMLAttributes,
    type TableHTMLAttributes,
    type TdHTMLAttributes,
    type ThHTMLAttributes,
} from "react"
import type { Components } from "react-markdown"
import rehypeKatex from "rehype-katex"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { codeToHtml } from "shiki"
import type { PluggableList } from "unified"

type CodeElementProps = HTMLAttributes<HTMLElement> & {
    inline?: boolean
}

type PreElementProps = HTMLAttributes<HTMLPreElement> & {
    children?: ReactNode
}

const shikiTheme = "one-dark-pro"
const shikiHtmlCache = new Map<string, string>()

const markdownSanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        "*": [
            ...(defaultSchema.attributes?.["*"] ?? []),
            "className",
            "style",
        ],
        code: [
            ...(defaultSchema.attributes?.code ?? []),
            ["className", /^language-./],
        ],
        span: [
            ...(defaultSchema.attributes?.span ?? []),
            "className",
            "style",
        ],
        div: [
            ...(defaultSchema.attributes?.div ?? []),
            "className",
            "style",
        ],
        annotation: [
            ...(defaultSchema.attributes?.annotation ?? []),
            "encoding",
        ],
    },
    tagNames: [
        ...(defaultSchema.tagNames ?? []),
        "math",
        "semantics",
        "mrow",
        "mi",
        "mn",
        "mo",
        "msup",
        "msub",
        "msubsup",
        "mfrac",
        "msqrt",
        "mroot",
        "mtable",
        "mtr",
        "mtd",
        "mtext",
        "annotation",
    ],
}

export const markdownRemarkPlugins: PluggableList = [remarkGfm, remarkMath]
export const markdownRehypePlugins: PluggableList = [
    rehypeKatex,
    [rehypeSanitize, markdownSanitizeSchema],
]

/**
 * md normalizer 函数
 * 解析传入的 md 为可渲染的 html
 */
type MarkdownPreviewNormalizer = (markdown: string) => string

/**
 * md normalizer 函数数组
 */
const markdownPreviewNormalizers: readonly MarkdownPreviewNormalizer[] = [
    preserveConsecutiveBlockquoteBreaks,
]

function isBlockquoteContentLine(line: string) {
    return /^ {0,3}>[ \t]*\S/.test(line)
}

function hasMarkdownHardBreak(line: string) {
    return /(?: {2}|\\)$/.test(line)
}

/**
 * normalizeMarkdownForPreview 是渲染前的只读 preview pipeline dispatcher
 * @param markdown 入参 markdown 来自 Store shape props 或右侧 textarea 当前文本 用于生成 ReactMarkdown 的展示输入
 * 将传入的 markdown 依次遍历执行 markdownNormalizer 得到最终可预览的 PreviewMarkdown (特殊格式修复)
 * 如果未来出现性能压力 再在调用层通过 useMemo 或缓存复用 previewMarkdown
 */
export function normalizeMarkdownForPreview(markdown: string) {
    return markdownPreviewNormalizers.reduce(
        (previewMarkdown, normalizeMarkdownToPreview) => normalizeMarkdownToPreview(previewMarkdown),
        markdown,
    )
}

/**
 * @param markdown 入参 markdown 是 dispatcher 传入的渲染前展示文本 来源仍是 Store 或 textarea 的只读快照
 * @returns 返回值会在连续引用行末尾补充 Markdown hard break 以保留 AI 回复中的逐行引用视觉
 * 给连续 blockquotes 的末尾追加 hard break
 */
function preserveConsecutiveBlockquoteBreaks(markdown: string) {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n")

    return lines
        .map((line, lineIndex) => {
            const nextLine = lines[lineIndex + 1]
            const isCurrentBlockquoteLine = isBlockquoteContentLine(line)
            const isNextBlockquoteLine = typeof nextLine === "string" && isBlockquoteContentLine(nextLine)

            // 连续 blockquote 内容行在 Markdown AST 中会合并为一个段落
            // 这里只在预览文本追加 hard break 让 AI 输出的逐行 blockquotes 保留视觉换行
            if (isCurrentBlockquoteLine && isNextBlockquoteLine && !hasMarkdownHardBreak(line)) {
                return `${line}  `
            }

            return line
        })
        .join("\n")
}

/**
 * MarkdownCodeBlock 负责 fenced code 的 shiki 异步高亮
 * @param props 入参来自 ReactMarkdown 的 code renderer className 内携带 fenced code 语言 children 是代码原文
 * @returns 返回高亮完成后的 Shiki HTML 失败或加载中时返回普通 pre/code 保证首屏不被异步任务阻塞
 */
function MarkdownCodeBlock({ className, children, ...props }: CodeElementProps) {
    const code = useMemo(() => String(children ?? "").replace(/\n$/, ""), [children])
    const language = useMemo(() => getCodeLanguage(className), [className])
    const shikiCacheKey = language ? `${language}:${shikiTheme}:${code}` : ""
    const [highlightedHtml, setHighlightedHtml] = useState(() => shikiHtmlCache.get(shikiCacheKey) ?? "")

    useEffect(() => {
        let isMounted = true // fenced code 是否已经挂载

        // fenced code 没有声明语言时直接走普通 code block 避免把 text 这类 Shiki 未注册语言交给高亮器
        if (!language) {
            setHighlightedHtml("")
            return () => {
                isMounted = false
            }
        }

        const cachedHtml = shikiHtmlCache.get(shikiCacheKey)

        // 已经缓存则不做重新计算
        if (cachedHtml) {
            setHighlightedHtml(cachedHtml)
            return () => {
                isMounted = false
            }
        }

        // 完好的 fenced code 开始调用 shiki 进行解析
        setHighlightedHtml("")
        codeToHtml(code, {
            lang: language,
            theme: shikiTheme,
        })
            .then((html) => {
                // 将已经计算的高亮缓存入 Map
                shikiHtmlCache.set(shikiCacheKey, html)

                if (isMounted) {
                    // 组件存活时 setState
                    setHighlightedHtml(html)
                }
            })
            .catch(() => {
                // 解析出问题显示行内代码
                if (isMounted) {
                    setHighlightedHtml("")
                }
            })

        return () => {
            isMounted = false
        }
    }, [code, language, shikiCacheKey])

    if (highlightedHtml.length > 0) {
        return (
            <div
                className="fm-shiki mb-2 overflow-x-auto rounded-lg bg-zinc-950 text-[11px] leading-5 theme-dark:bg-black"
                // Shiki 输出只来自 fenced code 字符串转换结果 不接收用户 HTML AST
                // react-markdown 未启用 rehype-raw 因此 Markdown 原文不会在这里作为 HTML 执行
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
        )
    }

    // shiki 加载之前先立刻渲染行内代码
    return (
        <pre className="mb-2 overflow-x-auto rounded-lg bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-5 text-zinc-100 theme-dark:bg-black">
            <code {...props} className={className}>
                {children}
            </code>
        </pre>
    )
}

/**
 * fenced code 渲染前触发 从 ReactMarkdown 注入的 className 中解析 fenced code 语言
 * @param className 入参来自 code node 的 class 属性 例如 language-ts 没有语言时为空
 * @returns 返回 Shiki 语言名 空语言返回 null 表示按普通 code block 渲染
 */
function getCodeLanguage(className: string | undefined) {
    const languageMatch = /language-([\w-]+)/.exec(className ?? "")

    return languageMatch?.[1] ?? null
}

/**
 * isHighlightedCodeBlock 判断 pre 的子节点是否已经由 shiki 处理过并渲染
 * @param children 入参来自 ReactMarkdown 的 pre renderer 表示 pre 下方的 code React 节点
 * @returns 返回 true 表示子节点是 fenced code 高亮容器 此时 pre 不再额外包裹一层
 * 该函数在 fenced code 渲染时触发 用于避免 Shiki 容器被嵌套进默认 pre
 */
function isHighlightedCodeBlock(children: ReactNode) {
    if (!isValidElement(children)) {
        return false
    }

    return typeof children.props.className === "string" && children.props.className.startsWith("language-")
}

export const markdownComponents: Components = {
    h1: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h1 {...props} className="mb-2 text-base font-semibold leading-tight text-foreground" />
    ),
    h2: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h2 {...props} className="mb-2 text-sm font-semibold leading-tight text-foreground" />
    ),
    h3: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h3 {...props} className="mb-1.5 text-[13px] font-semibold leading-tight text-foreground" />
    ),
    h4: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h4 {...props} className="mb-1.5 text-xs font-semibold leading-tight text-foreground" />
    ),
    h5: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h5 {...props} className="mb-1 text-[11px] font-semibold leading-tight text-foreground" />
    ),
    h6: (props: HTMLAttributes<HTMLHeadingElement>) => (
        <h6 {...props} className="mb-1 text-[10px] font-semibold uppercase leading-tight text-foreground" />
    ),
    p: (props: HTMLAttributes<HTMLParagraphElement>) => (
        <p {...props} className="mb-2 text-xs leading-5 text-foreground" />
    ),
    a: ({ className: _className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a
            {...props}
            className="text-blue-600 underline underline-offset-2 transition-colors hover:text-blue-700 theme-dark:text-blue-400 theme-dark:hover:text-blue-300"
        />
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
    code: ({ inline, className, children, ...props }: CodeElementProps) => {
        // 判断是不是带有 language-XXX 的独立代码块
        const isCodeBlock = !inline && typeof className === "string" && className.startsWith("language-")

        if (isCodeBlock) {
            return (
                <MarkdownCodeBlock className={className} {...props}>
                    {children} {/* 待渲染 code 内容 */}
                </MarkdownCodeBlock>
            )
        }

        return (
            // 行内代码直接不使用 shiki 高亮
            <code
                {...props}
                className="rounded bg-zinc-950/8 px-1 py-0.5 font-mono text-[11px] text-foreground theme-dark:bg-white/10"
            >
                {children}
            </code>
        )
    },
    pre: ({ children, ...props }: PreElementProps) => {
        if (isHighlightedCodeBlock(children)) {
            return <>{children}</>
        }

        return (
            <pre
                {...props}
                className="mb-2 overflow-x-auto rounded-lg bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-5 text-zinc-100 theme-dark:bg-black"
            >
                {children}
            </pre>
        )
    },
    blockquote: (props: HTMLAttributes<HTMLQuoteElement>) => (
        <blockquote
            {...props}
            className="mb-2 border-l-2 border-zinc-300 pl-3 text-xs leading-5 text-muted-foreground theme-dark:border-zinc-700"
        />
    ),
    table: (props: TableHTMLAttributes<HTMLTableElement>) => (
        <div className="mb-2 w-full overflow-x-auto">
            <table {...props} className="min-w-full border-collapse text-left text-xs leading-5 text-foreground" />
        </div>
    ),
    thead: (props: HTMLAttributes<HTMLTableSectionElement>) => (
        <thead {...props} className="bg-zinc-100/80 theme-dark:bg-zinc-800/80" />
    ),
    tbody: (props: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />,
    tr: (props: HTMLAttributes<HTMLTableRowElement>) => (
        <tr {...props} className="border-b border-zinc-200 last:border-b-0 theme-dark:border-zinc-800" />
    ),
    th: (props: ThHTMLAttributes<HTMLTableCellElement>) => (
        <th {...props} className="whitespace-nowrap border border-zinc-200 px-2 py-1 font-semibold theme-dark:border-zinc-800" />
    ),
    td: (props: TdHTMLAttributes<HTMLTableCellElement>) => (
        <td {...props} className="border border-zinc-200 px-2 py-1 align-top theme-dark:border-zinc-800" />
    ),
}
