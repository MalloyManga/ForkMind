//go:build windows

package main

import "testing"

// TestIsSupportedClipboardImagePath 验证 CF_HDROP 只把已有图片类型交给资产仓库
func TestIsSupportedClipboardImagePath(t *testing.T) {
	t.Parallel()

	for _, filePath := range []string{
		`C:\images\photo.PNG`,
		`C:\images\photo.jpg`,
		`C:\images\photo.jpeg`,
		`C:\images\photo.gif`,
		`C:\images\photo.webp`,
		`C:\images\photo.bmp`,
		`C:\images\vector.svg`,
	} {
		if !isSupportedClipboardImagePath(filePath) {
			t.Fatalf("isSupportedClipboardImagePath(%q) = false", filePath)
		}
	}
	for _, filePath := range []string{
		`C:\files\notes.txt`,
		`C:\files\report.pdf`,
		`C:\files\no-extension`,
	} {
		if isSupportedClipboardImagePath(filePath) {
			t.Fatalf("isSupportedClipboardImagePath(%q) = true", filePath)
		}
	}
}
