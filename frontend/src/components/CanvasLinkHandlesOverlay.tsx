import { useEffect, useMemo, useRef, useState } from "react"
import { Box, TLShapeId, useEditor } from "tldraw"
import { LinkHandleSide, StartLinkDragInput } from "../hooks/canvasLinkTypes"
import { parseNodeIdFromShapeId } from "../hooks/canvasNodeIds"

interface CanvasLinkHandlesOverlayProps {
    onStartLinkDrag: (input: StartLinkDragInput) => void
}

interface HandlePoint {
    side: LinkHandleSide
    x: number
    y: number
}

const HANDLE_RADIUS = 6

/**
 * 计算卡片四边的触点坐标。
 * 业务场景：用户 hover 到卡片时，从四个边缘直接拖出连线。
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
 * 画布 hover 触点层。
 * 业务场景：只在鼠标停留到业务卡片时显示四向触点，并且支持鼠标顺滑地从卡片移动到 handle。
 */
export function CanvasLinkHandlesOverlay({ onStartLinkDrag }: CanvasLinkHandlesOverlayProps) {
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
             * 业务场景：鼠标从卡片边缘滑到 handle 时，hover 会短暂掉到 overlay 自己身上。
             * 这里锁住当前卡片，避免 handle 因为 hover 抖动而消失。
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
                 * 业务场景：触控板滚动/缩放会改变 camera，但 hovered shape 本身不一定变化。
                 * 这里额外 bump 一个版本号，强制重算 handle 的屏幕坐标。
                 */
                if (hoveredNodeShapeIdRef.current !== null || isPointerOverHandleRef.current) {
                    setOverlayVersion((previousVersion) => previousVersion + 1)
                }
            },
            { scope: "all" },
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
         * 业务场景：左右栏拖拽会改变画布容器尺寸与偏移。
         * 这里监听容器几何变化，确保 handle 坐标基于最新容器边界重算。
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
             * 业务场景：overlay SVG 使用的是画布容器本地坐标。
             * 所以先把 page 坐标转成 screen 坐标，再减去容器左上角偏移。
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

    if (!hoveredNodeShapeId || edgeHandlePoints.length === 0) {
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
