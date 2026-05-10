import ReactMarkdown from "react-markdown"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    markdownComponents,
    markdownRehypePlugins,
    markdownRemarkPlugins,
    normalizeMarkdownForPreview,
} from "@/lib/markdownRendering"

interface MarkdownPreviewProps {
    title: string
    markdown: string
}

/**
 * Markdown 预览组件
 * 右栏编辑时提供实时预览，方便用户确认排版与语义
 */
export function MarkdownPreview({ title, markdown }: MarkdownPreviewProps) {
    const previewMarkdown = normalizeMarkdownForPreview(markdown.trim())

    return (
        <Card size="sm" className="gap-2">
            <CardHeader className="pb-0">
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-input bg-background p-3 text-sm leading-6">
                    <ReactMarkdown
                        components={markdownComponents}
                        remarkPlugins={markdownRemarkPlugins}
                        rehypePlugins={markdownRehypePlugins}
                    >
                        {previewMarkdown.length > 0 ? previewMarkdown : "_(empty)_"}
                    </ReactMarkdown>
                </div>
            </CardContent>
        </Card>
    )
}
