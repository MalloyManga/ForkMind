interface PanelsToggleIconProps {
    className?: string
}

export function PanelsToggleIcon({ className }: PanelsToggleIconProps) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
            <path d="M8.5 5v14" />
            <path d="M15.5 5v14" />
        </svg>
    )
}
