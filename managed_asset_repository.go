package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	managedAssetsDirectoryName = "assets"
	managedAssetMaxBytes       = 64 * 1024 * 1024
	managedAssetHeaderBytes    = 512
	managedAssetSVGMimeType    = "image/svg+xml"
)

// ImportManagedAsset 把用户明确选择的本地文件复制到 ForkMind 管理目录
// sourcePath 来自系统打开对话框 kind 来自 React 的 image 或 file 创建动作
// 返回值包含内容哈希 id 原始文件名 MIME 和字节数 同内容文件会复用已有资产
// 用户在图片或文件卡片编辑器中点击选择本地文件时触发
func (repository *WorkspaceRepository) ImportManagedAsset(sourcePath string, kind string) (asset ManagedAssetDTO, returnErr error) {
	if kind != managedAssetKindImage && kind != managedAssetKindFile {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset kind %q is invalid", kind)
	}
	if strings.TrimSpace(sourcePath) == "" {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset source path cannot be empty")
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return ManagedAssetDTO{}, fmt.Errorf("open managed asset source: %w", err)
	}
	defer func() {
		if closeErr := sourceFile.Close(); closeErr != nil && returnErr == nil {
			returnErr = fmt.Errorf("close managed asset source: %w", closeErr)
		}
	}()

	sourceInfo, err := sourceFile.Stat()
	if err != nil {
		return ManagedAssetDTO{}, fmt.Errorf("inspect managed asset source: %w", err)
	}
	if !sourceInfo.Mode().IsRegular() {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset source must be a regular file")
	}
	if sourceInfo.Size() <= 0 {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset source cannot be empty")
	}
	if sourceInfo.Size() > managedAssetMaxBytes {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset exceeds %d bytes", managedAssetMaxBytes)
	}

	bufferedSource := bufio.NewReader(sourceFile)
	header, err := bufferedSource.Peek(min(managedAssetHeaderBytes, int(sourceInfo.Size())))
	if err != nil && !errors.Is(err, bufio.ErrBufferFull) && !errors.Is(err, io.EOF) {
		return ManagedAssetDTO{}, fmt.Errorf("inspect managed asset content: %w", err)
	}
	mimeType := detectManagedAssetMimeType(sourceInfo.Name(), header)
	if kind == managedAssetKindImage && !strings.HasPrefix(mimeType, "image/") {
		return ManagedAssetDTO{}, fmt.Errorf("selected file is not a supported image")
	}

	assetsDirectory := filepath.Join(repository.rootDir, managedAssetsDirectoryName)
	if err := os.MkdirAll(assetsDirectory, 0o755); err != nil {
		return ManagedAssetDTO{}, fmt.Errorf("create managed assets directory: %w", err)
	}
	temporaryFile, err := os.CreateTemp(assetsDirectory, ".forkmind-asset-*.tmp")
	if err != nil {
		return ManagedAssetDTO{}, fmt.Errorf("create managed asset temporary file: %w", err)
	}
	temporaryPath := temporaryFile.Name()
	defer func() {
		removeErr := os.Remove(temporaryPath)
		if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) && returnErr == nil {
			returnErr = fmt.Errorf("remove managed asset temporary file: %w", removeErr)
		}
	}()

	digest := sha256.New()
	writtenBytes, copyErr := io.Copy(
		io.MultiWriter(temporaryFile, digest),
		io.LimitReader(bufferedSource, managedAssetMaxBytes+1),
	)
	if copyErr != nil {
		if closeErr := temporaryFile.Close(); closeErr != nil {
			return ManagedAssetDTO{}, fmt.Errorf("copy managed asset: %v; close temporary file: %w", copyErr, closeErr)
		}
		return ManagedAssetDTO{}, fmt.Errorf("copy managed asset: %w", copyErr)
	}
	if writtenBytes > managedAssetMaxBytes {
		if closeErr := temporaryFile.Close(); closeErr != nil {
			return ManagedAssetDTO{}, fmt.Errorf("managed asset exceeds %d bytes; close temporary file: %w", managedAssetMaxBytes, closeErr)
		}
		return ManagedAssetDTO{}, fmt.Errorf("managed asset exceeds %d bytes", managedAssetMaxBytes)
	}
	if err := temporaryFile.Sync(); err != nil {
		if closeErr := temporaryFile.Close(); closeErr != nil {
			return ManagedAssetDTO{}, fmt.Errorf("sync managed asset temporary file: %v; close temporary file: %w", err, closeErr)
		}
		return ManagedAssetDTO{}, fmt.Errorf("sync managed asset temporary file: %w", err)
	}
	if err := temporaryFile.Close(); err != nil {
		return ManagedAssetDTO{}, fmt.Errorf("close managed asset temporary file: %w", err)
	}

	assetID := hex.EncodeToString(digest.Sum(nil)) + normalizeManagedAssetExtension(sourceInfo.Name())
	targetPath, err := repository.resolveManagedAssetPath(assetID)
	if err != nil {
		return ManagedAssetDTO{}, err
	}
	if _, err := os.Stat(targetPath); err == nil {
		return ManagedAssetDTO{
			ID:        assetID,
			Name:      sourceInfo.Name(),
			MimeType:  mimeType,
			SizeBytes: writtenBytes,
		}, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return ManagedAssetDTO{}, fmt.Errorf("inspect managed asset target: %w", err)
	}

	if err := os.Rename(temporaryPath, targetPath); err != nil {
		return ManagedAssetDTO{}, fmt.Errorf("promote managed asset: %w", err)
	}

	return ManagedAssetDTO{
		ID:        assetID,
		Name:      sourceInfo.Name(),
		MimeType:  mimeType,
		SizeBytes: writtenBytes,
	}, nil
}

// ImportManagedAssetContent 把内存中的受控内容写入 ForkMind 管理目录
// fileName 来自剪贴板文件名或内部生成名称 content 来自 Win32 剪贴板读取 kind 决定 MIME 约束
// 返回值包含内容哈希 id 展示名称 MIME 和大小 同内容会复用已有资产
// 用户粘贴截图或资源管理器中的图片文件时由 Clipboard Bridge 触发
func (repository *WorkspaceRepository) ImportManagedAssetContent(
	fileName string,
	content []byte,
	kind string,
) (ManagedAssetDTO, error) {
	if repository == nil {
		return ManagedAssetDTO{}, fmt.Errorf("workspace repository is unavailable")
	}
	if kind != managedAssetKindImage && kind != managedAssetKindFile {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset kind %q is invalid", kind)
	}
	normalizedName := strings.TrimSpace(filepath.Base(fileName))
	if normalizedName == "" || normalizedName == "." {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset name cannot be empty")
	}
	if len(content) == 0 {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset content cannot be empty")
	}
	if len(content) > managedAssetMaxBytes {
		return ManagedAssetDTO{}, fmt.Errorf("managed asset exceeds %d bytes", managedAssetMaxBytes)
	}

	mimeType := detectManagedAssetMimeType(
		normalizedName,
		content[:min(len(content), managedAssetHeaderBytes)],
	)
	if kind == managedAssetKindImage && !strings.HasPrefix(mimeType, "image/") {
		return ManagedAssetDTO{}, fmt.Errorf("clipboard content is not a supported image")
	}

	digest := sha256.Sum256(content)
	assetID := hex.EncodeToString(digest[:]) + normalizeManagedAssetExtension(normalizedName)
	if err := repository.storeManagedAssetContent(assetID, content); err != nil {
		return ManagedAssetDTO{}, fmt.Errorf("store managed asset content: %w", err)
	}

	return ManagedAssetDTO{
		ID:        assetID,
		Name:      normalizedName,
		MimeType:  mimeType,
		SizeBytes: int64(len(content)),
	}, nil
}

// ReadManagedAsset 读取已由 ForkMind 管理的资产内容
// assetID 来自已校验节点元数据 返回原始字节和按内容重新识别的 MIME
// 图片卡片需要生成渲染进程预览时触发 非法路径和超限文件会被拒绝
func (repository *WorkspaceRepository) ReadManagedAsset(assetID string) (content []byte, mimeType string, returnErr error) {
	assetPath, err := repository.resolveManagedAssetPath(assetID)
	if err != nil {
		return nil, "", err
	}

	assetFile, err := os.Open(assetPath)
	if err != nil {
		return nil, "", fmt.Errorf("open managed asset: %w", err)
	}
	defer func() {
		if closeErr := assetFile.Close(); closeErr != nil && returnErr == nil {
			content = nil
			mimeType = ""
			returnErr = fmt.Errorf("close managed asset: %w", closeErr)
		}
	}()

	assetInfo, err := assetFile.Stat()
	if err != nil {
		return nil, "", fmt.Errorf("inspect managed asset: %w", err)
	}
	if assetInfo.Size() > managedAssetMaxBytes {
		return nil, "", fmt.Errorf("managed asset exceeds %d bytes", managedAssetMaxBytes)
	}
	content, err = io.ReadAll(io.LimitReader(assetFile, managedAssetMaxBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read managed asset: %w", err)
	}
	if len(content) == 0 {
		return nil, "", fmt.Errorf("managed asset is empty")
	}
	if len(content) > managedAssetMaxBytes {
		return nil, "", fmt.Errorf("managed asset exceeds %d bytes", managedAssetMaxBytes)
	}

	return content, detectManagedAssetMimeType(assetID, content[:min(len(content), managedAssetHeaderBytes)]), nil
}

// resolveManagedAssetPath 把稳定 asset id 解析到工作区 assets 目录
// assetID 来自节点或 Bridge 入参 返回值保证不会通过绝对路径或 .. 越出管理目录
// 导入 去重 预览和未来导出流程共用该路径边界
func (repository *WorkspaceRepository) resolveManagedAssetPath(assetID string) (string, error) {
	if err := validateManagedAssetID(assetID); err != nil {
		return "", err
	}

	return filepath.Join(repository.rootDir, managedAssetsDirectoryName, assetID), nil
}

// validateManagedAssetID 校验内容哈希文件名格式
// assetID 来自外部 JSON 或前端 Bridge 调用 返回 nil 表示可安全作为单层文件名
// 任意资产读取或写入前触发以阻止路径穿越
func validateManagedAssetID(assetID string) error {
	if assetID == "" || filepath.Base(assetID) != assetID || strings.ContainsAny(assetID, `/\\`) {
		return fmt.Errorf("managed asset id is invalid")
	}

	digestPart := strings.TrimSuffix(assetID, filepath.Ext(assetID))
	if len(digestPart) != sha256.Size*2 {
		return fmt.Errorf("managed asset id digest is invalid")
	}
	if _, err := hex.DecodeString(digestPart); err != nil {
		return fmt.Errorf("managed asset id digest is invalid: %w", err)
	}

	return nil
}

// normalizeManagedAssetExtension 只保留短小的 ASCII 字母数字扩展名
// fileName 来自用户选择文件 返回值包含前导点或为空
// 内容哈希 id 生成时触发 防止原始文件名把特殊字符带入管理路径
func normalizeManagedAssetExtension(fileName string) string {
	extension := strings.ToLower(filepath.Ext(fileName))
	if len(extension) < 2 || len(extension) > 11 {
		return ""
	}
	for _, character := range extension[1:] {
		if character > unicode.MaxASCII || !unicode.IsLetter(character) && !unicode.IsDigit(character) {
			return ""
		}
	}

	return extension
}

// detectManagedAssetMimeType 结合扩展名与内容头识别 MIME
// fileName 来自源文件或 asset id header 最多读取前 512 字节
// 返回值用于图片类型约束 节点元数据和 data URL 生成
func detectManagedAssetMimeType(fileName string, header []byte) string {
	extension := strings.ToLower(filepath.Ext(fileName))
	extensionMimeType := strings.Split(
		mime.TypeByExtension(extension),
		";",
	)[0]
	if extension == ".svg" {
		extensionMimeType = managedAssetSVGMimeType
	}
	if len(header) == 0 {
		if extensionMimeType != "" {
			return extensionMimeType
		}
		return "application/octet-stream"
	}

	contentMimeType := http.DetectContentType(header)
	normalizedContentMimeType := strings.Split(contentMimeType, ";")[0]
	if extensionMimeType == managedAssetSVGMimeType &&
		(normalizedContentMimeType == "text/plain" || normalizedContentMimeType == "text/xml") {
		return extensionMimeType
	}
	if normalizedContentMimeType != "application/octet-stream" {
		return normalizedContentMimeType
	}
	if extensionMimeType != "" {
		return extensionMimeType
	}

	return "application/octet-stream"
}
