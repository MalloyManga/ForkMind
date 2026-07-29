package main

import (
	"embed"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	err := runWailsApplication(createApplicationOptions(app))
	if err != nil {
		println("Error:", err.Error())
	}
}

// createApplicationOptions 组装 Wails 桌面壳层配置
// app 入参是 main 创建的唯一 App 实例 并作为 startup close 和 Bridge 的共享宿主
// 返回值交给 wails.Run 启动进程 单元测试只检查配置而不会打开真实窗口
func createApplicationOptions(app *App) *options.App {
	return &options.App{
		Title:  "ForkMind",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnBeforeClose:    app.beforeClose,
		Bind: []interface{}{
			app,
		},
	}
}
