interface IconProps {
    className?: string
}

/**
 * 右侧面板折叠箭头
 * 侧栏标题行的折叠按钮图标
 */
export function ChevronRightIcon({ className }: IconProps) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M9 18L15 12L9 6" />
        </svg>
    )
}
