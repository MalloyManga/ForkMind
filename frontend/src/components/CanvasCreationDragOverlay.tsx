interface CanvasCreationDragOverlayProps {
    previewRect: {
        x: number
        y: number
        width: number
        height: number
    } | null
}

/**
 * 卡片创建拖拽预览框
 * 当用户处于 Chat / Note 创建工具并在画布上拖拽时
 * 用这层蓝色边框即时反馈“即将创建的卡片尺寸” 贴近 Figma 的矩形创建手感
 */
export function CanvasCreationDragOverlay({
    previewRect,
}: CanvasCreationDragOverlayProps) {
    if (!previewRect) {
        return null
    }

    return (
        <div className="pointer-events-none absolute inset-0 z-30">
            <div
                className="absolute border-2 border-sky-500 bg-sky-500/10 shadow-[0_0_0_1px_rgba(14,165,233,0.16)]"
                style={{
                    left: previewRect.x,
                    top: previewRect.y,
                    width: previewRect.width,
                    height: previewRect.height,
                }}
            />
        </div>
    )
}
