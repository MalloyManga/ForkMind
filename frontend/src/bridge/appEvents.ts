import { EventsOn } from "../../wailsjs/runtime/runtime"

const APP_BEFORE_CLOSE_EVENT = "forkmind:app:before-close"

/**
 * 订阅 Wails 窗口关闭前事件
 * @param onBeforeClose 入参是持久化调度器提供的立即刷盘回调
 * @returns 返回解除监听函数 非 Wails 浏览器环境返回空清理函数
 * App 挂载后持续监听 用户关闭窗口时由 Go OnBeforeClose 触发
 */
export function subscribeAppBeforeClose(onBeforeClose: () => void): () => void {
    const runtimeGlobal = globalThis as typeof globalThis & { runtime?: unknown }
    if (typeof runtimeGlobal.runtime === "undefined") {
        return () => undefined
    }

    return EventsOn(APP_BEFORE_CLOSE_EVENT, onBeforeClose)
}
