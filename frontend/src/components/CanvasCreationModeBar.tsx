import { useEffect, useRef, useState, type ReactNode } from "react"
import type { ConversationNodeType } from "../domain/conversation/types"
import { CANVAS_CREATION_REGISTRY } from "./canvasCreationRegistry"
import { ChevronDownIcon } from "./icons/ChevronDownIcon"
import { MousePointerIcon } from "./icons/MousePointerIcon"
import { MoveHandleIcon } from "./icons/MoveHandleIcon"

interface CanvasCreationModeBarProps {
    selectedCreationType: ConversationNodeType
    onSelectCreationType: (creationType: ConversationNodeType) => void
}

type ToolbarToolId = ConversationNodeType | "move" | "hand-tool" | "tool-variants"

interface FloatingToolHintProps {
    label: string
    shortcut?: string
}

interface ToolButtonShellProps {
    children: ReactNode
    isTooltipVisible: boolean
    tooltipLabel: string
    tooltipShortcut?: string
    onClick?: () => void
    onTooltipIntentStart: () => void
    onTooltipIntentEnd: () => void
    buttonClassName: string
}

/**
 * 当前按钮自己的提示条
 */
function FloatingToolHint({ label, shortcut }: FloatingToolHintProps) {
    return (
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2">
            <div className="flex items-center gap-3 rounded-md border border-zinc-300/80 bg-zinc-200/95 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-zinc-900 shadow-[0_10px_30px_rgba(15,23,42,0.14)] backdrop-blur-xl theme-dark:border-zinc-700/80 theme-dark:bg-zinc-800/95 theme-dark:text-zinc-100 theme-dark:shadow-[0_12px_32px_rgba(0,0,0,0.34)]">
                <span>{label}</span>
                {shortcut ? (
                    <span className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase theme-dark:text-zinc-400">
                        {shortcut}
                    </span>
                ) : null}
            </div>
        </div>
    )
}

/**
 * 单个工具按钮壳
 */
function ToolButtonShell({
    children,
    isTooltipVisible,
    tooltipLabel,
    tooltipShortcut,
    onClick,
    onTooltipIntentStart,
    onTooltipIntentEnd,
    buttonClassName,
}: ToolButtonShellProps) {
    return (
        <div
            className="relative"
            onMouseEnter={onTooltipIntentStart}
            onMouseMove={onTooltipIntentStart}
            onMouseLeave={onTooltipIntentEnd}
        >
            {isTooltipVisible ? (
                <FloatingToolHint
                    label={tooltipLabel}
                    shortcut={tooltipShortcut}
                />
            ) : null}

            <button
                type="button"
                className={buttonClassName}
                onClick={onClick}
            >
                {children}
            </button>
        </div>
    )
}

/**
 * 画布底部创建模式条
 */
export function CanvasCreationModeBar({
    selectedCreationType,
    onSelectCreationType,
}: CanvasCreationModeBarProps) {
    const tooltipDelayTimerRef = useRef<number | null>(null)
    const [isMoveHandlePreview, setIsMoveHandlePreview] = useState(false)
    const [visibleTooltipTool, setVisibleTooltipTool] = useState<ToolbarToolId | null>(null)

    const clearTooltipDelayTimer = () => {
        if (tooltipDelayTimerRef.current !== null) {
            window.clearTimeout(tooltipDelayTimerRef.current)
            tooltipDelayTimerRef.current = null
        }
    }

    const startTooltipIntent = (toolId: ToolbarToolId) => {
        if (visibleTooltipTool === toolId) {
            return
        }

        clearTooltipDelayTimer()
        tooltipDelayTimerRef.current = window.setTimeout(() => {
            setVisibleTooltipTool(toolId)
            tooltipDelayTimerRef.current = null
        }, 520)
    }

    const endTooltipIntent = () => {
        clearTooltipDelayTimer()
        setVisibleTooltipTool(null)
    }

    const dismissTooltipImmediately = () => {
        clearTooltipDelayTimer()
        setVisibleTooltipTool(null)
    }

    useEffect(() => {
        return () => {
            clearTooltipDelayTimer()
        }
    }, [])

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center">
            <div className="pointer-events-auto relative flex items-center gap-1 rounded-2xl border border-zinc-300/70 bg-white/92 p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl theme-dark:border-zinc-700/80 theme-dark:bg-zinc-900/92 theme-dark:shadow-[0_18px_48px_rgba(0,0,0,0.35)]">
                <div className="flex items-center rounded-xl bg-zinc-100/90 p-0.5 theme-dark:bg-zinc-800/90">
                    <ToolButtonShell
                        isTooltipVisible={visibleTooltipTool === (isMoveHandlePreview ? "hand-tool" : "move")}
                        tooltipLabel={isMoveHandlePreview ? "Hand tool" : "Move"}
                        tooltipShortcut="X"
                        onTooltipIntentStart={() => {
                            startTooltipIntent(isMoveHandlePreview ? "hand-tool" : "move")
                        }}
                        onTooltipIntentEnd={endTooltipIntent}
                        buttonClassName="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-zinc-700 transition-all hover:bg-white hover:text-zinc-950 theme-dark:text-zinc-200 theme-dark:hover:bg-zinc-700 theme-dark:hover:text-zinc-50"
                    >
                        {isMoveHandlePreview ? (
                            <MoveHandleIcon className="size-4.5" />
                        ) : (
                            <MousePointerIcon className="size-4.5" />
                        )}
                    </ToolButtonShell>

                    <ToolButtonShell
                        isTooltipVisible={visibleTooltipTool === "tool-variants"}
                        tooltipLabel="Move tools"
                        tooltipShortcut={undefined}
                        onClick={() => {
                            dismissTooltipImmediately()
                            setIsMoveHandlePreview((currentPreviewState) => !currentPreviewState)
                        }}
                        onTooltipIntentStart={() => {
                            startTooltipIntent("tool-variants")
                        }}
                        onTooltipIntentEnd={endTooltipIntent}
                        buttonClassName="inline-flex h-9 w-4 items-center justify-center rounded-[10px] text-zinc-500 transition-all hover:bg-white hover:text-zinc-900 theme-dark:text-zinc-400 theme-dark:hover:bg-zinc-700 theme-dark:hover:text-zinc-100"
                    >
                        <ChevronDownIcon className="size-3" />
                    </ToolButtonShell>
                </div>

                <div className="mx-1 h-6 w-px bg-zinc-200 theme-dark:bg-zinc-700" />

                {(Object.entries(CANVAS_CREATION_REGISTRY) as Array<
                    [ConversationNodeType, (typeof CANVAS_CREATION_REGISTRY)[ConversationNodeType]]
                >).map(([nodeType, nodeDefinition]) => {
                    const isSelected = selectedCreationType === nodeType

                    return (
                        <ToolButtonShell
                            key={nodeType}
                            isTooltipVisible={visibleTooltipTool === nodeType}
                            tooltipLabel={nodeDefinition.tooltip}
                            tooltipShortcut="X"
                            onClick={() => {
                                dismissTooltipImmediately()
                                onSelectCreationType(nodeType)
                            }}
                            onTooltipIntentStart={() => {
                                startTooltipIntent(nodeType)
                            }}
                            onTooltipIntentEnd={endTooltipIntent}
                            buttonClassName={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-medium transition-all ${isSelected
                                    ? "bg-sky-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_18px_rgba(14,165,233,0.32)] theme-dark:bg-sky-500 theme-dark:text-white"
                                    : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 theme-dark:text-zinc-200 theme-dark:hover:bg-zinc-800 theme-dark:hover:text-zinc-50"
                                }`}
                        >
                            <nodeDefinition.Icon className="h-4 w-4" />
                        </ToolButtonShell>
                    )
                })}
            </div>
        </div>
    )
}
