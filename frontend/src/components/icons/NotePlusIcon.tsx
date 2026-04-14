interface IconProps {
    className?: string
}

/**
 * 创建 Note 节点图标。
 * 业务场景：底部悬浮工具条“新增 Note”按钮。
 */
export function NotePlusIcon({ className }: IconProps) {
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
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
            <path d="M12 12v6" />
            <path d="M9 15h6" />
        </svg>
    )
}
