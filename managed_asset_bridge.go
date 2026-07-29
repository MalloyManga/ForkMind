package main

import (
	"encoding/base64"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	managedImageFilters = []runtime.FileFilter{{
		DisplayName: "Images",
		Pattern:     "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg",
	}}
	managedFileFilters = []runtime.FileFilter{{
		DisplayName: "All Files",
		Pattern:     "*.*",
	}}
)

// ImportManagedAsset 打开系统文件对话框并复制用户选择的本地资产
// kind 来自图片卡片或文件卡片编辑器 只接受 image 和 file
// 返回 Cancelled 表示用户取消 Asset 表示已经进入 ForkMind 管理目录的稳定元数据
func (a *App) ImportManagedAsset(kind string) ManagedAssetImportResponse {
	if a.ctx == nil {
		return ManagedAssetImportResponse{Error: newBridgeError(errorCodeInternal, fmt.Errorf("application context is unavailable"), false)}
	}
	if a.workspaceRepository == nil {
		return ManagedAssetImportResponse{Error: newBridgeError(errorCodeInternal, fmt.Errorf("workspace repository is unavailable"), false)}
	}

	filters := managedFileFilters
	switch kind {
	case managedAssetKindImage:
		filters = managedImageFilters
	case managedAssetKindFile:
	default:
		return ManagedAssetImportResponse{Error: newBridgeError(errorCodeInvalidData, fmt.Errorf("managed asset kind %q is invalid", kind), false)}
	}

	selectedPath, err := showManagedAssetOpenDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Select ForkMind Asset",
		Filters: filters,
	})
	if err != nil {
		return ManagedAssetImportResponse{Error: newBridgeError(errorCodeReadFailed, fmt.Errorf("open managed asset dialog: %w", err), true)}
	}
	if selectedPath == "" {
		return ManagedAssetImportResponse{Cancelled: true}
	}

	asset, err := a.workspaceRepository.ImportManagedAsset(selectedPath, kind)
	if err != nil {
		return ManagedAssetImportResponse{Error: newBridgeError(errorCodeReadFailed, err, false)}
	}

	return ManagedAssetImportResponse{Asset: &asset}
}

// ReadManagedAssetDataURL 返回渲染进程可直接展示的本地图片 data URL
// assetID 来自图片节点保存的 ManagedAssetDTO.ID
// 返回错误时前端展示占位态 不允许自行拼接 file URL 绕过 Go 路径边界
func (a *App) ReadManagedAssetDataURL(assetID string) ManagedAssetDataResponse {
	if a.workspaceRepository == nil {
		return ManagedAssetDataResponse{Error: newBridgeError(errorCodeInternal, fmt.Errorf("workspace repository is unavailable"), false)}
	}

	content, mimeType, err := a.workspaceRepository.ReadManagedAsset(assetID)
	if err != nil {
		return ManagedAssetDataResponse{Error: newBridgeError(errorCodeReadFailed, err, false)}
	}

	return ManagedAssetDataResponse{
		DataURL: fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(content)),
	}
}
