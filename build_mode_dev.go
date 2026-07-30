//go:build dev

package main

// isDevelopmentBuild 由 Wails dev 自动注入的 dev build tag 决定
// 开发态数据需要避开 build/bin 防止 wails build -clean 删除本地调试工作区
const isDevelopmentBuild = true
