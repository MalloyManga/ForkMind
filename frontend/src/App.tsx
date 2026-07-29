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
    SIDEBAR_COLLAPSE_DURATION_MS,
    SIDEBAR_COLLAPSE_DRAG_THRESHOLD,
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
import { importManagedAssetFromBridge, type ManagedAssetKind } from "./bridge"
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
    collapseOvershoot: number
}

interface CanvasContextMenuState {
    context: CanvasContextMenuContext
    items: CanvasContextMenuItem[]
}

interface CanvasTextSelectionState extends CanvasTextSelectionEventDetail {}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

/**
 * 计算侧栏拖过最小宽度后的阻尼结果
 * @param rawWidth 入参来自 pointermove 根据起始宽度和水平位移得到的未限制宽度
 * @param minWidth 入参来自当前左栏或右栏的布局最小值
 * @param maxWidth 入参来自当前左栏或右栏的布局最大值
 * @returns width 是当帧显示宽度 collapseOvershoot 是越过最小阈值的原始拖拽距离
 * 用户把任一侧栏向外缘收窄时由全局 pointermove 触发
 */
function resolveSidebarDragWidth(
    rawWidth: number,
    minWidth: number,
    maxWidth: number,
): { width: number; collapseOvershoot: number } {
    if (rawWidth >= minWidth) {
        return {
            width: clamp(rawWidth, minWidth, maxWidth),
            collapseOvershoot: 0,
        }
    }

    return {
        width: minWidth,
        collapseOvershoot: minWidth - rawWidth,
    }
}

/**
 * 判断键盘事件是否来自文本编辑区域
 * @param eventTarget 入参来自全局 keydown 的 event.target 可能是输入控件或 contenteditable 内部子元素
 * @returns true 表示保留浏览器原生快捷键 false 表示允许 Canvas 命令继续解析
 * 用户在侧栏表单或卡片富文本区域按下快捷键时触发
 */
function isTextEditingTarget(eventTarget: EventTarget | null): boolean {
    if (!(eventTarget instanceof Element)) {
        return false
    }

    return eventTarget.closest("input, textarea, [contenteditable]:not([contenteditable='false'])") !== null
}

/**
 * 判断当前页面是否存在用户主动选择的普通文本
 * @returns true 表示 Ctrl Cmd C 应交给浏览器复制文字 false 表示可以复制 Canvas 卡片 JSON
 * 用户在卡片正文或侧栏说明中拖选文字后按下复制快捷键时触发
 */
function hasBrowserTextSelection(): boolean {
    const selection = window.getSelection()
    return selection !== null && !selection.isCollapsed && selection.toString().length > 0
}

function App() {
    const [themeMode, setThemeMode] = useState<ThemeMode>("dark")
    const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)
    const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false)
    const [isCanvasUiHidden, setIsCanvasUiHidden] = useState(false) // 所有UI均隐藏的状态源
    const [currentCanvasTool, setCurrentCanvasTool] = useState<CanvasTool>("move") // 全局 canvasTool 唯一状态源
    const [canvasEditor, setCanvasEditor] = useState<Editor | null>(null)
    const [contextMenuState, setContextMenuState] = useState<CanvasContextMenuState | null>(null)
    const [isAISettingsOpen, setIsAISettingsOpen] = useState(false)
    const [canvasTextSelection, setCanvasTextSelection] = useState<CanvasTextSelectionState | null>(null)
    const [managedAssetErrorMessage, setManagedAssetErrorMessage] = useState<string | null>(null)

    const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH)
    const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH)

    const resizeDragStateRef = useRef<ResizeDragState | null>(null)
    const collapsingSidebarRef = useRef<ResizeDragState["side"] | null>(null)
    const leftSidebarHostRef = useRef<HTMLDivElement | null>(null)
    const rightSidebarHostRef = useRef<HTMLDivElement | null>(null)
    const leftSidebarContentRef = useRef<HTMLDivElement | null>(null)
    const rightSidebarContentRef = useRef<HTMLDivElement | null>(null)
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
    const areSidebarsHidden = isLeftSidebarCollapsed && isRightSidebarCollapsed

    /**
     * 同步切换两侧面板
     * @param nextHidden 入参来自面板按钮 快捷键或右键命令 可以是目标布尔值或基于当前双侧状态的更新函数
     * @returns 无返回值 左右侧栏会在同一次 React 批处理中同步显示或隐藏
     * 用户使用全局 Toggle Panels 命令时触发 单侧拖拽收回不会经过这里
     */
    const setAreSidebarsHidden = useCallback((
        nextHidden: boolean | ((previousHidden: boolean) => boolean),
    ) => {
        const resolvedHidden = typeof nextHidden === "function"
            ? nextHidden(areSidebarsHidden)
            : nextHidden
        setIsLeftSidebarCollapsed(resolvedHidden)
        setIsRightSidebarCollapsed(resolvedHidden)
    }, [areSidebarsHidden])

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
    const updateImageNode = useConversationStore((state) => state.updateImageNode)
    const updateLinkNode = useConversationStore((state) => state.updateLinkNode)
    const updateFileNode = useConversationStore((state) => state.updateFileNode)
    const beginTextEdit = useConversationStore((state) => state.beginTextEdit)
    const endTextEdit = useConversationStore((state) => state.endTextEdit)
    const pasteNodesFromClipboard = useConversationStore((state) => state.pasteNodesFromClipboard)
    const replaceNodesFromClipboard = useConversationStore((state) => state.replaceNodesFromClipboard)
    const undo = useConversationStore((state) => state.undo)
    const redo = useConversationStore((state) => state.redo)

    const rootNodeCount = useMemo(
        // 左侧栏保留根节点数量统计 但不再根据数量展示告警
        () => cards.filter((card) => card.parentId === null).length,
        [cards],
    )

    useEffect(() => {
        // Radix Portal 挂在 body 下 将主题放到 html 才能让弹窗继承同一套亮暗变量
        document.documentElement.dataset.theme = themeMode
        document.documentElement.classList.toggle("dark", themeMode === "dark")
    }, [themeMode])

    /**
     * 同步写入侧栏外壳与内容宽度
     * @param side 入参来自当前拖拽会话 用于选择左栏或右栏对应 DOM
     * @param nextWidth 入参来自 pointermove 计算结果 表示当前帧应显示的像素宽度
     * @returns 无返回值 高频拖拽只写 DOM ref pointerup 再提交 React state
     * 用户拖动任一侧栏分隔条或收回动画结算时触发
     */
    const applySidebarWidth = (side: ResizeDragState["side"], nextWidth: number) => {
        if (side === "left") {
            leftSidebarWidthRef.current = nextWidth
            if (leftSidebarHostRef.current) {
                leftSidebarHostRef.current.style.width = `${nextWidth}px`
            }
            if (leftSidebarContentRef.current) {
                leftSidebarContentRef.current.style.width = `${nextWidth}px`
            }
            return
        }

        rightSidebarWidthRef.current = nextWidth
        if (rightSidebarHostRef.current) {
            rightSidebarHostRef.current.style.width = `${nextWidth}px`
        }
        if (rightSidebarContentRef.current) {
            rightSidebarContentRef.current.style.width = `${nextWidth}px`
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
        isCanvasUiHidden,
    })

    // executor 负责真正执行业务命令 键盘和右键菜单最终都汇合到这里
    const { executeCanvasCommand } = useCanvasContextMenuExecutor({
        canvasEditor,
        activeNodeId,
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

    const handleSelectManagedAsset = useCallback(async (nodeId: string, kind: ManagedAssetKind) => {
        setManagedAssetErrorMessage(null)
        const response = await importManagedAssetFromBridge(kind)
        if (response.error) {
            setManagedAssetErrorMessage(response.error.message)
            return
        }
        if (response.cancelled || !response.asset) {
            return
        }

        switch (kind) {
            case "image":
                updateImageNode(nodeId, { asset: response.asset })
                return
            case "file":
                updateFileNode(nodeId, { asset: response.asset })
                return
        }
    }, [updateFileNode, updateImageNode])

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
        if (collapsingSidebarRef.current !== null) {
            return
        }
        event.preventDefault()

        resizeDragStateRef.current = {
            side: "left",
            startX: event.clientX,
            startWidth: leftSidebarWidthRef.current,
            collapseOvershoot: 0,
        }

        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
    }

    /**
     * 拖拽缩放右侧栏
     */
    const startResizeRightSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (collapsingSidebarRef.current !== null) {
            return
        }
        event.preventDefault()

        resizeDragStateRef.current = {
            side: "right",
            startX: event.clientX,
            startWidth: rightSidebarWidthRef.current,
            collapseOvershoot: 0,
        }

        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
    }

    useEffect(() => {
        /**
         * 播放单侧侧栏收回动画
         * @param side 入参来自当前 ResizeDragState 表示本次只收回左栏或右栏
         * @param minWidth 入参是目标侧栏锁住后的最小宽度 动画从该宽度收至 0
         * @returns 无返回值 动画完成后只更新目标侧栏的 collapsed 状态
         * pointermove 越过额外收回距离时立即触发 不等待 pointerup
         */
        const collapseSidebar = (side: ResizeDragState["side"], minWidth: number) => {
            if (collapsingSidebarRef.current !== null) {
                return
            }

            collapsingSidebarRef.current = side
            resizeDragStateRef.current = null
            document.body.style.removeProperty("cursor")
            document.body.style.removeProperty("user-select")

            const hostElement = side === "left"
                ? leftSidebarHostRef.current
                : rightSidebarHostRef.current
            const contentElement = side === "left"
                ? leftSidebarContentRef.current
                : rightSidebarContentRef.current
            const finishCollapse = () => {
                applySidebarWidth(side, minWidth)
                if (side === "left") {
                    setLeftSidebarWidth(minWidth)
                    setIsLeftSidebarCollapsed(true)
                } else {
                    setRightSidebarWidth(minWidth)
                    setIsRightSidebarCollapsed(true)
                }
                collapsingSidebarRef.current = null
            }

            const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
            if (prefersReducedMotion || !hostElement) {
                finishCollapse()
                return
            }

            // Host 只改变宽度并保持不透明背景 Content 独立淡出 避免画布透过侧栏闪烁
            const animations = [
                hostElement.animate(
                    [{ width: `${minWidth}px` }, { width: "0px" }],
                    {
                        duration: SIDEBAR_COLLAPSE_DURATION_MS,
                        easing: "cubic-bezier(0.4, 0, 1, 1)",
                        fill: "forwards",
                    },
                ),
                contentElement?.animate(
                    [{ opacity: 1 }, { opacity: 0 }],
                    {
                        duration: SIDEBAR_COLLAPSE_DURATION_MS,
                        easing: "ease-in",
                        fill: "forwards",
                    },
                ),
            ].filter((animation): animation is Animation => animation !== undefined)

            void Promise.allSettled(animations.map((animation) => animation.finished))
                .then(finishCollapse)
        }

        const handlePointerMove = (event: PointerEvent) => {
            const resizeState = resizeDragStateRef.current
            if (!resizeState) {
                return
            }

            if (resizeState.side === "left") {
                const dragResult = resolveSidebarDragWidth(
                    resizeState.startWidth + (event.clientX - resizeState.startX),
                    LEFT_SIDEBAR_MIN_WIDTH,
                    LEFT_SIDEBAR_MAX_WIDTH,
                )
                resizeState.collapseOvershoot = dragResult.collapseOvershoot
                applySidebarWidth("left", dragResult.width)
                if (dragResult.collapseOvershoot >= SIDEBAR_COLLAPSE_DRAG_THRESHOLD) {
                    collapseSidebar("left", LEFT_SIDEBAR_MIN_WIDTH)
                }
                return
            }

            const dragResult = resolveSidebarDragWidth(
                resizeState.startWidth - (event.clientX - resizeState.startX),
                RIGHT_SIDEBAR_MIN_WIDTH,
                RIGHT_SIDEBAR_MAX_WIDTH,
            )
            resizeState.collapseOvershoot = dragResult.collapseOvershoot
            applySidebarWidth("right", dragResult.width)
            if (dragResult.collapseOvershoot >= SIDEBAR_COLLAPSE_DRAG_THRESHOLD) {
                collapseSidebar("right", RIGHT_SIDEBAR_MIN_WIDTH)
            }
        }

        const handlePointerUp = () => {
            const resizeState = resizeDragStateRef.current
            if (!resizeState) {
                return
            }

            resizeDragStateRef.current = null
            document.body.style.removeProperty("cursor")
            document.body.style.removeProperty("user-select")

            if (resizeState.side === "left") {
                setLeftSidebarWidth(leftSidebarWidthRef.current)
            } else {
                setRightSidebarWidth(rightSidebarWidthRef.current)
            }
        }

        window.addEventListener("pointermove", handlePointerMove, true)
        window.addEventListener("pointerup", handlePointerUp, true)
        window.addEventListener("pointercancel", handlePointerUp, true)

        return () => {
            window.removeEventListener("pointermove", handlePointerMove, true)
            window.removeEventListener("pointerup", handlePointerUp, true)
            window.removeEventListener("pointercancel", handlePointerUp, true)
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

            // 页面文字选区优先走浏览器系统复制 避免卡片 Copy 命令覆盖用户选择的文本
            if (commandId === "copy-node" && hasBrowserTextSelection()) {
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
            {isLeftSidebarCollapsed && !isCanvasUiHidden ? (
                <div className="pointer-events-none absolute left-4 top-4 z-40">
                    <div className="pointer-events-auto inline-flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background/80 py-1.5 pl-2 pr-1.5 shadow-[0_8px_32px_-8px_rgba(15,23,42,0.24)] backdrop-blur-xl transition-all duration-200">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
                            <GitFork className="h-3 w-3" strokeWidth={2.4} />
                        </span>
                        <div className="max-w-56 truncate text-sm font-medium">{activeThread.title}</div>
                        <PanelsToggleButton
                            isMinimized
                            onToggle={() => {
                                setIsLeftSidebarCollapsed(false)
                                if (areSidebarsHidden) {
                                    setIsRightSidebarCollapsed(false)
                                }
                            }}
                        />
                    </div>
                </div>
            ) : null}

            {isRightSidebarCollapsed && !areSidebarsHidden && !isCanvasUiHidden ? (
                <div className="pointer-events-none absolute right-4 top-4 z-40">
                    <div className="pointer-events-auto rounded-xl border border-border/60 bg-background/90 p-1 shadow-lg backdrop-blur-xl">
                        <PanelsToggleButton
                            isMinimized
                            onToggle={() => {
                                setIsRightSidebarCollapsed(false)
                            }}
                        />
                    </div>
                </div>
            ) : null}

            <div className="flex h-full w-full overflow-hidden">
                {!isLeftSidebarCollapsed && !isCanvasUiHidden ? (
                    <div
                        ref={leftSidebarHostRef}
                        className="relative h-full shrink-0 overflow-hidden bg-background"
                        style={{ width: leftSidebarWidth }}
                    >
                        <div
                            ref={leftSidebarContentRef}
                            className="absolute inset-y-0 left-0"
                            style={{ width: leftSidebarWidth }}
                        >
                            <LeftConversationSidebar
                            threadTitle={activeThread.title}
                            cardCount={cards.length}
                            rootNodeCount={rootNodeCount}
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
                    </div>
                ) : null}

                {!isLeftSidebarCollapsed && !isCanvasUiHidden ? (
                    <div
                        className="group relative z-20 w-0 shrink-0 cursor-col-resize"
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
                    areLinkHandlesBlocked={isAISettingsOpen}
                    creationPreviewRect={creationPreviewRect}
                    licenseKey={tldrawLicenseKey}
                />

                {!isRightSidebarCollapsed && !isCanvasUiHidden ? (
                    <div
                        className="group relative z-20 w-0 shrink-0 cursor-col-resize"
                        onPointerDown={startResizeRightSidebar}
                        role="separator"
                        aria-label="调整右侧栏宽度"
                    >
                        <div className="absolute inset-y-0 -left-1.5 -right-1.5 transition-colors group-hover:bg-sky-400/15" />
                        <div className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-all group-hover:bg-sky-400/80" />
                    </div>
                ) : null}

                {!isRightSidebarCollapsed && !isCanvasUiHidden ? (
                    <div
                        ref={rightSidebarHostRef}
                        className="relative h-full shrink-0 overflow-hidden bg-background"
                        style={{ width: rightSidebarWidth }}
                    >
                        <div
                            ref={rightSidebarContentRef}
                            className="absolute inset-y-0 right-0"
                            style={{ width: rightSidebarWidth }}
                        >
                            <RightEditorSidebar
                            activeNode={activeNode}
                            onUpdateChatPrompt={updateChatPrompt}
                            onUpdateChatResponse={updateChatResponse}
                            onUpdateNoteContent={updateNoteContent}
                            onUpdateImageNode={updateImageNode}
                            onUpdateLinkNode={updateLinkNode}
                            onUpdateFileNode={updateFileNode}
                            onSelectManagedAsset={(nodeId, kind) => {
                                void handleSelectManagedAsset(nodeId, kind)
                            }}
                            managedAssetErrorMessage={managedAssetErrorMessage}
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
                            pendingCanvasPlan={aiCompletion.pendingCanvasPlan}
                            onAcceptCanvasPlan={aiCompletion.acceptCanvasPlan}
                            onRejectCanvasPlan={aiCompletion.rejectCanvasPlan}
                            />
                        </div>
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
