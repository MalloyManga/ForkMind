import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react"
import { CanvasWorkspace } from "./components/CanvasWorkspace"
import { LeftConversationSidebar } from "./components/LeftConversationSidebar"
import { RightEditorSidebar } from "./components/RightEditorSidebar"
import { PanelsToggleIcon } from "./components/icons/PanelsToggleIcon"
import type { CanvasTool } from "./hooks/canvasToolTypes"
import { useCanvasBridge } from "./hooks/useCanvasBridge"
import {
    selectActiveNode,
    selectActiveNodeId,
    selectActiveThreadCards,
    useConversationStore,
} from "./stores/useConversationStore"

type ThemeMode = "dark" | "light"

interface ResizeDragState {
    side: "left" | "right"
    startX: number
    startWidth: number
}

const LEFT_SIDEBAR_MIN_WIDTH = 240
const LEFT_SIDEBAR_MAX_WIDTH = 420
const RIGHT_SIDEBAR_MIN_WIDTH = 320
const RIGHT_SIDEBAR_MAX_WIDTH = 620

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

function App() {
    const [themeMode, setThemeMode] = useState<ThemeMode>("dark")
    const [areSidebarsHidden, setAreSidebarsHidden] = useState(false)
    const [currentCanvasTool, setCurrentCanvasTool] = useState<CanvasTool>("chat")

    const [leftSidebarWidth, setLeftSidebarWidth] = useState(288)
    const [rightSidebarWidth, setRightSidebarWidth] = useState(420)

    const resizeDragStateRef = useRef<ResizeDragState | null>(null)
    const leftSidebarHostRef = useRef<HTMLDivElement | null>(null)
    const rightSidebarHostRef = useRef<HTMLDivElement | null>(null)
    const leftSidebarWidthRef = useRef(leftSidebarWidth)
    const rightSidebarWidthRef = useRef(rightSidebarWidth)

    const activeThread = useConversationStore((state) => state.activeThread)
    const cards = useConversationStore(selectActiveThreadCards)
    const activeNodeId = useConversationStore(selectActiveNodeId)
    const activeNode = useConversationStore(selectActiveNode)

    const setActiveNodeId = useConversationStore((state) => state.setActiveNodeId)
    const addChatNode = useConversationStore((state) => state.addChatNode)
    const addNoteNode = useConversationStore((state) => state.addNoteNode)
    const deleteNodes = useConversationStore((state) => state.deleteNodes)
    const moveNode = useConversationStore((state) => state.moveNode)
    const setNodeParent = useConversationStore((state) => state.setNodeParent)
    const setNodeReferences = useConversationStore((state) => state.setNodeReferences)
    const updateChatPrompt = useConversationStore((state) => state.updateChatPrompt)
    const updateChatResponse = useConversationStore((state) => state.updateChatResponse)
    const updateNoteContent = useConversationStore((state) => state.updateNoteContent)
    const undo = useConversationStore((state) => state.undo)
    const redo = useConversationStore((state) => state.redo)

    const rootNodeCount = useMemo(
        () => cards.filter((card) => card.parentId === null).length,
        [cards],
    )


    const applySidebarWidth = (side: ResizeDragState["side"], nextWidth: number) => {
        if (side === "left") {
            leftSidebarWidthRef.current = nextWidth
            if (leftSidebarHostRef.current) {
                leftSidebarHostRef.current.style.width = `${nextWidth}px`
            }
            return
        }

        rightSidebarWidthRef.current = nextWidth
        if (rightSidebarHostRef.current) {
            rightSidebarHostRef.current.style.width = `${nextWidth}px`
        }
    }

    const { handleCanvasMount, handleLinkHandlePointerDown } = useCanvasBridge({
        cards,
        activeNodeId,
        setActiveNodeId,
        currentCanvasTool,
        addChatNode,
        addNoteNode,
        moveNode,
        setNodeParent,
        setNodeReferences,
        deleteNodes,
        undo,
        redo,
    })

    /**
     * 拖拽缩放左侧栏。
     */
    const startResizeLeftSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault()

        resizeDragStateRef.current = {
            side: "left",
            startX: event.clientX,
            startWidth: leftSidebarWidthRef.current,
        }

        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
    }

    /**
     * 拖拽缩放右侧栏。
     */
    const startResizeRightSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault()

        resizeDragStateRef.current = {
            side: "right",
            startX: event.clientX,
            startWidth: rightSidebarWidthRef.current,
        }

        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
    }

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const resizeState = resizeDragStateRef.current
            if (!resizeState) {
                return
            }

            if (resizeState.side === "left") {
                const nextWidth = clamp(
                    resizeState.startWidth + (event.clientX - resizeState.startX),
                    LEFT_SIDEBAR_MIN_WIDTH,
                    LEFT_SIDEBAR_MAX_WIDTH,
                )
                applySidebarWidth("left", nextWidth)
                return
            }

            const nextWidth = clamp(
                resizeState.startWidth - (event.clientX - resizeState.startX),
                RIGHT_SIDEBAR_MIN_WIDTH,
                RIGHT_SIDEBAR_MAX_WIDTH,
            )
            applySidebarWidth("right", nextWidth)
        }

        const handlePointerUp = () => {
            const resizeState = resizeDragStateRef.current
            if (!resizeState) {
                return
            }

            if (resizeState.side === "left") {
                setLeftSidebarWidth(leftSidebarWidthRef.current)
            } else {
                setRightSidebarWidth(rightSidebarWidthRef.current)
            }

            resizeDragStateRef.current = null
            document.body.style.removeProperty("cursor")
            document.body.style.removeProperty("user-select")
        }

        window.addEventListener("pointermove", handlePointerMove, true)
        window.addEventListener("pointerup", handlePointerUp, true)

        return () => {
            window.removeEventListener("pointermove", handlePointerMove, true)
            window.removeEventListener("pointerup", handlePointerUp, true)
            document.body.style.removeProperty("cursor")
            document.body.style.removeProperty("user-select")
        }
    }, [])

    useEffect(() => {
        leftSidebarWidthRef.current = leftSidebarWidth
        if (leftSidebarHostRef.current) {
            leftSidebarHostRef.current.style.width = `${leftSidebarWidth}px`
        }
    }, [leftSidebarWidth])

    useEffect(() => {
        rightSidebarWidthRef.current = rightSidebarWidth
        if (rightSidebarHostRef.current) {
            rightSidebarHostRef.current.style.width = `${rightSidebarWidth}px`
        }
    }, [rightSidebarWidth])

    const tldrawLicenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY as string | undefined

    return (
        <div
            data-theme={themeMode}
            className={`h-screen w-screen overflow-hidden bg-zinc-100 text-zinc-900 theme-dark:bg-zinc-950 theme-dark:text-zinc-100 ${themeMode === "dark" ? "dark" : ""
                }`}
        >
            {areSidebarsHidden ? (
                <div className="pointer-events-none absolute left-4 top-4 z-40">
                    <div className="pointer-events-auto inline-flex items-center gap-3 rounded-xl border border-border/70 bg-background/92 px-3 py-2 shadow-lg backdrop-blur-md transition-all duration-200">
                        <div className="max-w-56 truncate text-sm font-medium">{activeThread.title}</div>
                        <button
                            type="button"
                            className="rounded-md p-1.5 text-foreground transition-colors hover:bg-accent"
                            onClick={() => {
                                setAreSidebarsHidden(false)
                            }}
                            aria-label="显示界面栏"
                        >
                            <PanelsToggleIcon className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            ) : null}

            <div className="flex h-full w-full overflow-hidden">
                {!areSidebarsHidden ? (
                    <div
                        ref={leftSidebarHostRef}
                        className="h-full shrink-0 overflow-hidden"
                        style={{ width: leftSidebarWidth }}
                    >
                        <LeftConversationSidebar
                            threadTitle={activeThread.title}
                            cardCount={cards.length}
                            rootNodeCount={rootNodeCount}
                            themeMode={themeMode}
                            onTogglePanels={() => {
                                setAreSidebarsHidden(true)
                            }}
                            onToggleTheme={() => {
                                setThemeMode((prevMode) => (prevMode === "dark" ? "light" : "dark"))
                            }}
                        />
                    </div>
                ) : null}

                {!areSidebarsHidden ? (
                    <div
                        className="w-1.5 shrink-0 cursor-col-resize bg-border/80 transition-colors hover:bg-border"
                        onPointerDown={startResizeLeftSidebar}
                        role="separator"
                        aria-label="调整左侧栏宽度"
                    />
                ) : null}

                <CanvasWorkspace
                    onCanvasMount={handleCanvasMount}
                    onStartLinkDrag={handleLinkHandlePointerDown}
                    currentCanvasTool={currentCanvasTool}
                    onSelectCanvasTool={setCurrentCanvasTool}
                    licenseKey={tldrawLicenseKey}
                />

                {!areSidebarsHidden ? (
                    <div
                        className="w-1.5 shrink-0 cursor-col-resize bg-border/80 transition-colors hover:bg-border"
                        onPointerDown={startResizeRightSidebar}
                        role="separator"
                        aria-label="调整右侧栏宽度"
                    />
                ) : null}

                {!areSidebarsHidden ? (
                    <div
                        ref={rightSidebarHostRef}
                        className="h-full shrink-0 overflow-hidden"
                        style={{ width: rightSidebarWidth }}
                    >
                        <RightEditorSidebar
                            activeNode={activeNode}
                            onUpdateChatPrompt={updateChatPrompt}
                            onUpdateChatResponse={updateChatResponse}
                            onUpdateNoteContent={updateNoteContent}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    )
}

export default App
