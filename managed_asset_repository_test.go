package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var testPNGContent = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
}

// TestWorkspaceRepositoryImportsAndReadsManagedAsset 验证内容哈希复制 去重和预览读取闭环
func TestWorkspaceRepositoryImportsAndReadsManagedAsset(t *testing.T) {
	t.Parallel()

	rootDirectory := t.TempDir()
	sourceDirectory := t.TempDir()
	sourcePath := filepath.Join(sourceDirectory, "Example.PNG")
	if err := os.WriteFile(sourcePath, testPNGContent, 0o600); err != nil {
		t.Fatalf("write source asset: %v", err)
	}

	repository := NewWorkspaceRepository(rootDirectory)
	asset, err := repository.ImportManagedAsset(sourcePath, managedAssetKindImage)
	if err != nil {
		t.Fatalf("ImportManagedAsset() error = %v", err)
	}
	digest := sha256.Sum256(testPNGContent)
	wantID := hex.EncodeToString(digest[:]) + ".png"
	if asset.ID != wantID || asset.Name != "Example.PNG" || asset.MimeType != "image/png" || asset.SizeBytes != int64(len(testPNGContent)) {
		t.Fatalf("ImportManagedAsset() = %#v", asset)
	}

	managedPath := filepath.Join(rootDirectory, managedAssetsDirectoryName, wantID)
	storedContent, err := os.ReadFile(managedPath)
	if err != nil {
		t.Fatalf("read stored asset: %v", err)
	}
	if !bytes.Equal(storedContent, testPNGContent) {
		t.Fatalf("stored content = %v, want %v", storedContent, testPNGContent)
	}

	duplicateAsset, err := repository.ImportManagedAsset(sourcePath, managedAssetKindFile)
	if err != nil {
		t.Fatalf("ImportManagedAsset() duplicate error = %v", err)
	}
	if duplicateAsset.ID != asset.ID {
		t.Fatalf("duplicate asset id = %q, want %q", duplicateAsset.ID, asset.ID)
	}

	readContent, mimeType, err := repository.ReadManagedAsset(asset.ID)
	if err != nil {
		t.Fatalf("ReadManagedAsset() error = %v", err)
	}
	if !bytes.Equal(readContent, testPNGContent) || mimeType != "image/png" {
		t.Fatalf("ReadManagedAsset() = (%v, %q)", readContent, mimeType)
	}
}

// TestWorkspaceRepositoryRejectsInvalidManagedAssetInputs 验证类型 路径 文件形态 大小和 MIME 边界
func TestWorkspaceRepositoryRejectsInvalidManagedAssetInputs(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	sourceDirectory := t.TempDir()
	textPath := filepath.Join(sourceDirectory, "fake.png")
	if err := os.WriteFile(textPath, []byte("plain text"), 0o600); err != nil {
		t.Fatalf("write text asset: %v", err)
	}
	emptyPath := filepath.Join(sourceDirectory, "empty.txt")
	if err := os.WriteFile(emptyPath, nil, 0o600); err != nil {
		t.Fatalf("write empty asset: %v", err)
	}
	largePath := filepath.Join(sourceDirectory, "large.bin")
	largeFile, err := os.Create(largePath)
	if err != nil {
		t.Fatalf("create large asset: %v", err)
	}
	if err := largeFile.Truncate(managedAssetMaxBytes + 1); err != nil {
		largeFile.Close()
		t.Fatalf("truncate large asset: %v", err)
	}
	if err := largeFile.Close(); err != nil {
		t.Fatalf("close large asset: %v", err)
	}

	testCases := []struct {
		name          string
		path          string
		kind          string
		errorFragment string
	}{
		{name: "kind", path: textPath, kind: "unknown", errorFragment: "kind"},
		{name: "empty path", path: "", kind: managedAssetKindFile, errorFragment: "path"},
		{name: "missing", path: filepath.Join(sourceDirectory, "missing"), kind: managedAssetKindFile, errorFragment: "open"},
		{name: "directory", path: sourceDirectory, kind: managedAssetKindFile, errorFragment: "regular file"},
		{name: "empty file", path: emptyPath, kind: managedAssetKindFile, errorFragment: "cannot be empty"},
		{name: "too large", path: largePath, kind: managedAssetKindFile, errorFragment: "exceeds"},
		{name: "fake image", path: textPath, kind: managedAssetKindImage, errorFragment: "not a supported image"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := repository.ImportManagedAsset(testCase.path, testCase.kind)
			if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
				t.Fatalf("ImportManagedAsset() error = %v, want %q", err, testCase.errorFragment)
			}
		})
	}
}

// TestManagedAssetPathAndMimeHelpers 验证哈希 id 扩展名清洗与 MIME 检测规则
func TestManagedAssetPathAndMimeHelpers(t *testing.T) {
	t.Parallel()

	validDigest := strings.Repeat("a", sha256.Size*2)
	for _, assetID := range []string{validDigest, validDigest + ".png"} {
		if err := validateManagedAssetID(assetID); err != nil {
			t.Fatalf("validateManagedAssetID(%q) error = %v", assetID, err)
		}
	}
	for _, assetID := range []string{"", "../" + validDigest, strings.Repeat("g", sha256.Size*2), "short.png"} {
		if err := validateManagedAssetID(assetID); err == nil {
			t.Fatalf("validateManagedAssetID(%q) error = nil", assetID)
		}
	}

	if extension := normalizeManagedAssetExtension("Photo.JPEG"); extension != ".jpeg" {
		t.Fatalf("normalizeManagedAssetExtension() = %q", extension)
	}
	for _, fileName := range []string{"no-extension", "bad.a-b", "long.abcdefghijkl"} {
		if extension := normalizeManagedAssetExtension(fileName); extension != "" {
			t.Fatalf("normalizeManagedAssetExtension(%q) = %q", fileName, extension)
		}
	}

	if mimeType := detectManagedAssetMimeType("fake.png", []byte("plain text")); mimeType != "text/plain" {
		t.Fatalf("fake png MIME = %q", mimeType)
	}
	if mimeType := detectManagedAssetMimeType("vector.svg", []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")); mimeType != "image/svg+xml" {
		t.Fatalf("svg MIME = %q", mimeType)
	}
	if mimeType := detectManagedAssetMimeType("unknown", nil); mimeType != "application/octet-stream" {
		t.Fatalf("empty MIME = %q", mimeType)
	}

	repository := NewWorkspaceRepository(t.TempDir())
	if _, err := repository.resolveManagedAssetPath("../" + validDigest); err == nil {
		t.Fatal("resolveManagedAssetPath() traversal error = nil")
	}
}

// TestWorkspaceRepositoryReadManagedAssetErrors 验证非法 缺失和空管理资产不会进入渲染进程
func TestWorkspaceRepositoryReadManagedAssetErrors(t *testing.T) {
	t.Parallel()

	repository := NewWorkspaceRepository(t.TempDir())
	validID := strings.Repeat("b", sha256.Size*2) + ".bin"
	if _, _, err := repository.ReadManagedAsset("../bad"); err == nil {
		t.Fatal("ReadManagedAsset() traversal error = nil")
	}
	if _, _, err := repository.ReadManagedAsset(validID); err == nil || !strings.Contains(err.Error(), "open") {
		t.Fatalf("ReadManagedAsset() missing error = %v", err)
	}
	assetPath, err := repository.resolveManagedAssetPath(validID)
	if err != nil {
		t.Fatalf("resolveManagedAssetPath() error = %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(assetPath), 0o755); err != nil {
		t.Fatalf("create assets directory: %v", err)
	}
	if err := os.WriteFile(assetPath, nil, 0o600); err != nil {
		t.Fatalf("write empty managed asset: %v", err)
	}
	if _, _, err := repository.ReadManagedAsset(validID); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("ReadManagedAsset() empty error = %v", err)
	}
}
