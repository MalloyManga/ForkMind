interface MoveHandleIconProps {
    className?: string
}

/**
 * 底部创建工具条里“移动画布/拖拽”风格的图标
 * 当前阶段只做视觉切换，后续如果接入真正的 pan 工具，可以继续复用这个图标
 */
export function MoveHandleIcon({ className }: MoveHandleIconProps) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M12 3.5v17" />
            <path d="m8.8 6.7 3.2-3.2 3.2 3.2" />
            <path d="m8.8 17.3 3.2 3.2 3.2-3.2" />
            <path d="M3.5 12h17" />
            <path d="m6.7 8.8-3.2 3.2 3.2 3.2" />
            <path d="m17.3 8.8 3.2 3.2-3.2 3.2" />
        </svg>
    )
}
