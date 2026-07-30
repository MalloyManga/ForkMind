package main

import (
	"fmt"
	"path/filepath"
)

const maxClipboardImageCount = 16

// clipboardImageSource 表示 Win32 剪贴板读取层交给仓库层的图片来源
// Path 用于资源管理器文件 Content 用于 DIB 截图 两者必须且只能存在一个
type clipboardImageSource struct {
	Name    string
	Path    string
	Content []byte
}

var readClipboardImageSources = readSystemClipboardImageSources

// ImportClipboardImages 读取系统剪贴板图片并导入 Managed Asset Repository
// 返回 Available=false 表示没有图片 前端可以安全降级到现有文本剪贴板流程
// 用户在画布执行 Paste Here 或 Paste to Replace 时触发
func (a *App) ImportClipboardImages() ClipboardImageImportResponse {
	if a.ctx == nil {
		return ClipboardImageImportResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("application context is unavailable"), false),
		}
	}
	if a.workspaceRepository == nil {
		return ClipboardImageImportResponse{
			Error: newBridgeError(errorCodeInternal, fmt.Errorf("workspace repository is unavailable"), false),
		}
	}

	sources, err := readClipboardImageSources()
	if err != nil {
		return ClipboardImageImportResponse{
			Error: newBridgeError(errorCodeReadFailed, fmt.Errorf("read clipboard images: %w", err), true),
		}
	}
	if len(sources) == 0 {
		return ClipboardImageImportResponse{Available: false}
	}
	if len(sources) > maxClipboardImageCount {
		return ClipboardImageImportResponse{
			Error: newBridgeError(
				errorCodeInvalidData,
				fmt.Errorf("clipboard contains more than %d images", maxClipboardImageCount),
				false,
			),
		}
	}

	assets, err := importClipboardImageSources(a.workspaceRepository, sources)
	if err != nil {
		return ClipboardImageImportResponse{
			Error: newBridgeError(errorCodeReadFailed, err, false),
		}
	}
	return ClipboardImageImportResponse{Available: true, Assets: assets}
}

// importClipboardImageSources 把平台读取结果逐个写入内容寻址资产仓库
// repository 来自 App sources 来自 Win32 Reader 返回值保持剪贴板文件顺序
// 单元测试直接调用该纯编排函数验证路径来源和内存来源拥有一致元数据
func importClipboardImageSources(
	repository *WorkspaceRepository,
	sources []clipboardImageSource,
) ([]ManagedAssetDTO, error) {
	assets := make([]ManagedAssetDTO, 0, len(sources))
	for sourceIndex, source := range sources {
		hasPath := source.Path != ""
		hasContent := len(source.Content) > 0
		if hasPath == hasContent {
			return nil, fmt.Errorf("clipboard image %d must contain exactly one source", sourceIndex)
		}

		var asset ManagedAssetDTO
		var err error
		if hasPath {
			asset, err = repository.ImportManagedAsset(source.Path, managedAssetKindImage)
		} else {
			assetName := source.Name
			if assetName == "" {
				assetName = "clipboard-image.png"
			}
			asset, err = repository.ImportManagedAssetContent(
				assetName,
				source.Content,
				managedAssetKindImage,
			)
		}
		if err != nil {
			return nil, fmt.Errorf("import clipboard image %d: %w", sourceIndex, err)
		}
		if source.Name != "" && hasPath {
			asset.Name = filepath.Base(source.Name)
		} else if hasPath {
			asset.Name = filepath.Base(source.Path)
		}
		assets = append(assets, asset)
	}
	return assets, nil
}
