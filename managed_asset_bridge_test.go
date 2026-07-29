package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// TestImportManagedAssetBridgeBoundaries 验证上下文 类型 对话框取消 错误和成功路径
func TestImportManagedAssetBridgeBoundaries(t *testing.T) {
	originalDialog := showManagedAssetOpenDialog
	t.Cleanup(func() {
		showManagedAssetOpenDialog = originalDialog
	})

	if response := (&App{}).ImportManagedAsset(managedAssetKindFile); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("ImportManagedAsset() missing context = %#v", response)
	}

	app := &App{ctx: context.Background()}
	if response := app.ImportManagedAsset(managedAssetKindFile); response.Error == nil || !strings.Contains(response.Error.Message, "repository") {
		t.Fatalf("ImportManagedAsset() missing repository = %#v", response)
	}
	app.workspaceRepository = NewWorkspaceRepository(t.TempDir())
	if response := app.ImportManagedAsset("unknown"); response.Error == nil || response.Error.Code != errorCodeInvalidData {
		t.Fatalf("ImportManagedAsset() invalid kind = %#v", response)
	}

	showManagedAssetOpenDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return "", errors.New("dialog failed")
	}
	if response := app.ImportManagedAsset(managedAssetKindFile); response.Error == nil || response.Error.Code != errorCodeReadFailed || !response.Error.Retryable {
		t.Fatalf("ImportManagedAsset() dialog error = %#v", response)
	}

	showManagedAssetOpenDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return "", nil
	}
	if response := app.ImportManagedAsset(managedAssetKindFile); !response.Cancelled || response.Error != nil {
		t.Fatalf("ImportManagedAsset() cancelled = %#v", response)
	}

	sourcePath := filepath.Join(t.TempDir(), "image.png")
	if err := os.WriteFile(sourcePath, testPNGContent, 0o600); err != nil {
		t.Fatalf("write source asset: %v", err)
	}
	showManagedAssetOpenDialog = func(_ context.Context, options runtime.OpenDialogOptions) (string, error) {
		if len(options.Filters) != 1 || !strings.Contains(options.Filters[0].Pattern, "*.png") {
			t.Fatalf("image filters = %#v", options.Filters)
		}
		return sourcePath, nil
	}
	response := app.ImportManagedAsset(managedAssetKindImage)
	if response.Error != nil || response.Asset == nil || response.Asset.MimeType != "image/png" {
		t.Fatalf("ImportManagedAsset() success = %#v", response)
	}
}

// TestReadManagedAssetDataURLBridge 验证本地图片只通过受控 data URL 进入前端
func TestReadManagedAssetDataURLBridge(t *testing.T) {
	if response := (&App{}).ReadManagedAssetDataURL("asset"); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("ReadManagedAssetDataURL() missing repository = %#v", response)
	}

	repository := NewWorkspaceRepository(t.TempDir())
	app := &App{workspaceRepository: repository}
	if response := app.ReadManagedAssetDataURL(strings.Repeat("c", 64) + ".png"); response.Error == nil || response.Error.Code != errorCodeReadFailed {
		t.Fatalf("ReadManagedAssetDataURL() missing asset = %#v", response)
	}

	sourcePath := filepath.Join(t.TempDir(), "image.png")
	if err := os.WriteFile(sourcePath, testPNGContent, 0o600); err != nil {
		t.Fatalf("write source asset: %v", err)
	}
	asset, err := repository.ImportManagedAsset(sourcePath, managedAssetKindImage)
	if err != nil {
		t.Fatalf("ImportManagedAsset() error = %v", err)
	}
	response := app.ReadManagedAssetDataURL(asset.ID)
	if response.Error != nil || !strings.HasPrefix(response.DataURL, "data:image/png;base64,") {
		t.Fatalf("ReadManagedAssetDataURL() = %#v", response)
	}
}
