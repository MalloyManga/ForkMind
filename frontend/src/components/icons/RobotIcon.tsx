interface IconProps {
    className?: string
}

/**
 * 机器人图标：卡片内代表「AI Response」的一方
 */
export function RobotIcon({ className }: IconProps) {
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
            <rect x="4.5" y="8" width="15" height="11" rx="3" />
            <path d="M12 8V4.5" />
            <circle cx="12" cy="3.5" r="1.2" fill="currentColor" stroke="none" />
            <path d="M9 13v1.5" />
            <path d="M15 13v1.5" />
            <path d="M2.5 12v3" />
            <path d="M21.5 12v3" />
        </svg>
    )
}
