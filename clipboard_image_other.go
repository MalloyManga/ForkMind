//go:build !windows

package main

// readSystemClipboardImageSources 在非 Windows 平台返回无图片
// 当前 MVP 只实现 Win32 DIB 与 CF_HDROP 未来平台实现保持相同 Bridge 契约
func readSystemClipboardImageSources() ([]clipboardImageSource, error) {
	return nil, nil
}
