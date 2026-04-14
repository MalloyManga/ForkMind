import { useMemo } from "react"
import { Editor, Tldraw, type TLComponents } from "tldraw"
import "tldraw/tldraw.css"
import { StartLinkDragInput } from "../hooks/canvasLinkTypes"
import { ForkMindArrowShapeUtil } from "../lib/forkMindArrowShape"
import { ForkMindCardShapeUtil } from "../lib/forkMindCardShape"
import { CanvasCreationModeBar, type CanvasCreationType } from "./CanvasCreationModeBar"
import { CanvasLinkHandlesOverlay } from "./CanvasLinkHandlesOverlay"

export type { CanvasCreationType } from "./CanvasCreationModeBar"

interface CanvasWorkspaceProps {
    onCanvasMount: (editor: Editor) => void
    onStartLinkDrag: (input: StartLinkDragInput) => void
    selectedCreationType: CanvasCreationType
    onSelectCreationType: (creationType: CanvasCreationType) => void
    licenseKey?: string
}

/**
 * 中间无限画布区。
 * 业务场景：承载 tldraw 画布、hover 连线触点与底部创建节点工具条。
 */
export function CanvasWorkspace({
    onCanvasMount,
    onStartLinkDrag,
    selectedCreationType,
    onSelectCreationType,
    licenseKey,
}: CanvasWorkspaceProps) {
    const canvasShapeUtils = useMemo(
        () => [ForkMindCardShapeUtil, ForkMindArrowShapeUtil],
        [],
    )

    const canvasComponents = useMemo<TLComponents>(
        () => ({
            /**
             * 关闭 tldraw 默认 Handles，避免与我们自定义 hover 四向触点重叠。
             */
            Handles: null,
            InFrontOfTheCanvas: () => <CanvasLinkHandlesOverlay onStartLinkDrag={onStartLinkDrag} />,
        }),
        [onStartLinkDrag],
    )

    return (
        <main className="relative flex-1 bg-zinc-50 theme-dark:bg-zinc-900">
            <div className="absolute inset-0">
                <Tldraw
                    hideUi
                    onMount={(editor) => { onCanvasMount(editor) }}
                    licenseKey={licenseKey}
                    shapeUtils={canvasShapeUtils}
                    components={canvasComponents}
                />
            </div>
            <CanvasCreationModeBar
                selectedCreationType={selectedCreationType}
                onSelectCreationType={onSelectCreationType}
            />
        </main>
    )
}
