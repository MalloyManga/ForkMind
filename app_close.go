package main

import (
	"context"
	"fmt"
	"sync"
)

const appBeforeCloseEvent = "forkmind:app:before-close"

// AppCloseCoordinator 管理一次窗口关闭与前端刷盘之间的握手状态
// confirmed 只在前端确认最新工作区已经保存后置为 true
type AppCloseCoordinator struct {
	mutex     sync.Mutex
	pending   bool
	confirmed bool
}

// NewAppCloseCoordinator 创建应用生命周期内唯一的关闭协调器
// 返回值由 App 持有并同时服务 OnBeforeClose 与前端 Bridge 确认动作
func NewAppCloseCoordinator() *AppCloseCoordinator {
	return &AppCloseCoordinator{}
}

// BeginClose 判断当前关闭动作是否需要拦截
// 返回 prevent=true 表示 Wails 本轮不能退出 notify=true 表示需要通知 React 刷盘
// 用户点击窗口关闭按钮或系统请求退出时触发
func (coordinator *AppCloseCoordinator) BeginClose() (prevent bool, notify bool) {
	coordinator.mutex.Lock()
	defer coordinator.mutex.Unlock()

	if coordinator.confirmed {
		return false, false
	}
	if coordinator.pending {
		// 首次事件可能发生在 React 监听器挂载前 后续关闭请求需要再次发送通知
		// React 持久化层会对进行中的握手去重 因此重复通知不会并发写盘
		return true, true
	}

	coordinator.pending = true
	return true, true
}

// ConfirmClose 标记前端已经完成最终工作区保存
// 后续 runtime.Quit 再次进入 OnBeforeClose 时会被允许真正关闭
func (coordinator *AppCloseCoordinator) ConfirmClose() {
	coordinator.mutex.Lock()
	coordinator.pending = false
	coordinator.confirmed = true
	coordinator.mutex.Unlock()
}

// AbortClose 取消本轮关闭握手
// 最终保存失败时触发 允许用户处理错误后再次点击关闭并重新尝试
func (coordinator *AppCloseCoordinator) AbortClose() {
	coordinator.mutex.Lock()
	coordinator.pending = false
	coordinator.confirmed = false
	coordinator.mutex.Unlock()
}

// beforeClose 是 Wails 窗口关闭拦截入口
// ctx 由 Wails 生命周期传入 用于通知 React 执行立即保存
// 返回 true 表示本轮关闭被拦截 false 表示前端已确认刷盘可以退出
func (a *App) beforeClose(ctx context.Context) bool {
	if a.closeCoordinator == nil {
		return false
	}

	preventClose, shouldNotify := a.closeCoordinator.BeginClose()
	if shouldNotify {
		emitWailsEvent(ctx, appBeforeCloseEvent)
	}

	return preventClose
}

// CompleteAppClose 接收 React 最终保存成功确认并真正退出应用
// 返回空 OperationResponse 表示关闭命令已经交给 Wails runtime
// 前端处理 forkmind:app:before-close 事件且所有排队保存完成后触发
func (a *App) CompleteAppClose() OperationResponse {
	if a.ctx == nil {
		return OperationResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("Wails application context is unavailable"), true),
		}
	}
	if a.closeCoordinator == nil {
		return OperationResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("app close coordinator is unavailable"), false),
		}
	}

	a.closeCoordinator.ConfirmClose()
	quitWailsApplication(a.ctx)
	return OperationResponse{}
}

// AbortAppClose 让保存失败的关闭请求恢复为可重试状态
// 返回空 OperationResponse 表示窗口继续保持打开
// 前端最终保存失败并已经把错误展示给用户时触发
func (a *App) AbortAppClose() OperationResponse {
	if a.closeCoordinator == nil {
		return OperationResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("app close coordinator is unavailable"), false),
		}
	}

	a.closeCoordinator.AbortClose()
	return OperationResponse{}
}
