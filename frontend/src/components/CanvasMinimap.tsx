import { useCallback, useMemo } from "react"
import { type Editor, useEditor, useValue, type Box } from "tldraw"
import { FORK_MIND_CARD_SHAPE_TYPE, type ForkMindCardShape } from "../lib/forkMindCardShape"

const MINIMAP_WIDTH = 176
const MINIMAP_HEIGHT = 116
const MINIMAP_PADDING = 12

interface MinimapItem {
    x: number
    y: number
    w: number
    h: number
    cardType: "chat" | "note"
    isActive: boolean
}

interface MinimapProjection {
    items: MinimapItem[]
    viewport: { x: number; y: number; w: number; h: number }
    scale: number
    offsetX: number
    offsetY: number
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

    const projection = useValue<MinimapProjection | null>(
        "forkmind minimap projection",
        () => projectToMinimap(editor),
        [editor],
    )

    const handleNavigate = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!projection) {
                return
            }

            const rect = event.currentTarget.getBoundingClientRect()
            const localX = event.clientX - rect.left
            const localY = event.clientY - rect.top

            // minimap 局部坐标反解回 page 坐标
            const pageX = (localX - projection.offsetX) / projection.scale
            const pageY = (localY - projection.offsetY) / projection.scale

            editor.centerOnPoint({ x: pageX, y: pageY }, { animation: { duration: 220 } })
        },
        [editor, projection],
    )

    const dotColor = useMemo(
        () => ({
            chat: "rgb(99 102 241)",
            note: "rgb(245 158 11)",
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
                    className="absolute rounded-[3px] border border-sky-500/70 bg-sky-400/10"
                    style={{
                        left: projection.viewport.x,
                        top: projection.viewport.y,
                        width: projection.viewport.w,
                        height: projection.viewport.h,
                    }}
                />
            </div>
        </div>
    )
}
