package main

import (
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Wails runtime 函数通过包级端口集中管理
// 生产环境保持调用官方实现 单元测试会临时替换并在测试结束后恢复
// 这些端口只隔离桌面系统副作用 不承载任何 ForkMind 业务状态
var (
	runWailsApplication        = wails.Run
	emitWailsEvent             = runtime.EventsEmit
	quitWailsApplication       = runtime.Quit
	showWorkspaceSaveDialog    = runtime.SaveFileDialog
	showWorkspaceOpenDialog    = runtime.OpenFileDialog
	resolveUserConfigDirectory = os.UserConfigDir
)
