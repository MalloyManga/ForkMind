import { type MouseEvent as ReactMouseEvent, useCallback, useMemo, useState } from "react"
import { Editor, type TLComponents, type TLShapeId, Tldraw, useValue } from "tldraw"
import "tldraw/tldraw.css"
import { parseNodeIdFromShapeId } from "../hooks/canvasNodeIds"
import { type CanvasContextMenuContext } from "../hooks/canvasContextMenuTypes"
import { StartLinkDragInput } from "../hooks/canvasLinkTypes"
import type { CanvasTool } from "../hooks/canvasToolTypes"
import { ForkMindArrowShapeUtil } from "../lib/forkMindArrowShape"
import { ForkMindCardShapeUtil } from "../lib/forkMindCardShape"
import { CanvasCreationDragOverlay } from "./CanvasCreationDragOverlay"
import { CanvasCreationModeBar } from "./CanvasCreationModeBar"
import { CanvasLinkHandlesOverlay } from "./CanvasLinkHandlesOverlay"

interface CanvasWorkspaceProps {
    // tldraw 挂载完成后 把 editor 实例经由 App 交回桥接层 canvasBridge 处理
    onCanvasMount: (editor: Editor) => void
    onStartLinkDrag: (input: StartLinkDragInput) => void
    onOpenContextMenu: (context: CanvasContextMenuContext) => void
    currentCanvasTool: CanvasTool // 当前底部工具条选中的工具
    // 底部工具条切换工具时 回写到 App
    onSelectCanvasTool: (canvasTool: CanvasTool) => void
    isCanvasUiVisible: boolean
    isContextMenuOpen: boolean
    creationPreviewRect: {
        // 创建工具拖拽中的蓝色预创建框
        x: number
        y: number
        width: number
        height: number
    } | null
    licenseKey?: string
}

/**
 * 中间无限画布区
 * 承载 tldraw 画布 hover 连线触点 底部创建工具条和自定义右键菜单入口
 */
export function CanvasWorkspace({
    onCanvasMount,
    onStartLinkDrag,
    onOpenContextMenu,
    currentCanvasTool,
    onSelectCanvasTool,
    isCanvasUiVisible,
    isContextMenuOpen,
    creationPreviewRect,
    licenseKey,
}: CanvasWorkspaceProps) {
    const [canvasEditor, setCanvasEditor] = useState<Editor | null>(null)
    const isCanvasResizing = useValue(
        "ForkMind canvas resizing",
        () => canvasEditor?.getPath() === "select.resizing",
        [canvasEditor],
    )

    const canvasShapeUtils = useMemo(
        // 这里注册我们自定义的 card 和 arrow shape util 让 tldraw 认识业务卡片与箭头
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
            // 当 UI 全隐藏或当前是 hand-tool 时 不显示这些业务悬浮控件
            InFrontOfTheCanvas: () => (
                <CanvasLinkHandlesOverlay
                    onStartLinkDrag={onStartLinkDrag}
                    isVisible={
                        isCanvasUiVisible &&
                        !isContextMenuOpen &&
                        currentCanvasTool !== "hand-tool" &&
                        !isCanvasResizing
                    }
                />
            ),
        }),
        [currentCanvasTool, isCanvasResizing, isCanvasUiVisible, isContextMenuOpen, onStartLinkDrag],
    )

    const handleWorkspaceContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault()

        if (!canvasEditor) {
            return
        }

        // 右键位置先从屏幕坐标转成画布 page 坐标 后续 paste here 和 shape 命中都要用它
        const pagePoint = canvasEditor.screenToPage({
            x: event.clientX,
            y: event.clientY,
        })

        const hitShape = canvasEditor.getShapeAtPoint(pagePoint, {
            hitInside: true,
            margin: 0,
            // 只把业务卡片视为右键命中的节点 箭头和其它 shape 不纳入第一版右键语义
            filter: (shape) => parseNodeIdFromShapeId(shape.id as TLShapeId) !== null,
        })

        const nodeId = hitShape ? parseNodeIdFromShapeId(hitShape.id as TLShapeId) : null

        // 右键 node 之后进行判定
        if (hitShape && nodeId) {
            const hitShapeId = hitShape.id as TLShapeId
            const selectedShapeIds = canvasEditor.getSelectedShapeIds()
            const isHitShapeAlreadySelected = selectedShapeIds.includes(hitShapeId)

            // 右键卡片不在 selection 当中时 把画布 selection 切到该卡片(已选中则保留多选)
            if (!isHitShapeAlreadySelected) {
                canvasEditor.setSelectedShapes([hitShapeId])
            }
        }

        onOpenContextMenu(
            nodeId
                ? {
                    kind: "node",
                    nodeId,
                    screenPoint: { x: event.clientX, y: event.clientY },
                    pagePoint,
                }
                : {
                    kind: "canvas",
                    screenPoint: { x: event.clientX, y: event.clientY },
                    pagePoint,
                },
        )
    }, [canvasEditor, onOpenContextMenu])

    return (
        <main
            className="relative flex-1 bg-zinc-50 theme-dark:bg-zinc-900"
            onContextMenu={handleWorkspaceContextMenu}
        >
            <div className="absolute inset-0">
                <Tldraw
                    hideUi
                    // onMount 挂载整个 tldraw editor 实例
                    // 后续所有 canvas 级事件监听都依赖这个对象
                    onMount={(editor) => {
                        // Workspace 自己留一份 editor 是为了命中测试和 page 坐标换算
                        setCanvasEditor(editor)
                        onCanvasMount(editor)
                    }}
                    licenseKey={licenseKey}
                    shapeUtils={canvasShapeUtils}
                    components={canvasComponents}
                />
            </div>
            {/* 蓝色预创建框是我们自己的 overlay 不属于 tldraw 默认图形 */}
            <CanvasCreationDragOverlay previewRect={creationPreviewRect} />
            {isCanvasUiVisible ? (
                <CanvasCreationModeBar
                    currentCanvasTool={currentCanvasTool}
                    onSelectCanvasTool={onSelectCanvasTool}
                />
            ) : null}
        </main>
    )
}
