import type { Editor } from "tldraw"
import { useEffect, useRef, useState, type MutableRefObject } from "react"
import {
    DEFAULT_CARD_MIN_HEIGHT,
    DEFAULT_CARD_WIDTH,
    CREATION_DRAG_THRESHOLD,
    MIN_CREATED_CARD_WIDTH,
    MIN_CREATED_CARD_HEIGHT
} from "../domain/conversation/constants"
import type { ConversationNodeType } from "../domain/conversation/types"
import type { CanvasTool } from "./canvasToolTypes"
import { isCreationCanvasTool } from "./canvasToolTypes"
import type { Point } from "./useCanvasBridge.helpers"

interface Rect {
    x: number
    y: number
    width: number
    height: number
}

/**
 * 鼠标拖拽的起始位置点对象
 */
interface CreationDragSession {
    startClientPoint: Point // 鼠标按下那一刻的起点，后续所有矩形计算都从这里开始
    latestClientPoint: Point // 鼠标移动中的最新点，用来实时更新蓝色预创建框
}

interface UseCanvasBridgeCreationParams {
    canvasEditor: Editor | null
    currentCanvasToolRef: MutableRefObject<CanvasTool>
    commitNodeCreation: (input: {
        cardType: ConversationNodeType
        position: Point
        parentId?: string | null
        size?: { width?: number; minHeight?: number }
    }) => string
}

/**
 * 把两个浏览器 client 坐标点转换成“相对画布容器”的矩形
 * 传入起始位置 返回相对于 canvas 画布容器的 rect 用于创建蓝色预创建框
 */
function createLocalRectFromClientPoints(
    startClientPoint: Point,
    latestClientPoint: Point,
    containerRect: DOMRect, // 容器的Box 抹平浏览器绝对坐标系与容器相对坐标系的差异
): Rect {
    const left = Math.min(startClientPoint.x, latestClientPoint.x) - containerRect.left
    const top = Math.min(startClientPoint.y, latestClientPoint.y) - containerRect.top
    const width = Math.abs(latestClientPoint.x - startClientPoint.x)
    const height = Math.abs(latestClientPoint.y - startClientPoint.y)

    return {
        x: left,
        y: top,
        width,
        height,
    }
}

/**
 * 计算本次拖拽的距离
 * 距离太小就按“点击创建默认尺寸”处理，不按“拖拽创建自定义尺寸”处理。
 */
function getDragDistance(startClientPoint: Point, latestClientPoint: Point): number {
    return Math.hypot(
        latestClientPoint.x - startClientPoint.x,
        latestClientPoint.y - startClientPoint.y,
    )
}

/**
 * 创建拖拽状态机
 * 返回值 creationPreviewRect 只给蓝色预创建框 overlay 使用
 */
export function useCanvasBridgeCreation({
    canvasEditor,
    currentCanvasToolRef,
    commitNodeCreation,
}: UseCanvasBridgeCreationParams) {
    /**
     * 一次拖拽创建的运行时缓存 鼠标起始位置对象 null代表当前没有正在创建卡片
     */
    const creationDragSessionRef = useRef<CreationDragSession | null>(null)
    const [creationPreviewRect, setCreationPreviewRect] = useState<Rect | null>(null) // 驱动画布上的蓝色预创建框

    useEffect(() => {
        if (!canvasEditor) {
            return
        }

        const canvasContainer = canvasEditor.getContainer()

        /**
         * 真正把卡片写入 Store 的提交函数
         * @param nextTool 决定创建的卡片类型
         * @param nextPosition 是卡片左上角在画布坐标系中的位置
         * @param nextRect 存在时，说明用户这次是 拖拽创建 并指定了尺寸
         */
        const commitCreatedNode = (
            nextTool: ConversationNodeType,
            nextPosition: Point,
            nextRect?: Rect,
        ) => {
            // 使用默认尺寸/最小尺寸避免出现过小的卡片
            const nextSize = nextRect
                ? {
                    // 拖拽创建使用最小尺寸或者指定尺寸
                    width: Math.max(nextRect.width, MIN_CREATED_CARD_WIDTH),
                    minHeight: Math.max(nextRect.height, MIN_CREATED_CARD_HEIGHT),
                }
                : {
                    width: DEFAULT_CARD_WIDTH,
                    minHeight: DEFAULT_CARD_MIN_HEIGHT,
                }

            commitNodeCreation({
                cardType: nextTool,
                position: nextPosition,
                size: nextSize,
            })
        }

        /**
         * 直接中断函数
         */
        const endCreationDrag = () => {
            creationDragSessionRef.current = null
            setCreationPreviewRect(null)
        }

        /**
         * 鼠标移动时 高频触发 实时更新蓝色预创建框 不写进store
         */
        const handlePointerMove = (event: PointerEvent) => {
            const session = creationDragSessionRef.current
            if (!session) {
                return
            }

            session.latestClientPoint = {
                x: event.clientX,
                y: event.clientY,
            }

            const nextRect = createLocalRectFromClientPoints(
                session.startClientPoint,
                session.latestClientPoint,
                canvasContainer.getBoundingClientRect(),
            )
            setCreationPreviewRect(nextRect) // 高频赋值更新蓝色预创建框
        }

        /**
         * 鼠标松开时结算这次创建
         * 1. 点击创建默认尺寸
         * 2. 拖拽创建自定义尺寸(小于最小尺寸时创建最小尺寸)
         */
        const handlePointerUp = (event: PointerEvent) => {
            const session = creationDragSessionRef.current
            if (!session) {
                return
            }

            const currentCanvasTool = currentCanvasToolRef.current
            // 监听当前的 canvasTool 拦截非卡片创建 tool
            if (!isCreationCanvasTool(currentCanvasTool)) {
                endCreationDrag()
                return
            }

            const endClientPoint = {
                x: event.clientX,
                y: event.clientY,
            }
            const dragDistance = getDragDistance(session.startClientPoint, endClientPoint)

            // 转换浏览器坐标到 tldraw 的画布坐标
            const startPagePoint = canvasEditor.screenToPage(session.startClientPoint)
            const endPagePoint = canvasEditor.screenToPage(endClientPoint)

            // 拖拽过短创建默认尺寸
            if (dragDistance < CREATION_DRAG_THRESHOLD) {
                // 正式创建 node
                commitCreatedNode(currentCanvasTool, {
                    x: startPagePoint.x - DEFAULT_CARD_WIDTH / 2,
                    y: startPagePoint.y - DEFAULT_CARD_MIN_HEIGHT / 2,
                })
                endCreationDrag()
                return
            }

            const pageLeft = Math.min(startPagePoint.x, endPagePoint.x)
            const pageTop = Math.min(startPagePoint.y, endPagePoint.y)
            const pageWidth = Math.abs(endPagePoint.x - startPagePoint.x)
            const pageHeight = Math.abs(endPagePoint.y - startPagePoint.y)

            // 拖拽距离足够大 就按用户画出来的矩形尺寸创建卡片
            commitCreatedNode(
                currentCanvasTool,
                { x: pageLeft, y: pageTop },
                {
                    x: pageLeft,
                    y: pageTop,
                    width: pageWidth,
                    height: pageHeight,
                },
            )
            endCreationDrag()
        }

        /**
         * 在 canvas 容器的 capture 阶段抢先拿到 pointerdown 比 tldraw 默认选择逻辑更早接管事件
         */
        const handlePointerDownCapture = (event: PointerEvent) => {
            // 点击到按钮或者非cardTool直接返回
            if (event.button !== 0) {
                return
            }
            // 非卡片创建 tool 直接返回
            const currentCanvasTool = currentCanvasToolRef.current
            if (!isCreationCanvasTool(currentCanvasTool)) {
                return
            }

            // 点到的是 handle 不进入卡片创建
            const eventTarget = event.target
            if (
                eventTarget instanceof Element &&
                eventTarget.closest("[data-fm-link-handle='true']")
            ) {
                return
            }

            // 当前是创建工具时 这次按下不要继续流给 tldraw 默认选择/框选逻辑
            event.preventDefault()
            event.stopPropagation()

            // 按下时给 start 和 latest 赋同值 对应直接点击的卡片创建
            creationDragSessionRef.current = {
                startClientPoint: {
                    x: event.clientX,
                    y: event.clientY,
                },
                latestClientPoint: {
                    x: event.clientX,
                    y: event.clientY,
                },
            }

            // 给蓝色预创建框接口赋值
            setCreationPreviewRect(
                createLocalRectFromClientPoints(
                    creationDragSessionRef.current.startClientPoint,
                    creationDragSessionRef.current.latestClientPoint,
                    canvasContainer.getBoundingClientRect(),
                ),
            )
        }

        /**
         * 处理 esc 按键
         */
        const handleEscKeyDown = (event: KeyboardEvent) => {
            const isEscape = event.key === "Escape"
            if (!isEscape) {
                return
            }
            endCreationDrag()
        }

        // 注册这轮创建工具需要的原生事件
        canvasContainer.addEventListener("pointerdown", handlePointerDownCapture, true)
        window.addEventListener("pointermove", handlePointerMove, true)
        window.addEventListener("pointerup", handlePointerUp, true)
        window.addEventListener("keydown", handleEscKeyDown)
        window.addEventListener("pointercancel", endCreationDrag)

        return () => {
            // editor 变化或组件卸载时，把事件监听和临时状态都清干净
            canvasContainer.removeEventListener("pointerdown", handlePointerDownCapture, true)
            window.removeEventListener("pointermove", handlePointerMove, true)
            window.removeEventListener("pointerup", handlePointerUp, true)
            window.removeEventListener("keydown", handleEscKeyDown)
            window.removeEventListener("endCreationDrag", endCreationDrag)
            creationDragSessionRef.current = null
            setCreationPreviewRect(null)
        }
    }, [canvasEditor, commitNodeCreation, currentCanvasToolRef])

    return {
        // 只给蓝色预创建框 overlay 使用
        creationPreviewRect,
    }
}
