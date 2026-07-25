interface IconProps {
    className?: string
}

/**
 * 人形图标：卡片内代表「用户 Prompt」的一方
 */
export function PersonIcon({ className }: IconProps) {
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
            <circle cx="12" cy="7.5" r="3.6" />
            <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
        </svg>
    )
}
