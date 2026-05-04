import { useEffect, useRef, useState } from "react"
import { PanelsToggleIcon } from "./icons/PanelsToggleIcon"

interface PanelsToggleButtonProps {
    isMinimized: boolean
    onToggle: () => void
}

const PANELS_TOGGLE_SHORTCUT = "Ctrl Shift \\"
const PANELS_TOGGLE_TOOLTIP_DELAY = 520

function PanelsToggleHint({
    label,
    shortcut,
}: {
    label: string
    shortcut: string
}) {
    return (
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-3 -translate-x-1/2">
            <div className="relative flex items-center gap-3 rounded-lg border border-zinc-300/80 bg-zinc-200/95 px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap text-zinc-900 shadow-[0_10px_30px_rgba(15,23,42,0.14)] backdrop-blur-xl theme-dark:border-zinc-700/80 theme-dark:bg-zinc-800/95 theme-dark:text-zinc-100 theme-dark:shadow-[0_12px_32px_rgba(0,0,0,0.34)]">
                <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-l border-t border-zinc-300/80 bg-zinc-200/95 theme-dark:border-zinc-700/80 theme-dark:bg-zinc-800/95" />
                <span>{label}</span>
                <span className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase theme-dark:text-zinc-400">
                    {shortcut}
                </span>
            </div>
        </div>
    )
}

/**
 * 左侧栏与最小化悬浮栏共用的 UI 显示切换按钮
 */
export function PanelsToggleButton({ isMinimized, onToggle }: PanelsToggleButtonProps) {
    const tooltipDelayTimerRef = useRef<number | null>(null)
    const [isTooltipVisible, setIsTooltipVisible] = useState(false)

    const clearTooltipDelayTimer = () => {
        if (tooltipDelayTimerRef.current !== null) {
            window.clearTimeout(tooltipDelayTimerRef.current)
            tooltipDelayTimerRef.current = null
        }
    }

    const startTooltipIntent = () => {
        if (isTooltipVisible) {
            return
        }

        clearTooltipDelayTimer()
        tooltipDelayTimerRef.current = window.setTimeout(() => {
            setIsTooltipVisible(true)
            tooltipDelayTimerRef.current = null
        }, PANELS_TOGGLE_TOOLTIP_DELAY)
    }

    const endTooltipIntent = () => {
        clearTooltipDelayTimer()
        setIsTooltipVisible(false)
    }

    useEffect(() => {
        return () => {
            clearTooltipDelayTimer()
        }
    }, [])

    return (
        <div
            className="relative"
            onMouseEnter={startTooltipIntent}
            onMouseMove={startTooltipIntent}
            onMouseLeave={endTooltipIntent}
        >
            {isTooltipVisible ? (
                <PanelsToggleHint
                    label={isMinimized ? "Expand UI" : "Minimize UI"}
                    shortcut={PANELS_TOGGLE_SHORTCUT}
                />
            ) : null}

            <button
                type="button"
                className="rounded-md p-1.5 text-foreground transition-colors hover:bg-accent"
                onClick={() => {
                    endTooltipIntent()
                    onToggle()
                }}
                aria-label={isMinimized ? "Expand UI" : "Minimize UI"}
            >
                <PanelsToggleIcon className="h-4 w-4" />
            </button>
        </div>
    )
}
