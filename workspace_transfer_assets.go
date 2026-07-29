package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const workspaceEmbeddedAssetsMaxBytes = 192 * 1024 * 1024

// EmbeddedManagedAssetDTO 是单文件工作区导出中的二进制资产包装
// DataBase64 只存在于用户主动导出的 JSON 不进入自动保存 Workspace Repository
type EmbeddedManagedAssetDTO struct {
	ID         string `json:"id"`
	MimeType   string `json:"mimeType"`
	SizeBytes  int64  `json:"sizeBytes"`
	DataBase64 string `json:"dataBase64"`
}

// workspaceExportDocumentDTO 在标准工作区字段旁附加可迁移资产
// 匿名嵌入让旧版纯 Workspace JSON 仍可被同一个严格 Decoder 接受
type workspaceExportDocumentDTO struct {
	WorkspaceDocumentDTO
	Assets []EmbeddedManagedAssetDTO `json:"assets,omitempty"`
}

// buildWorkspaceExportDocument 收集工作区实际引用的本地资产并嵌入导出文档
// document 来自 React 完整快照 repository 指向当前用户数据目录
// 返回值可直接写入单文件 JSON 资产缺失 损坏或总量超限时返回错误
// 用户确认 Export 目标路径后触发
func buildWorkspaceExportDocument(
	document WorkspaceDocumentDTO,
	repository *WorkspaceRepository,
) (workspaceExportDocumentDTO, error) {
	assetIDs := collectReferencedManagedAssetIDs(document)
	if len(assetIDs) == 0 {
		return workspaceExportDocumentDTO{WorkspaceDocumentDTO: document}, nil
	}
	if repository == nil {
		return workspaceExportDocumentDTO{}, fmt.Errorf("workspace repository is unavailable")
	}

	embeddedAssets := make([]EmbeddedManagedAssetDTO, 0, len(assetIDs))
	var totalBytes int64
	for _, assetID := range assetIDs {
		content, mimeType, err := repository.ReadManagedAsset(assetID)
		if err != nil {
			return workspaceExportDocumentDTO{}, fmt.Errorf("read referenced managed asset %q: %w", assetID, err)
		}
		if err := validateManagedAssetDigest(assetID, content); err != nil {
			return workspaceExportDocumentDTO{}, err
		}

		totalBytes += int64(len(content))
		if totalBytes > workspaceEmbeddedAssetsMaxBytes {
			return workspaceExportDocumentDTO{}, fmt.Errorf("workspace embedded assets exceed %d bytes", workspaceEmbeddedAssetsMaxBytes)
		}
		embeddedAssets = append(embeddedAssets, EmbeddedManagedAssetDTO{
			ID:         assetID,
			MimeType:   mimeType,
			SizeBytes:  int64(len(content)),
			DataBase64: base64.StdEncoding.EncodeToString(content),
		})
	}

	return workspaceExportDocumentDTO{
		WorkspaceDocumentDTO: document,
		Assets:               embeddedAssets,
	}, nil
}

// collectReferencedManagedAssetIDs 按首次出现顺序收集 Image File 节点使用的资产 id
// document 来自已校验工作区 返回值自动去重且不包含空资产节点
// 导出资产嵌入前触发
func collectReferencedManagedAssetIDs(document WorkspaceDocumentDTO) []string {
	assetIDs := make([]string, 0)
	seenAssetIDs := make(map[string]struct{})
	for _, thread := range document.Threads {
		for _, card := range thread.Cards {
			if card.Asset == nil {
				continue
			}
			if _, exists := seenAssetIDs[card.Asset.ID]; exists {
				continue
			}
			seenAssetIDs[card.Asset.ID] = struct{}{}
			assetIDs = append(assetIDs, card.Asset.ID)
		}
	}

	return assetIDs
}

// decodeWorkspaceExportDocument 严格解析导入 JSON 并验证全部嵌入资产
// content 来自受大小限制且 UTF-8 合法的系统文件读取结果
// 返回标准工作区与已解码资产 任何未知字段 哈希错误或重复 id 都会拒绝
// ImportWorkspace 在把数据交给 React 前触发
func decodeWorkspaceExportDocument(
	content string,
) (WorkspaceDocumentDTO, []EmbeddedManagedAssetDTO, error) {
	decoder := json.NewDecoder(strings.NewReader(content))
	decoder.DisallowUnknownFields()
	var exportDocument workspaceExportDocumentDTO
	if err := decoder.Decode(&exportDocument); err != nil {
		return WorkspaceDocumentDTO{}, nil, fmt.Errorf("decode workspace import: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return WorkspaceDocumentDTO{}, nil, err
	}
	if err := validateWorkspaceDocument(exportDocument.WorkspaceDocumentDTO); err != nil {
		return WorkspaceDocumentDTO{}, nil, fmt.Errorf("validate imported workspace: %w", err)
	}

	seenAssetIDs := make(map[string]struct{}, len(exportDocument.Assets))
	var totalBytes int64
	for assetIndex, asset := range exportDocument.Assets {
		if _, duplicated := seenAssetIDs[asset.ID]; duplicated {
			return WorkspaceDocumentDTO{}, nil, fmt.Errorf("assets[%d].id %q is duplicated", assetIndex, asset.ID)
		}
		seenAssetIDs[asset.ID] = struct{}{}

		contentBytes, err := decodeEmbeddedManagedAsset(asset)
		if err != nil {
			return WorkspaceDocumentDTO{}, nil, fmt.Errorf("assets[%d]: %w", assetIndex, err)
		}
		totalBytes += int64(len(contentBytes))
		if totalBytes > workspaceEmbeddedAssetsMaxBytes {
			return WorkspaceDocumentDTO{}, nil, fmt.Errorf("workspace embedded assets exceed %d bytes", workspaceEmbeddedAssetsMaxBytes)
		}
	}

	return exportDocument.WorkspaceDocumentDTO, exportDocument.Assets, nil
}

// decodeEmbeddedManagedAsset 校验单个 Base64 资产的 id 大小 MIME 与内容哈希
// asset 来自外部导入 JSON 返回原始字节供本地 Repository 落盘
// 所有嵌入资产在任何磁盘写入前都会先经过该函数
func decodeEmbeddedManagedAsset(asset EmbeddedManagedAssetDTO) ([]byte, error) {
	if err := validateManagedAssetID(asset.ID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(asset.MimeType) == "" {
		return nil, fmt.Errorf("mimeType cannot be empty")
	}
	if asset.SizeBytes <= 0 || asset.SizeBytes > managedAssetMaxBytes {
		return nil, fmt.Errorf("sizeBytes must be between 1 and %d", managedAssetMaxBytes)
	}
	content, err := base64.StdEncoding.DecodeString(asset.DataBase64)
	if err != nil {
		return nil, fmt.Errorf("decode dataBase64: %w", err)
	}
	if int64(len(content)) != asset.SizeBytes {
		return nil, fmt.Errorf("decoded size %d does not match sizeBytes %d", len(content), asset.SizeBytes)
	}
	if err := validateManagedAssetDigest(asset.ID, content); err != nil {
		return nil, err
	}

	return content, nil
}

// validateManagedAssetDigest 确认资产 id 中的 SHA-256 与真实内容一致
// assetID 来自节点或导入包装 content 来自本地读取或 Base64 解码
// 返回 nil 表示内容寻址关系可信 导出和导入都会调用
func validateManagedAssetDigest(assetID string, content []byte) error {
	if err := validateManagedAssetID(assetID); err != nil {
		return err
	}
	wantDigest := strings.TrimSuffix(assetID, filepath.Ext(assetID))
	actualDigest := sha256.Sum256(content)
	if hex.EncodeToString(actualDigest[:]) != wantDigest {
		return fmt.Errorf("managed asset %q content digest does not match id", assetID)
	}

	return nil
}

// storeEmbeddedManagedAssets 把已通过完整文档校验的导入资产写入本地管理目录
// repository 指向当前用户数据目录 assets 来自 decodeWorkspaceExportDocument
// 返回 nil 表示所有资产已存在或已安全写入 React 随后才会水化工作区
func storeEmbeddedManagedAssets(
	repository *WorkspaceRepository,
	assets []EmbeddedManagedAssetDTO,
) error {
	if len(assets) == 0 {
		return nil
	}
	if repository == nil {
		return fmt.Errorf("workspace repository is unavailable")
	}

	decodedAssets := make([][]byte, len(assets))
	for assetIndex, asset := range assets {
		content, err := decodeEmbeddedManagedAsset(asset)
		if err != nil {
			return fmt.Errorf("validate embedded asset %d: %w", assetIndex, err)
		}
		decodedAssets[assetIndex] = content
	}
	for assetIndex, asset := range assets {
		if err := repository.storeManagedAssetContent(asset.ID, decodedAssets[assetIndex]); err != nil {
			return fmt.Errorf("store embedded asset %q: %w", asset.ID, err)
		}
	}

	return nil
}

// storeManagedAssetContent 写入经过哈希校验的资产内容
// assetID 和 content 来自已验证导入文档 相同现有内容直接复用 不同内容拒绝覆盖
// 单文件工作区导入恢复 assets 目录时触发
func (repository *WorkspaceRepository) storeManagedAssetContent(assetID string, content []byte) (returnErr error) {
	if err := validateManagedAssetDigest(assetID, content); err != nil {
		return err
	}
	targetPath, err := repository.resolveManagedAssetPath(assetID)
	if err != nil {
		return err
	}
	if existingContent, err := os.ReadFile(targetPath); err == nil {
		if bytes.Equal(existingContent, content) {
			return nil
		}
		return fmt.Errorf("managed asset target exists with different content")
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect managed asset target: %w", err)
	}

	assetsDirectory := filepath.Dir(targetPath)
	if err := os.MkdirAll(assetsDirectory, 0o755); err != nil {
		return fmt.Errorf("create managed assets directory: %w", err)
	}
	temporaryFile, err := os.CreateTemp(assetsDirectory, ".forkmind-import-asset-*.tmp")
	if err != nil {
		return fmt.Errorf("create managed asset import temporary file: %w", err)
	}
	temporaryPath := temporaryFile.Name()
	defer func() {
		removeErr := os.Remove(temporaryPath)
		if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) && returnErr == nil {
			returnErr = fmt.Errorf("remove managed asset import temporary file: %w", removeErr)
		}
	}()

	if _, err := temporaryFile.Write(content); err != nil {
		if closeErr := temporaryFile.Close(); closeErr != nil {
			return fmt.Errorf("write managed asset import: %v; close temporary file: %w", err, closeErr)
		}
		return fmt.Errorf("write managed asset import: %w", err)
	}
	if err := temporaryFile.Sync(); err != nil {
		if closeErr := temporaryFile.Close(); closeErr != nil {
			return fmt.Errorf("sync managed asset import: %v; close temporary file: %w", err, closeErr)
		}
		return fmt.Errorf("sync managed asset import: %w", err)
	}
	if err := temporaryFile.Close(); err != nil {
		return fmt.Errorf("close managed asset import temporary file: %w", err)
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		return fmt.Errorf("promote managed asset import: %w", err)
	}

	return nil
}
