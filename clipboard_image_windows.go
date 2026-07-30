//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	clipboardFormatDIB      = 8
	clipboardFormatFileDrop = 15
	clipboardFormatDIBV5    = 17
	clipboardAllFilesQuery  = 0xffffffff
	maxClipboardDIBBytes    = 256 * 1024 * 1024
	clipboardOpenRetryCount = 5
	clipboardOpenRetryDelay = 10 * time.Millisecond
)

var (
	user32DLL                  = syscall.NewLazyDLL("user32.dll")
	kernel32DLL                = syscall.NewLazyDLL("kernel32.dll")
	ntdllDLL                   = syscall.NewLazyDLL("ntdll.dll")
	shell32DLL                 = syscall.NewLazyDLL("shell32.dll")
	openClipboardProcedure     = user32DLL.NewProc("OpenClipboard")
	closeClipboardProcedure    = user32DLL.NewProc("CloseClipboard")
	getClipboardDataProcedure  = user32DLL.NewProc("GetClipboardData")
	isClipboardFormatProcedure = user32DLL.NewProc("IsClipboardFormatAvailable")
	globalLockProcedure        = kernel32DLL.NewProc("GlobalLock")
	globalUnlockProcedure      = kernel32DLL.NewProc("GlobalUnlock")
	globalSizeProcedure        = kernel32DLL.NewProc("GlobalSize")
	getLastErrorProcedure      = kernel32DLL.NewProc("GetLastError")
	rtlMoveMemoryProcedure     = ntdllDLL.NewProc("RtlMoveMemory")
	dragQueryFileProcedure     = shell32DLL.NewProc("DragQueryFileW")
)

// readSystemClipboardImageSources 在固定 OS thread 上读取 Win32 图片剪贴板
// 优先读取 CF_HDROP 图片文件 其次读取 CF_DIBV5 和 CF_DIB 截图
// 返回空数组表示没有支持的图片格式 Bridge 随后继续文本粘贴
func readSystemClipboardImageSources() (sources []clipboardImageSource, returnErr error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	if err := openWindowsClipboard(); err != nil {
		return nil, err
	}
	defer func() {
		if err := closeWindowsClipboard(); err != nil && returnErr == nil {
			sources = nil
			returnErr = err
		}
	}()

	fileSources, err := readClipboardFileDropSources()
	if err != nil {
		return nil, err
	}
	if len(fileSources) > 0 {
		return fileSources, nil
	}

	var lastDIBError error
	for _, clipboardFormat := range []uint32{clipboardFormatDIBV5, clipboardFormatDIB} {
		if !isWindowsClipboardFormatAvailable(clipboardFormat) {
			continue
		}
		dib, err := readWindowsClipboardGlobalBytes(clipboardFormat)
		if err != nil {
			lastDIBError = err
			continue
		}
		encodedPNG, err := decodeDIBToPNG(dib)
		if err != nil {
			lastDIBError = err
			continue
		}
		return []clipboardImageSource{{
			Name:    "clipboard-image.png",
			Content: encodedPNG,
		}}, nil
	}
	if lastDIBError != nil {
		return nil, fmt.Errorf("decode Windows clipboard DIB: %w", lastDIBError)
	}
	return nil, nil
}

// openWindowsClipboard 带短暂重试打开系统剪贴板
// 其他应用可能在复制完成瞬间仍持有锁 重试总时长严格限制在 50ms 内
func openWindowsClipboard() error {
	var lastError error
	for attempt := 0; attempt < clipboardOpenRetryCount; attempt++ {
		result, _, callErr := openClipboardProcedure.Call(0)
		if result != 0 {
			return nil
		}
		lastError = normalizeWindowsCallError(callErr)
		if attempt+1 < clipboardOpenRetryCount {
			time.Sleep(clipboardOpenRetryDelay)
		}
	}
	return fmt.Errorf("open Windows clipboard: %w", lastError)
}

// closeWindowsClipboard 关闭当前 thread 已打开的系统剪贴板
func closeWindowsClipboard() error {
	result, _, callErr := closeClipboardProcedure.Call()
	if result == 0 {
		return fmt.Errorf("close Windows clipboard: %w", normalizeWindowsCallError(callErr))
	}
	return nil
}

// isWindowsClipboardFormatAvailable 查询系统剪贴板是否公开指定格式
func isWindowsClipboardFormatAvailable(clipboardFormat uint32) bool {
	result, _, _ := isClipboardFormatProcedure.Call(uintptr(clipboardFormat))
	return result != 0
}

// readWindowsClipboardGlobalBytes 复制剪贴板 HGLOBAL 内容到 Go 管理内存
// clipboardFormat 只能是已确认存在的 DIB 格式 返回后立即释放 GlobalLock
func readWindowsClipboardGlobalBytes(clipboardFormat uint32) (content []byte, returnErr error) {
	handle, _, callErr := getClipboardDataProcedure.Call(uintptr(clipboardFormat))
	if handle == 0 {
		return nil, fmt.Errorf("get clipboard format %d: %w", clipboardFormat, normalizeWindowsCallError(callErr))
	}
	size, _, callErr := globalSizeProcedure.Call(handle)
	if size == 0 {
		return nil, fmt.Errorf("inspect clipboard format %d size: %w", clipboardFormat, normalizeWindowsCallError(callErr))
	}
	if size > maxClipboardDIBBytes {
		return nil, fmt.Errorf("clipboard DIB exceeds %d bytes", maxClipboardDIBBytes)
	}
	dataPointer, _, callErr := globalLockProcedure.Call(handle)
	if dataPointer == 0 {
		return nil, fmt.Errorf("lock clipboard format %d: %w", clipboardFormat, normalizeWindowsCallError(callErr))
	}
	defer func() {
		unlockResult, _, _ := globalUnlockProcedure.Call(handle)
		if unlockResult == 0 {
			lastError, _, _ := getLastErrorProcedure.Call()
			if lastError != 0 && returnErr == nil {
				content = nil
				returnErr = fmt.Errorf("unlock clipboard format %d: Windows error %d", clipboardFormat, lastError)
			}
		}
	}()

	content = make([]byte, int(size))
	rtlMoveMemoryProcedure.Call(
		uintptr(unsafe.Pointer(&content[0])),
		dataPointer,
		size,
	)
	runtime.KeepAlive(content)
	return content, nil
}

// readClipboardFileDropSources 读取资源管理器复制的图片文件路径
// CF_HDROP 可以包含多个文件 只保留项目已支持的图片扩展名并限制总数
func readClipboardFileDropSources() ([]clipboardImageSource, error) {
	if !isWindowsClipboardFormatAvailable(clipboardFormatFileDrop) {
		return nil, nil
	}
	dropHandle, _, callErr := getClipboardDataProcedure.Call(clipboardFormatFileDrop)
	if dropHandle == 0 {
		return nil, fmt.Errorf("get clipboard file list: %w", normalizeWindowsCallError(callErr))
	}
	fileCount, _, callErr := dragQueryFileProcedure.Call(dropHandle, clipboardAllFilesQuery, 0, 0)
	if fileCount == 0 {
		if normalizedError := normalizeWindowsCallError(callErr); normalizedError != syscall.Errno(0) {
			return nil, fmt.Errorf("count clipboard files: %w", normalizedError)
		}
		return nil, nil
	}

	sources := make([]clipboardImageSource, 0, min(int(fileCount), maxClipboardImageCount))
	for fileIndex := uintptr(0); fileIndex < fileCount; fileIndex++ {
		pathLength, _, callErr := dragQueryFileProcedure.Call(dropHandle, fileIndex, 0, 0)
		if pathLength == 0 {
			return nil, fmt.Errorf("read clipboard file %d length: %w", fileIndex, normalizeWindowsCallError(callErr))
		}
		pathBuffer := make([]uint16, int(pathLength)+1)
		copiedLength, _, callErr := dragQueryFileProcedure.Call(
			dropHandle,
			fileIndex,
			uintptr(unsafe.Pointer(&pathBuffer[0])),
			uintptr(len(pathBuffer)),
		)
		if copiedLength == 0 {
			return nil, fmt.Errorf("read clipboard file %d path: %w", fileIndex, normalizeWindowsCallError(callErr))
		}
		filePath := syscall.UTF16ToString(pathBuffer)
		if !isSupportedClipboardImagePath(filePath) {
			continue
		}
		sources = append(sources, clipboardImageSource{
			Name: filepath.Base(filePath),
			Path: filePath,
		})
		if len(sources) > maxClipboardImageCount {
			return nil, fmt.Errorf("clipboard contains more than %d image files", maxClipboardImageCount)
		}
	}
	return sources, nil
}

// isSupportedClipboardImagePath 根据资产仓库已经支持的扩展名过滤 CF_HDROP
// 真正 MIME 仍由 ImportManagedAsset 检测 扩展名只避免把普通文件误当成图片粘贴
func isSupportedClipboardImagePath(filePath string) bool {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg":
		return true
	default:
		return false
	}
}

// normalizeWindowsCallError 把 LazyProc 返回的零 errno 保留为可比较错误
func normalizeWindowsCallError(callErr error) error {
	if callErr == nil {
		return syscall.Errno(0)
	}
	return callErr
}
