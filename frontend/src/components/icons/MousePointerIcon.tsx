interface MousePointerIconProps {
    className?: string
}

export function MousePointerIcon({ className }: MousePointerIconProps) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className={className}
            aria-hidden="true"
        >
            <path d="M6.9 3.75a.75.75 0 0 1 .71.18l10.5 10.12a.75.75 0 0 1-.51 1.29h-4.18l1.9 4.15a.75.75 0 0 1-.37.99l-1.9.87a.75.75 0 0 1-.99-.37l-1.98-4.34-2.68 2.5a.75.75 0 0 1-1.26-.55V4.45a.75.75 0 0 1 .46-.7Z" />
        </svg>
    )
}
