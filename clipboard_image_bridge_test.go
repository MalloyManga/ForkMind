package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestImportManagedAssetContentStoresAndDeduplicates 验证内存图片使用内容哈希落盘并复用已有内容
func TestImportManagedAssetContentStoresAndDeduplicates(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	pngContent := createClipboardTestPNG(t)
	firstAsset, err := repository.ImportManagedAssetContent("Clipboard.PNG", pngContent, managedAssetKindImage)
	if err != nil {
		t.Fatalf("ImportManagedAssetContent() error = %v", err)
	}
	secondAsset, err := repository.ImportManagedAssetContent("duplicate.png", pngContent, managedAssetKindImage)
	if err != nil {
		t.Fatalf("ImportManagedAssetContent() duplicate error = %v", err)
	}
	if firstAsset.ID != secondAsset.ID || firstAsset.MimeType != "image/png" || firstAsset.Name != "Clipboard.PNG" {
		t.Fatalf("assets = %#v %#v", firstAsset, secondAsset)
	}
	storedContent, _, err := repository.ReadManagedAsset(firstAsset.ID)
	if err != nil {
		t.Fatalf("ReadManagedAsset() error = %v", err)
	}
	if !bytes.Equal(storedContent, pngContent) {
		t.Fatal("stored clipboard content differs from source")
	}
}

// TestImportManagedAssetContentRejectsInvalidInputs 验证内存入口仍执行名称 类型 内容和大小校验
func TestImportManagedAssetContentRejectsInvalidInputs(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	for _, testCase := range []struct {
		name          string
		fileName      string
		content       []byte
		kind          string
		errorFragment string
	}{
		{name: "empty name", content: testPNGContent, kind: managedAssetKindImage, errorFragment: "name"},
		{name: "empty content", fileName: "image.png", kind: managedAssetKindImage, errorFragment: "empty"},
		{name: "invalid kind", fileName: "image.png", content: testPNGContent, kind: "unknown", errorFragment: "kind"},
		{name: "text as image", fileName: "image.png", content: []byte("plain text"), kind: managedAssetKindImage, errorFragment: "not a supported image"},
		{name: "too large", fileName: "image.png", content: make([]byte, managedAssetMaxBytes+1), kind: managedAssetKindImage, errorFragment: "exceeds"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := repository.ImportManagedAssetContent(testCase.fileName, testCase.content, testCase.kind)
			if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
				t.Fatalf("ImportManagedAssetContent() error = %v want fragment %q", err, testCase.errorFragment)
			}
		})
	}
}

// TestImportClipboardImageSourcesSupportsMemoryAndFiles 验证截图内容和资源管理器文件共享资产导入事务
func TestImportClipboardImageSourcesSupportsMemoryAndFiles(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	pngContent := createClipboardTestPNG(t)
	filePath := filepath.Join(t.TempDir(), "copied-file.png")
	if err := os.WriteFile(filePath, pngContent, 0o600); err != nil {
		t.Fatalf("write copied image: %v", err)
	}

	assets, err := importClipboardImageSources(repository, []clipboardImageSource{
		{Name: "screenshot.png", Content: pngContent},
		{Path: filePath},
	})
	if err != nil {
		t.Fatalf("importClipboardImageSources() error = %v", err)
	}
	if len(assets) != 2 || assets[0].ID != assets[1].ID {
		t.Fatalf("assets = %#v", assets)
	}
	if assets[0].Name != "screenshot.png" || assets[1].Name != "copied-file.png" {
		t.Fatalf("asset names = %q %q", assets[0].Name, assets[1].Name)
	}
}

// TestImportClipboardImagesBridgeBoundaries 验证无图片降级 读取失败 数量限制和成功返回
func TestImportClipboardImagesBridgeBoundaries(t *testing.T) {
	originalReader := readClipboardImageSources
	defer func() { readClipboardImageSources = originalReader }()

	if response := (&App{}).ImportClipboardImages(); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("missing context response = %#v", response)
	}
	if response := (&App{ctx: context.Background()}).ImportClipboardImages(); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("missing repository response = %#v", response)
	}
	app := &App{ctx: context.Background(), workspaceRepository: NewWorkspaceRepository(t.TempDir())}
	readClipboardImageSources = func() ([]clipboardImageSource, error) { return nil, nil }
	if response := app.ImportClipboardImages(); response.Available || response.Error != nil {
		t.Fatalf("empty clipboard response = %#v", response)
	}
	readClipboardImageSources = func() ([]clipboardImageSource, error) { return nil, fmt.Errorf("locked") }
	if response := app.ImportClipboardImages(); response.Error == nil || response.Error.Code != errorCodeReadFailed {
		t.Fatalf("reader error response = %#v", response)
	}
	readClipboardImageSources = func() ([]clipboardImageSource, error) {
		return make([]clipboardImageSource, maxClipboardImageCount+1), nil
	}
	if response := app.ImportClipboardImages(); response.Error == nil || response.Error.Code != errorCodeInvalidData {
		t.Fatalf("too many response = %#v", response)
	}
	pngContent := createClipboardTestPNG(t)
	readClipboardImageSources = func() ([]clipboardImageSource, error) {
		return []clipboardImageSource{{Name: "clipboard.png", Content: pngContent}}, nil
	}
	response := app.ImportClipboardImages()
	if response.Error != nil || !response.Available || len(response.Assets) != 1 {
		t.Fatalf("success response = %#v", response)
	}
}

// TestImportClipboardImageSourcesRejectsAmbiguousSource 验证路径和内存内容不能同时存在或同时缺失
func TestImportClipboardImageSourcesRejectsAmbiguousSource(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	for _, source := range []clipboardImageSource{
		{},
		{Path: "image.png", Content: testPNGContent},
	} {
		if _, err := importClipboardImageSources(repository, []clipboardImageSource{source}); err == nil || !strings.Contains(err.Error(), "exactly one") {
			t.Fatalf("importClipboardImageSources() error = %v", err)
		}
	}
}

// createClipboardTestPNG 创建可被标准库完整解码的微型 PNG 测试资产
func createClipboardTestPNG(t *testing.T) []byte {
	t.Helper()
	testImage := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	testImage.SetNRGBA(0, 0, color.NRGBA{R: 0xff, A: 0xff})
	testImage.SetNRGBA(1, 0, color.NRGBA{B: 0xff, A: 0xff})
	var encodedPNG bytes.Buffer
	if err := png.Encode(&encodedPNG, testImage); err != nil {
		t.Fatalf("encode test PNG: %v", err)
	}
	return encodedPNG.Bytes()
}
