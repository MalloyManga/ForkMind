import type { ConversationNodeType } from "../domain/conversation/types"
import { CANVAS_CREATION_REGISTRY } from "./canvasCreationRegistry"

interface CanvasCreationModeBarProps {
    selectedCreationType: ConversationNodeType
    onSelectCreationType: (creationType: ConversationNodeType) => void
}

/**
 * 画布底部创建模式条
 * 用户先选择“当前创建类型” 再通过空白区创建或 handle 拖拽创建同类型卡片
 */
export function CanvasCreationModeBar({
    selectedCreationType,
    onSelectCreationType,
}: CanvasCreationModeBarProps) {
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 shadow-lg backdrop-blur-md theme-dark:border-zinc-700 theme-dark:bg-zinc-900/90">
                {(Object.entries(CANVAS_CREATION_REGISTRY) as Array<
                    [ConversationNodeType, (typeof CANVAS_CREATION_REGISTRY)[ConversationNodeType]]
                >).map(([nodeType, nodeDefinition]) => {
                    const isSelected = selectedCreationType === nodeType

                    return (
                        <button
                            key={nodeType}
                            type="button"
                            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                                isSelected
                                    ? "border-sky-500/70 bg-sky-100 text-sky-900 theme-dark:bg-sky-500/20 theme-dark:text-sky-100"
                                    : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 theme-dark:border-zinc-700 theme-dark:bg-zinc-800 theme-dark:text-zinc-200 theme-dark:hover:border-zinc-600 theme-dark:hover:bg-zinc-700 theme-dark:hover:text-zinc-100"
                            }`}
                            onClick={() => {
                                onSelectCreationType(nodeType)
                            }}
                            title={nodeDefinition.description}
                        >
                            <nodeDefinition.Icon className="h-4 w-4" />
                            {nodeDefinition.label}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

