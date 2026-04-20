import { useEffect, useMemo, useRef, useState } from "react"
import { Box, TLShapeId, useEditor } from "tldraw"
import { LinkHandleSide, StartLinkDragInput } from "../hooks/canvasLinkTypes"
import { parseNodeIdFromShapeId } from "../hooks/canvasNodeIds"

interface CanvasLinkHandlesOverlayProps {
    onStartLinkDrag: (input: StartLinkDragInput) => void
    isVisible: boolean
}

interface HandlePoint {
    side: LinkHandleSide
    x: number
    y: number
}

const HANDLE_RADIUS = 6

/**
 * 计算卡片四边的触点坐标
 */
function getEdgeHandlePoints(bounds: Box): HandlePoint[] {
    const centerX = bounds.x + bounds.w / 2
    const centerY = bounds.y + bounds.h / 2

    return [
        { side: "top", x: centerX, y: bounds.y },
        { side: "right", x: bounds.x + bounds.w, y: centerY },
        { side: "bottom", x: centerX, y: bounds.y + bounds.h },
        { side: "left", x: bounds.x, y: centerY },
    ]
}

/**
 * 卡片四周的Handle
 */
export function CanvasLinkHandlesOverlay({
    onStartLinkDrag,
    isVisible,
}: CanvasLinkHandlesOverlayProps) {
    const editor = useEditor()
    const [hoveredNodeShapeId, setHoveredNodeShapeId] = useState<TLShapeId | null>(null)
    const [overlayVersion, setOverlayVersion] = useState(0)
    const hoveredNodeShapeIdRef = useRef<TLShapeId | null>(null)
    const isPointerOverHandleRef = useRef(false)

    useEffect(() => {
        hoveredNodeShapeIdRef.current = hoveredNodeShapeId
    }, [hoveredNodeShapeId])

    useEffect(() => {
        const syncHoveredNodeShape = () => {
            const hoveredShapeId = editor.getHoveredShapeId()

            if (hoveredShapeId && parseNodeIdFromShapeId(hoveredShapeId) !== null) {
                setHoveredNodeShapeId((previousShapeId) =>
                    previousShapeId === hoveredShapeId ? previousShapeId : hoveredShapeId,
                )
                return
            }

            /**
             * 体验防抖锁 (Debounce Lock)
             * 当鼠标从卡片内挪到handle时，tldraw 会触发 "unhover" 认为鼠标离开了卡片。
             * 此时 isPointerOverHandleRef 这把锁如果为 true 就阻止 React 销毁handle
             */
            if (isPointerOverHandleRef.current) {
                return
            }

            setHoveredNodeShapeId(null)
        }

        syncHoveredNodeShape()

        const unlisten = editor.store.listen(
            () => {
                syncHoveredNodeShape()

                /**
                 * 触控板滚动/缩放会改变 camera 但 hovered shape 本身不一定变化
                 * 这里额外 bump 一个版本号 强制重算 handle 的屏幕坐标
                 */
                if (hoveredNodeShapeIdRef.current !== null || isPointerOverHandleRef.current) {
                    setOverlayVersion((previousVersion) => previousVersion + 1)
                }
            },
            { scope: "session" },
        )

        return () => {
            unlisten()
        }
    }, [editor])

    useEffect(() => {
        const canvasContainer = editor.getContainer()
        if (typeof ResizeObserver === "undefined") {
            return
        }

        /**
         * 左右栏拖拽会改变画布容器尺寸与偏移
         * 这里监听容器几何变化，确保 handle 坐标基于最新容器边界重算
         */
        const resizeObserver = new ResizeObserver(() => {
            if (hoveredNodeShapeIdRef.current !== null || isPointerOverHandleRef.current) {
                setOverlayVersion((previousVersion) => previousVersion + 1)
            }
        })

        resizeObserver.observe(canvasContainer)
        return () => {
            resizeObserver.disconnect()
        }
    }, [editor])

    const edgeHandlePoints = useMemo(() => {
        if (!hoveredNodeShapeId) {
            return []
        }

        const hoveredBounds = editor.getShapePageBounds(hoveredNodeShapeId)
        if (!hoveredBounds) {
            return []
        }

        const canvasRect = editor.getContainer().getBoundingClientRect()

        return getEdgeHandlePoints(hoveredBounds).map((handlePoint) => {
            /**
             * 1. handlePoint 是 tldraw 无限画布坐标 (Page)
             * 2. pageToScreen 把它压成了显示器屏幕的物理像素坐标 (Screen)
             * 3. 最后减去左侧/右侧面板(Sidebar)挤压导致的 Canvas 容器偏移 (canvasRect.left/top)
             * 得出这个handle在当前 SVG <g> 标签中的纯洁 DOM 像素位置
             */
            const handleScreenPoint = editor.pageToScreen({
                x: handlePoint.x,
                y: handlePoint.y,
            })

            return {
                side: handlePoint.side,
                x: handleScreenPoint.x - canvasRect.left,
                y: handleScreenPoint.y - canvasRect.top,
            }
        })
    }, [editor, hoveredNodeShapeId, overlayVersion])

    if (!isVisible || !hoveredNodeShapeId || edgeHandlePoints.length === 0) {
        return null
    }

    return (
        <svg className="tl-overlays__item pointer-events-none h-full w-full" aria-hidden="true">
            {edgeHandlePoints.map((handlePoint) => (
                <g
                    key={handlePoint.side}
                    className="pointer-events-auto cursor-crosshair"
                    onPointerEnter={() => {
                        isPointerOverHandleRef.current = true
                    }}
                    onPointerLeave={() => {
                        isPointerOverHandleRef.current = false

                        requestAnimationFrame(() => {
                            if (isPointerOverHandleRef.current) {
                                return
                            }

                            const hoveredShapeId = editor.getHoveredShapeId()
                            if (!hoveredShapeId || parseNodeIdFromShapeId(hoveredShapeId) === null) {
                                setHoveredNodeShapeId(null)
                            }
                        })
                    }}
                    onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()

                        onStartLinkDrag({
                            sourceShapeId: hoveredNodeShapeId,
                            side: handlePoint.side,
                            clientX: event.clientX,
                            clientY: event.clientY,
                        })
                    }}
                >
                    <circle
                        cx={handlePoint.x}
                        cy={handlePoint.y}
                        r={HANDLE_RADIUS + 4}
                        className="fill-transparent"
                    />
                    <circle
                        cx={handlePoint.x}
                        cy={handlePoint.y}
                        r={HANDLE_RADIUS}
                        className="fill-sky-500 stroke-background stroke-2"
                    />
                </g>
            ))}
        </svg>
    )
}
