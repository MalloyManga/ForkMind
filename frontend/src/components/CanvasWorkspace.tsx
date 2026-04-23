import { useMemo } from "react"
import { Editor, Tldraw, type TLComponents } from "tldraw"
import "tldraw/tldraw.css"
import { StartLinkDragInput } from "../hooks/canvasLinkTypes"
import type { CanvasTool } from "../hooks/canvasToolTypes"
import { ForkMindArrowShapeUtil } from "../lib/forkMindArrowShape"
import { ForkMindCardShapeUtil } from "../lib/forkMindCardShape"
import { CanvasCreationDragOverlay } from "./CanvasCreationDragOverlay"
import { CanvasCreationModeBar } from "./CanvasCreationModeBar"
import { CanvasLinkHandlesOverlay } from "./CanvasLinkHandlesOverlay"

interface CanvasWorkspaceProps {
    // tldraw 挂载完成后，把 editor 实例经由Apptsx交回桥接层canvasBridge处理
    onCanvasMount: (editor: Editor) => void
    onStartLinkDrag: (input: StartLinkDragInput) => void
    currentCanvasTool: CanvasTool // 当前底部工具条选中的工具
    // 底部工具条切换工具时，回写到 App
    onSelectCanvasTool: (canvasTool: CanvasTool) => void
    // 创建工具拖拽中的蓝色预创建框
    creationPreviewRect: {
        x: number
        y: number
        width: number
        height: number
    } | null
    licenseKey?: string
}

/**
 * 中间无限画布区
 * 承载 tldraw 画布、hover 连线触点与底部创建节点工具条
 */
export function CanvasWorkspace({
    onCanvasMount,
    onStartLinkDrag,
    currentCanvasTool,
    onSelectCanvasTool,
    creationPreviewRect,
    licenseKey,
}: CanvasWorkspaceProps) {
    const canvasShapeUtils = useMemo(
        () => [ForkMindCardShapeUtil, ForkMindArrowShapeUtil],
        [],
    )

    const canvasComponents = useMemo<TLComponents>(
        () => ({
            /**
             * 关闭 tldraw 默认 Handles 避免与我们自定义 hover 四向触点重叠
             */
            Handles: null,
            ContextMenu: null,
            // 把四向连线 handle 叠到画布最前层
            // hand-tool 下不显示 其余工具都允许进入节点关系或子卡片创建语义
            InFrontOfTheCanvas: () => (
                <CanvasLinkHandlesOverlay
                    onStartLinkDrag={onStartLinkDrag}
                    isVisible={currentCanvasTool !== "hand-tool"}
                />
            ),
        }),
        [currentCanvasTool, onStartLinkDrag],
    )

    return (
        <main
            className="relative flex-1 bg-zinc-50 theme-dark:bg-zinc-900"
            onContextMenu={(event) => {
                event.preventDefault()
            }}
        >
            <div className="absolute inset-0">
                <Tldraw
                    hideUi
                    // onMount 挂载整个 tldraw editor 实例
                    // 后续所有 canvas 级事件监听都依赖这个对象
                    onMount={(editor) => { onCanvasMount(editor) }}
                    licenseKey={licenseKey}
                    shapeUtils={canvasShapeUtils}
                    components={canvasComponents}
                />
            </div>
            {/* 蓝色预创建框是我们自己的 overlay，不属于 tldraw 默认图形 */}
            <CanvasCreationDragOverlay previewRect={creationPreviewRect} />
            <CanvasCreationModeBar
                currentCanvasTool={currentCanvasTool} // 
                onSelectCanvasTool={onSelectCanvasTool}
            />
        </main>
    )
}
