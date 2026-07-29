import {
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"
import { GitFork } from "lucide-react"
import type { Editor } from "tldraw"
import { CanvasContextMenu } from "./components/CanvasContextMenu"
import { AISettingsSheet } from "./components/AISettingsSheet"
import type { CanvasClipboardPayload } from "./stores/conversationStore"
import { CanvasWorkspace } from "./components/CanvasWorkspace"
import { LeftConversationSidebar } from "./components/LeftConversationSidebar"
import { PanelsToggleButton } from "./components/PanelsToggleButton"
import { RightEditorSidebar } from "./components/RightEditorSidebar"
import {
    DEFAULT_LEFT_SIDEBAR_WIDTH,
    DEFAULT_RIGHT_SIDEBAR_WIDTH,
    LEFT_SIDEBAR_MAX_WIDTH,
    LEFT_SIDEBAR_MIN_WIDTH,
    RIGHT_SIDEBAR_MAX_WIDTH,
    RIGHT_SIDEBAR_MIN_WIDTH,
} from "./constants/layout"
import {
    resolveCanvasCommandByKeyboardEvent,
    resolveCanvasToolByCommand,
} from "./hooks/canvasCommands"
import type {
    CanvasContextMenuContext,
    CanvasContextMenuItem,
} from "./hooks/canvasContextMenuTypes"
import { useCanvasBridge } from "./hooks/useCanvasBridge"
import { useCanvasContextMenuExecutor } from "./hooks/useCanvasContextMenuExecutor"
import { useCanvasContextMenuResolver } from "./hooks/useCanvasContextMenuResolver"
import { useAICompletion } from "./hooks/useAICompletion"
import { type CanvasTool } from "./hooks/canvasToolTypes"
import { useWorkspaceController } from "./hooks/useWorkspaceController"
import { useWorkspacePersistence } from "./hooks/useWorkspacePersistence"
import { useWorkspaceTransfer } from "./hooks/useWorkspaceTransfer"
import { buildRootNodesWarningMessage } from "./domain/conversation/rules"
import {
    CANVAS_CARD_ACTIVATE_EVENT,
    CANVAS_TEXT_SELECTION_EVENT,
    type CanvasCardActivateEventDetail,
    type CanvasTextSelectionEventDetail,
} from "./domain/conversation/textSelection"
import type { ConversationTextAnchor } from "./domain/conversation/types"
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

interface CanvasContextMenuState {
    context: CanvasContextMenuContext
    items: CanvasContextMenuItem[]
}

interface CanvasTextSelectionState extends CanvasTextSelectionEventDetail {}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

function isTextEditingTarget(eventTarget: EventTarget | null): boolean {
    if (!(eventTarget instanceof HTMLElement)) {
        return false
    }

    const tagName = eventTarget.tagName.toLowerCase()
    return tagName === "textarea" || tagName === "input" || eventTarget.isContentEditable
}

function App() {
    const [themeMode, setThemeMode] = useState<ThemeMode>("dark")
    const [areSidebarsHidden, setAreSidebarsHidden] = useState(false)
    const [isCanvasUiHidden, setIsCanvasUiHidden] = useState(false) // 所有UI均隐藏的状态源
    const [currentCanvasTool, setCurrentCanvasTool] = useState<CanvasTool>("move") // 全局 canvasTool 唯一状态源
    const [canvasEditor, setCanvasEditor] = useState<Editor | null>(null)
    const [clipboardPayload, setClipboardPayload] = useState<CanvasClipboardPayload | null>(null) // 当前页面级剪贴板 payload
    const [contextMenuState, setContextMenuState] = useState<CanvasContextMenuState | null>(null)
    const [isAISettingsOpen, setIsAISettingsOpen] = useState(false)
    const [canvasTextSelection, setCanvasTextSelection] = useState<CanvasTextSelectionState | null>(null)

    const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH)
    const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH)

    const resizeDragStateRef = useRef<ResizeDragState | null>(null)
    const leftSidebarHostRef = useRef<HTMLDivElement | null>(null)
    const rightSidebarHostRef = useRef<HTMLDivElement | null>(null)
    const leftSidebarWidthRef = useRef(leftSidebarWidth)
    const rightSidebarWidthRef = useRef(rightSidebarWidth)

    const activeThread = useConversationStore((state) => state.activeThread)
    const cards = useConversationStore(selectActiveThreadCards)
    const activeNodeId = useConversationStore(selectActiveNodeId)
    const activeNode = useConversationStore(selectActiveNode)
    const {
        threads,
        activeThreadId,
        createThread,
        switchThread,
        renameThread,
        deleteThread,
    } = useWorkspaceController()
    const workspacePersistence = useWorkspacePersistence()
    const workspaceTransfer = useWorkspaceTransfer()
    const aiCompletion = useAICompletion()

    const setActiveNodeId = useConversationStore((state) => state.setActiveNodeId)
    const addNode = useConversationStore((state) => state.addNode)
    const forkChatNode = useConversationStore((state) => state.forkChatNode)
    const deleteNodes = useConversationStore((state) => state.deleteNodes)
    const moveNode = useConversationStore((state) => state.moveNode)
    const resizeNode = useConversationStore((state) => state.resizeNode)
    const setNodeParent = useConversationStore((state) => state.setNodeParent)
    const setNodeReferences = useConversationStore((state) => state.setNodeReferences)
    const updateChatPrompt = useConversationStore((state) => state.updateChatPrompt)
    const updateChatResponse = useConversationStore((state) => state.updateChatResponse)
    const updateNoteContent = useConversationStore((state) => state.updateNoteContent)
    const beginTextEdit = useConversationStore((state) => state.beginTextEdit)
    const endTextEdit = useConversationStore((state) => state.endTextEdit)
    const pasteNodesFromClipboard = useConversationStore((state) => state.pasteNodesFromClipboard)
    const replaceNodesFromClipboard = useConversationStore((state) => state.replaceNodesFromClipboard)
    const undo = useConversationStore((state) => state.undo)
    const redo = useConversationStore((state) => state.redo)

    const rootNodeCount = useMemo(
        // 左侧栏的根节点统计和提醒都依赖这里的结果
        () => cards.filter((card) => card.parentId === null).length,
        [cards],
    )
    const rootNodeWarning = useMemo(
        () => buildRootNodesWarningMessage(cards),
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

    // 挂载 bridge 层业务 这一层负责 store 和 tldraw 的双向翻译
    const {
        handleCanvasMount: handleBridgeCanvasMount,
        handleLinkHandlePointerDown,
        creationPreviewRect,
    } = useCanvasBridge({
        cards,
        activeNodeId,
        setActiveNodeId,
        currentCanvasTool,
        setCurrentCanvasTool,
        addNode,
        moveNode,
        resizeNode,
        setNodeParent,
        setNodeReferences,
        deleteNodes,
        undo,
        redo,
    })

    // resolver 只负责根据上下文算菜单内容 不做真正业务写入
    const { resolveContextMenuItems } = useCanvasContextMenuResolver({
        clipboardCard: clipboardPayload,
        isCanvasUiHidden,
    })

    // executor 负责真正执行业务命令 键盘和右键菜单最终都汇合到这里
    const { executeCanvasCommand } = useCanvasContextMenuExecutor({
        canvasEditor,
        activeNodeId,
        clipboardPayload,
        setClipboardPayload,
        setIsCanvasUiHidden,
        setAreSidebarsHidden,
        cards,
        pasteNodesFromClipboard,
        replaceNodesFromClipboard,
        setActiveNodeId,
    })

    const closeContextMenu = useCallback(() => {
        setContextMenuState(null)
    }, [])

    const handleForkTextSelection = useCallback((anchor: ConversationTextAnchor) => {
        forkChatNode({
            sourceNodeId: anchor.sourceNodeId,
            sourceAnchor: anchor,
        })
        setCanvasTextSelection(null)
        window.getSelection()?.removeAllRanges()
    }, [forkChatNode])

    const handleAppCanvasMount = useCallback((editor: Editor) => {
        // App 自己留 editor 是为了给右键菜单 executor 提供视口中心和 page 坐标能力
        setCanvasEditor(editor)
        handleBridgeCanvasMount(editor)
    }, [handleBridgeCanvasMount])

    const handleOpenContextMenu = useCallback((context: CanvasContextMenuContext) => {
        // 右键命中卡片时 先把 active 切到这张卡片 这样 Copy 和 Paste to replace 都有稳定目标
        if (context.kind === "node") {
            setActiveNodeId(context.nodeId)
        }

        setContextMenuState({
            context,
            items: resolveContextMenuItems(context),
        })
    }, [resolveContextMenuItems, setActiveNodeId])

    /**
     * 拖拽缩放左侧栏
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
     * 拖拽缩放右侧栏
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

    useEffect(() => {
        const handleCanvasCommandKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing) {
                return
            }

            // 正在输入文本时 不要抢快捷键 否则用户在右侧编辑栏输入 C V N 这类字符会误触发命令
            if (isTextEditingTarget(event.target)) {
                return
            }

            const commandId = resolveCanvasCommandByKeyboardEvent(event)
            if (!commandId) {
                return
            }

            const nextCanvasTool = resolveCanvasToolByCommand(commandId)
            event.preventDefault()
            closeContextMenu()

            if (nextCanvasTool) {
                // 工具类命令和普通业务命令在这里分流
                setCurrentCanvasTool(nextCanvasTool)
                return
            }

            void executeCanvasCommand(commandId)
        }

        window.addEventListener("keydown", handleCanvasCommandKeyDown, true)
        return () => {
            window.removeEventListener("keydown", handleCanvasCommandKeyDown, true)
        }
    }, [closeContextMenu, executeCanvasCommand])

    useEffect(() => {
        const handleCanvasCardActivate = (event: Event) => {
            const customEvent = event as CustomEvent<CanvasCardActivateEventDetail>
            setActiveNodeId(customEvent.detail.nodeId)
        }
        const handleCanvasTextSelection = (event: Event) => {
            const customEvent = event as CustomEvent<CanvasTextSelectionEventDetail>
            setCanvasTextSelection(customEvent.detail)
        }
        const clearCanvasTextSelection = (event: PointerEvent) => {
            const target = event.target
            if (target instanceof Element && target.closest("[data-fm-selection-action='true']")) {
                return
            }
            setCanvasTextSelection(null)
        }

        window.addEventListener(CANVAS_CARD_ACTIVATE_EVENT, handleCanvasCardActivate)
        window.addEventListener(CANVAS_TEXT_SELECTION_EVENT, handleCanvasTextSelection)
        window.addEventListener("pointerdown", clearCanvasTextSelection, true)
        return () => {
            window.removeEventListener(CANVAS_CARD_ACTIVATE_EVENT, handleCanvasCardActivate)
            window.removeEventListener(CANVAS_TEXT_SELECTION_EVENT, handleCanvasTextSelection)
            window.removeEventListener("pointerdown", clearCanvasTextSelection, true)
        }
    }, [setActiveNodeId])

    const tldrawLicenseKey = import.meta.env.VITE_TLDRAW_LICENSE_KEY as string | undefined

    return (
        <div
            data-theme={themeMode}
            className={`h-screen w-screen overflow-hidden bg-zinc-100 text-zinc-900 theme-dark:bg-zinc-950 theme-dark:text-zinc-100 ${themeMode === "dark" ? "dark" : ""}`}>
            {areSidebarsHidden && !isCanvasUiHidden ? (
                <div className="pointer-events-none absolute left-4 top-4 z-40">
                    <div className="pointer-events-auto inline-flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background/80 py-1.5 pl-2 pr-1.5 shadow-[0_8px_32px_-8px_rgba(15,23,42,0.24)] backdrop-blur-xl transition-all duration-200">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
                            <GitFork className="h-3 w-3" strokeWidth={2.4} />
                        </span>
                        <div className="max-w-56 truncate text-sm font-medium">{activeThread.title}</div>
                        <PanelsToggleButton
                            isMinimized={areSidebarsHidden}
                            onToggle={() => {
                                setAreSidebarsHidden(false)
                            }}
                        />
                    </div>
                </div>
            ) : null}

            <div className="flex h-full w-full overflow-hidden">
                {!areSidebarsHidden && !isCanvasUiHidden ? (
                    <div
                        ref={leftSidebarHostRef}
                        className="h-full shrink-0 overflow-visible"
                        style={{ width: leftSidebarWidth }}
                    >
                        <LeftConversationSidebar
                            threadTitle={activeThread.title}
                            cardCount={cards.length}
                            rootNodeCount={rootNodeCount}
                            rootNodeWarning={rootNodeWarning}
                            threads={threads}
                            activeThreadId={activeThreadId}
                            persistenceStatus={workspacePersistence.status}
                            persistenceErrorMessage={workspacePersistence.error?.message ?? null}
                            isThreadManagementDisabled={aiCompletion.isRequestActive}
                            workspaceTransferMessage={workspaceTransfer.message}
                            workspaceTransferErrorMessage={workspaceTransfer.error?.message ?? null}
                            isWorkspaceTransferBusy={workspaceTransfer.isBusy}
                            themeMode={themeMode}
                            panelsToggleControl={
                                <PanelsToggleButton
                                    isMinimized={areSidebarsHidden}
                                    onToggle={() => {
                                        setAreSidebarsHidden(true)
                                    }}
                                />
                            }
                            onCreateThread={() => {
                                createThread()
                            }}
                            onSwitchThread={switchThread}
                            onRenameThread={renameThread}
                            onDeleteThread={deleteThread}
                            onExportWorkspace={() => {
                                void workspaceTransfer.exportWorkspace()
                            }}
                            onImportWorkspace={() => {
                                const shouldReplaceWorkspace = window.confirm(
                                    "导入会替换当前完整工作区 请确认当前内容已经保存或导出",
                                )
                                if (shouldReplaceWorkspace) {
                                    void workspaceTransfer.importWorkspace()
                                }
                            }}
                            onOpenAISettings={() => {
                                setIsAISettingsOpen(true)
                            }}
                            onToggleTheme={() => {
                                setThemeMode((prevMode) => (prevMode === "dark" ? "light" : "dark"))
                            }}
                        />
                    </div>
                ) : null}

                {!areSidebarsHidden && !isCanvasUiHidden ? (
                    <div
                        className="group relative w-px shrink-0 cursor-col-resize bg-zinc-200/70 theme-dark:bg-zinc-800"
                        onPointerDown={startResizeLeftSidebar}
                        role="separator"
                        aria-label="调整左侧栏宽度"
                    >
                        <div className="absolute inset-y-0 -left-1.5 -right-1.5 transition-colors group-hover:bg-sky-400/15" />
                        <div className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-all group-hover:bg-sky-400/80" />
                    </div>
                ) : null}

                <CanvasWorkspace
                    onCanvasMount={handleAppCanvasMount}
                    onStartLinkDrag={handleLinkHandlePointerDown}
                    onOpenContextMenu={handleOpenContextMenu}
                    currentCanvasTool={currentCanvasTool}
                    onSelectCanvasTool={setCurrentCanvasTool}
                    // UI 全隐藏时 画布内部的 hover handle 和 mode bar 也要一起隐藏
                    isCanvasUiVisible={!isCanvasUiHidden}
                    isContextMenuOpen={contextMenuState !== null}
                    creationPreviewRect={creationPreviewRect}
                    licenseKey={tldrawLicenseKey}
                />

                {!areSidebarsHidden && !isCanvasUiHidden ? (
                    <div
                        className="group relative w-px shrink-0 cursor-col-resize bg-zinc-200/70 theme-dark:bg-zinc-800"
                        onPointerDown={startResizeRightSidebar}
                        role="separator"
                        aria-label="调整右侧栏宽度"
                    >
                        <div className="absolute inset-y-0 -left-1.5 -right-1.5 transition-colors group-hover:bg-sky-400/15" />
                        <div className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-all group-hover:bg-sky-400/80" />
                    </div>
                ) : null}

                {!areSidebarsHidden && !isCanvasUiHidden ? (
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
                            onBeginTextEdit={beginTextEdit}
                            onEndTextEdit={endTextEdit}
                            activeAIRequestNodeId={aiCompletion.activeRequestNodeId}
                            canStartAIRequest={
                                activeNode?.cardType === "chat"
                                    ? aiCompletion.canStart(activeNode.id)
                                    : false
                            }
                            aiErrorMessage={aiCompletion.error?.message ?? null}
                            onStartAIRequest={(nodeId) => {
                                void aiCompletion.startCompletion(nodeId)
                            }}
                            onCancelAIRequest={(nodeId) => {
                                void aiCompletion.cancelCompletion(nodeId)
                            }}
                            onForkTextSelection={handleForkTextSelection}
                        />
                    </div>
                ) : null}
            </div>

            {contextMenuState ? (
                <CanvasContextMenu
                    items={contextMenuState.items}
                    position={contextMenuState.context.screenPoint}
                    onClose={closeContextMenu}
                    onSelect={(item) => {
                        // 右键菜单按钮只负责把命令抛给 executor 自己不直接碰 store
                        void executeCanvasCommand(item.commandId, contextMenuState.context)
                        closeContextMenu()
                    }}
                />
            ) : null}

            {canvasTextSelection ? (
                <button
                    type="button"
                    data-fm-selection-action="true"
                    className="fixed z-50 inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-background/95 px-2.5 py-1.5 text-xs font-medium text-sky-600 shadow-xl backdrop-blur theme-dark:text-sky-400"
                    style={{
                        left: Math.min(canvasTextSelection.clientX + 10, window.innerWidth - 130),
                        top: Math.min(canvasTextSelection.clientY + 10, window.innerHeight - 40),
                    }}
                    onClick={() => {
                        handleForkTextSelection(canvasTextSelection.anchor)
                    }}
                >
                    <GitFork className="h-3.5 w-3.5" />
                    追问选区
                </button>
            ) : null}

            <AISettingsSheet
                open={isAISettingsOpen}
                onOpenChange={setIsAISettingsOpen}
            />
        </div>
    )
}

export default App
