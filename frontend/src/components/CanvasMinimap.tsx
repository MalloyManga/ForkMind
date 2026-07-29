import {
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useMemo,
    useRef,
} from "react"
import { type Editor, useEditor, useValue, type Box } from "tldraw"
import { FORK_MIND_CARD_SHAPE_TYPE, type ForkMindCardShape } from "../lib/forkMindCardShape"
import type { ConversationNodeType } from "../domain/conversation/types"

const MINIMAP_WIDTH = 176
const MINIMAP_HEIGHT = 116
const MINIMAP_PADDING = 12

interface MinimapItem {
    x: number
    y: number
    w: number
    h: number
    cardType: ConversationNodeType
    isActive: boolean
}

interface MinimapProjection {
    items: MinimapItem[]
    viewport: { x: number; y: number; w: number; h: number }
    scale: number
    offsetX: number
    offsetY: number
}

interface MinimapViewportDragSession {
    pointerId: number
    pointerOffsetX: number
    pointerOffsetY: number
}

/**
 * 把画布 page 坐标投影到 minimap 局部坐标：所有卡片 + 当前视口一起参与包围盒计算，
 * 保证缩略图永远能框住「全部内容」和「你正看的地方」。
 */
function projectToMinimap(editor: Editor): MinimapProjection | null {
    const cardShapes = editor
        .getCurrentPageShapes()
        .filter((shape): shape is ForkMindCardShape => shape.type === FORK_MIND_CARD_SHAPE_TYPE)

    if (cardShapes.length === 0) {
        return null
    }

    const activeShapeIds = new Set(editor.getSelectedShapeIds())
    const viewportBounds: Box = editor.getViewportPageBounds()

    const rawItems = cardShapes.map((shape) => {
        const bounds = editor.getShapePageBounds(shape.id)
        return {
            x: bounds?.x ?? shape.x,
            y: bounds?.y ?? shape.y,
            w: bounds?.w ?? shape.props.w,
            h: bounds?.h ?? shape.props.h,
            cardType: shape.props.cardType,
            isActive: activeShapeIds.has(shape.id),
        }
    })

    // 内容包围盒 ∪ 视口包围盒
    let minX = viewportBounds.minX
    let minY = viewportBounds.minY
    let maxX = viewportBounds.maxX
    let maxY = viewportBounds.maxY
    for (const item of rawItems) {
        minX = Math.min(minX, item.x)
        minY = Math.min(minY, item.y)
        maxX = Math.max(maxX, item.x + item.w)
        maxY = Math.max(maxY, item.y + item.h)
    }

    const contentWidth = Math.max(maxX - minX, 1)
    const contentHeight = Math.max(maxY - minY, 1)
    const usableWidth = MINIMAP_WIDTH - MINIMAP_PADDING * 2
    const usableHeight = MINIMAP_HEIGHT - MINIMAP_PADDING * 2
    const scale = Math.min(usableWidth / contentWidth, usableHeight / contentHeight)

    // 居中留白
    const offsetX = MINIMAP_PADDING + (usableWidth - contentWidth * scale) / 2
    const offsetY = MINIMAP_PADDING + (usableHeight - contentHeight * scale) / 2

    const toLocal = (px: number, py: number) => ({
        x: (px - minX) * scale + offsetX,
        y: (py - minY) * scale + offsetY,
    })

    const items = rawItems.map((item) => {
        const topLeft = toLocal(item.x, item.y)
        return {
            x: topLeft.x,
            y: topLeft.y,
            w: Math.max(item.w * scale, 3),
            h: Math.max(item.h * scale, 3),
            cardType: item.cardType,
            isActive: item.isActive,
        }
    })

    const viewportTopLeft = toLocal(viewportBounds.minX, viewportBounds.minY)

    return {
        items,
        viewport: {
            x: viewportTopLeft.x,
            y: viewportTopLeft.y,
            w: viewportBounds.width * scale,
            h: viewportBounds.height * scale,
        },
        scale,
        offsetX: offsetX - minX * scale,
        offsetY: offsetY - minY * scale,
    }
}

/**
 * 画布右下角缩略导航图：概览全部卡片，点击任意位置即把画布视口平移过去。
 */
export function CanvasMinimap() {
    const editor = useEditor()
    const viewportDragSessionRef = useRef<MinimapViewportDragSession | null>(null)
    const suppressNextClickRef = useRef(false)

    const projection = useValue<MinimapProjection | null>(
        "forkmind minimap projection",
        () => projectToMinimap(editor),
        [editor],
    )

    /**
     * 把 minimap 局部坐标立即转换成画布视口中心
     * @param localX 入参来自 minimap 内 pointer 或 click 的水平坐标
     * @param localY 入参来自 minimap 内 pointer 或 click 的垂直坐标
     * @returns 无返回值 projection 不可用时不改变 camera
     * 用户点击缩略图或拖拽视口框时触发 不使用动画以避免跟手延迟
     */
    const navigateToLocalPoint = useCallback((localX: number, localY: number) => {
        if (!projection) {
            return
        }

        const pageX = (localX - projection.offsetX) / projection.scale
        const pageY = (localY - projection.offsetY) / projection.scale
        editor.centerOnPoint({ x: pageX, y: pageY })
    }, [editor, projection])

    const handleNavigate = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            if (!projection) {
                return
            }
            if (suppressNextClickRef.current) {
                suppressNextClickRef.current = false
                return
            }

            const rect = event.currentTarget.getBoundingClientRect()
            const localX = event.clientX - rect.left
            const localY = event.clientY - rect.top
            navigateToLocalPoint(localX, localY)
        },
        [navigateToLocalPoint, projection],
    )

    /**
     * 建立 minimap 视口框拖拽会话
     * @param event 入参来自当前视口框 pointerdown 用于记录指针 id 与抓取点偏移
     * @returns 无返回值 projection 不可用时不建立会话
     * 用户直接抓住右下角视口框时触发 并阻止事件落到 tldraw 画布
     */
    const startViewportDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (!projection) {
            return
        }

        const minimapElement = event.currentTarget.parentElement
        if (!minimapElement) {
            return
        }

        const minimapRect = minimapElement.getBoundingClientRect()
        const localX = event.clientX - minimapRect.left
        const localY = event.clientY - minimapRect.top
        viewportDragSessionRef.current = {
            pointerId: event.pointerId,
            pointerOffsetX: localX - (projection.viewport.x + projection.viewport.w / 2),
            pointerOffsetY: localY - (projection.viewport.y + projection.viewport.h / 2),
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
        event.stopPropagation()
    }, [projection])

    const updateViewportDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const dragSession = viewportDragSessionRef.current
        const minimapElement = event.currentTarget.parentElement
        if (!dragSession || dragSession.pointerId !== event.pointerId || !minimapElement) {
            return
        }

        const minimapRect = minimapElement.getBoundingClientRect()
        navigateToLocalPoint(
            event.clientX - minimapRect.left - dragSession.pointerOffsetX,
            event.clientY - minimapRect.top - dragSession.pointerOffsetY,
        )
        suppressNextClickRef.current = true
        event.preventDefault()
        event.stopPropagation()
    }, [navigateToLocalPoint])

    const finishViewportDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const dragSession = viewportDragSessionRef.current
        if (!dragSession || dragSession.pointerId !== event.pointerId) {
            return
        }

        viewportDragSessionRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        suppressNextClickRef.current = event.type === "pointerup"
        event.preventDefault()
        event.stopPropagation()
    }, [])

    const dotColor = useMemo<Record<ConversationNodeType, string>>(
        () => ({
            chat: "rgb(99 102 241)",
            note: "rgb(245 158 11)",
            image: "rgb(34 211 238)",
            link: "rgb(52 211 153)",
            file: "rgb(217 70 239)",
        }),
        [],
    )

    if (!projection) {
        return null
    }

    return (
        <div className="pointer-events-none absolute bottom-5 right-5 z-20">
            <div
                className="pointer-events-auto relative cursor-pointer overflow-hidden rounded-xl border border-zinc-300/70 bg-white/85 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.28)] backdrop-blur-xl transition-colors hover:border-zinc-400/70 theme-dark:border-zinc-700/70 theme-dark:bg-zinc-900/80 theme-dark:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] theme-dark:hover:border-zinc-600/70"
                style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
                onClick={handleNavigate}
                role="img"
                aria-label="画布缩略导航图"
            >
                {/* 卡片小方块 */}
                {projection.items.map((item, index) => (
                    <div
                        key={index}
                        className="absolute rounded-[2px] transition-all"
                        style={{
                            left: item.x,
                            top: item.y,
                            width: item.w,
                            height: item.h,
                            backgroundColor: item.isActive ? dotColor[item.cardType] : `${dotColor[item.cardType]}`,
                            opacity: item.isActive ? 1 : 0.45,
                            boxShadow: item.isActive ? `0 0 0 1.5px ${dotColor[item.cardType]}` : "none",
                        }}
                    />
                ))}

                {/* 当前视口框 */}
                <div
                    className="absolute cursor-grab touch-none rounded-[3px] border border-sky-500/80 bg-sky-400/15 active:cursor-grabbing"
                    style={{
                        left: projection.viewport.x,
                        top: projection.viewport.y,
                        width: projection.viewport.w,
                        height: projection.viewport.h,
                    }}
                    onPointerDown={startViewportDrag}
                    onPointerMove={updateViewportDrag}
                    onPointerUp={finishViewportDrag}
                    onPointerCancel={finishViewportDrag}
                />
            </div>
        </div>
    )
}
