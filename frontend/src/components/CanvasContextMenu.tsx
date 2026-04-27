import { useEffect, useRef } from "react"
import type { CanvasContextMenuItem } from "../hooks/canvasContextMenuTypes"
import type { Point } from "@/hooks/useCanvasBridge.helpers"

interface CanvasContextMenuProps {
    items: CanvasContextMenuItem[]
    position: Point
    onClose: () => void
    onSelect: (item: CanvasContextMenuItem) => void
}

/**
 * 自定义右键菜单弹层
 */
export function CanvasContextMenu({
    items,
    position,
    onClose,
    onSelect,
}: CanvasContextMenuProps) {
    const menuHostRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            // 点击菜单外部时 关闭本次菜单浮层
            if (menuHostRef.current?.contains(event.target as Node)) {
                return
            }

            onClose()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            // Esc 是右键菜单最基础的退出手势
            if (event.key !== "Escape") {
                return
            }

            event.preventDefault()
            onClose()
        }

        window.addEventListener("pointerdown", handlePointerDown, true)
        window.addEventListener("keydown", handleKeyDown, true)
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown, true)
            window.removeEventListener("keydown", handleKeyDown, true)
        }
    }, [onClose])

    return (
        <div
            ref={menuHostRef}
            className="fixed z-50 min-w-52 overflow-hidden rounded-xl border border-zinc-300/80 bg-white/96 p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.18)] backdrop-blur-xl theme-dark:border-zinc-700/80 theme-dark:bg-zinc-900/96 theme-dark:shadow-[0_20px_56px_rgba(0,0,0,0.4)]"
            style={{
                // 菜单位置直接使用右键时的屏幕坐标 这样不会和画布缩放发生二次换算误差
                left: position.x,
                top: position.y,
            }}
            role="menu"
            onContextMenu={(event) => {
                // 菜单自身再次右键时 不要弹浏览器默认菜单
                event.preventDefault()
            }}
        >
            {items.map((item) => (
                <button
                    key={item.commandId}
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-zinc-800 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45 theme-dark:text-zinc-100 theme-dark:hover:bg-zinc-800"
                    disabled={item.disabled}
                    onClick={() => {
                        // 点击某个命令项时 让上层统一分发到 executor 执行
                        onSelect(item)
                    }}
                    role="menuitem"
                >
                    <span>{item.label}</span>
                    {item.shortcut ? (
                        <span className="ml-4 text-[11px] font-medium tracking-[0.08em] text-zinc-500 theme-dark:text-zinc-400">
                            {item.shortcut}
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    )
}
