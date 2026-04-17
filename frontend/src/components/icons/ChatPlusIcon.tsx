interface IconProps {
    className?: string
}

/**
 * 创建 Chat 节点图标
 */
export function ChatPlusIcon({ className }: IconProps) {
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
            <path d="M20 11.5A8.5 8.5 0 0 1 8.5 20H4l1.9-3.8A8.5 8.5 0 1 1 20 11.5Z" />
            <path d="M12 8v7" />
            <path d="M8.5 11.5h7" />
        </svg>
    )
}
