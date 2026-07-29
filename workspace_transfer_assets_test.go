package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestWorkspaceTransferEmbedsAndRestoresManagedAssets 验证单文件导出导入可迁移本地资产
func TestWorkspaceTransferEmbedsAndRestoresManagedAssets(t *testing.T) {
	t.Parallel()

	sourceRepository := NewWorkspaceRepository(t.TempDir())
	sourcePath := filepath.Join(t.TempDir(), "diagram.png")
	if err := os.WriteFile(sourcePath, testPNGContent, 0o600); err != nil {
		t.Fatalf("write source asset: %v", err)
	}
	asset, err := sourceRepository.ImportManagedAsset(sourcePath, managedAssetKindImage)
	if err != nil {
		t.Fatalf("ImportManagedAsset() error = %v", err)
	}

	document := createWorkspaceWithReferencedAsset(asset)
	exportDocument, err := buildWorkspaceExportDocument(document, sourceRepository)
	if err != nil {
		t.Fatalf("buildWorkspaceExportDocument() error = %v", err)
	}
	if len(exportDocument.Assets) != 1 || exportDocument.Assets[0].ID != asset.ID {
		t.Fatalf("embedded assets = %#v", exportDocument.Assets)
	}
	encodedExport, err := json.Marshal(exportDocument)
	if err != nil {
		t.Fatalf("marshal export: %v", err)
	}

	decodedDocument, decodedAssets, err := decodeWorkspaceExportDocument(string(encodedExport))
	if err != nil {
		t.Fatalf("decodeWorkspaceExportDocument() error = %v", err)
	}
	if decodedDocument.Threads[0].Cards[0].Asset == nil || decodedDocument.Threads[0].Cards[0].Asset.ID != asset.ID {
		t.Fatalf("decoded document asset = %#v", decodedDocument.Threads[0].Cards[0].Asset)
	}

	targetRepository := NewWorkspaceRepository(t.TempDir())
	if err := storeEmbeddedManagedAssets(targetRepository, decodedAssets); err != nil {
		t.Fatalf("storeEmbeddedManagedAssets() error = %v", err)
	}
	content, mimeType, err := targetRepository.ReadManagedAsset(asset.ID)
	if err != nil {
		t.Fatalf("ReadManagedAsset() error = %v", err)
	}
	if string(content) != string(testPNGContent) || mimeType != "image/png" {
		t.Fatalf("restored asset = (%v, %q)", content, mimeType)
	}
	if err := storeEmbeddedManagedAssets(targetRepository, decodedAssets); err != nil {
		t.Fatalf("storeEmbeddedManagedAssets() deduplicate error = %v", err)
	}
}

// TestWorkspaceTransferAssetCollectionAndBuildErrors 验证引用去重 缺失 Repository 和损坏内容错误
func TestWorkspaceTransferAssetCollectionAndBuildErrors(t *testing.T) {
	t.Parallel()

	digest := sha256.Sum256(testPNGContent)
	asset := ManagedAssetDTO{
		ID:        hex.EncodeToString(digest[:]) + ".png",
		Name:      "diagram.png",
		MimeType:  "image/png",
		SizeBytes: int64(len(testPNGContent)),
	}
	document := createWorkspaceWithReferencedAsset(asset)
	duplicateCard := document.Threads[0].Cards[0]
	duplicateCard.ID = "duplicate-image"
	document.Threads[0].Cards = append(document.Threads[0].Cards, duplicateCard)
	assetIDs := collectReferencedManagedAssetIDs(document)
	if len(assetIDs) != 1 || assetIDs[0] != asset.ID {
		t.Fatalf("collectReferencedManagedAssetIDs() = %v", assetIDs)
	}
	if _, err := buildWorkspaceExportDocument(document, nil); err == nil || !strings.Contains(err.Error(), "repository") {
		t.Fatalf("buildWorkspaceExportDocument() nil repository error = %v", err)
	}

	repository := NewWorkspaceRepository(t.TempDir())
	if _, err := buildWorkspaceExportDocument(document, repository); err == nil || !strings.Contains(err.Error(), "read referenced") {
		t.Fatalf("buildWorkspaceExportDocument() missing asset error = %v", err)
	}
	if exportDocument, err := buildWorkspaceExportDocument(createTestWorkspaceDocument(), nil); err != nil || len(exportDocument.Assets) != 0 {
		t.Fatalf("buildWorkspaceExportDocument() without assets = (%#v, %v)", exportDocument, err)
	}
}

// TestDecodeWorkspaceExportDocumentRejectsInvalidAssets 验证重复 id Base64 大小 哈希和未知字段边界
func TestDecodeWorkspaceExportDocumentRejectsInvalidAssets(t *testing.T) {
	t.Parallel()

	digest := sha256.Sum256(testPNGContent)
	validAsset := EmbeddedManagedAssetDTO{
		ID:         hex.EncodeToString(digest[:]) + ".png",
		MimeType:   "image/png",
		SizeBytes:  int64(len(testPNGContent)),
		DataBase64: base64.StdEncoding.EncodeToString(testPNGContent),
	}

	testCases := []struct {
		name          string
		mutate        func(document *workspaceExportDocumentDTO)
		errorFragment string
	}{
		{name: "duplicate", mutate: func(document *workspaceExportDocumentDTO) {
			document.Assets = append(document.Assets, document.Assets[0])
		}, errorFragment: "duplicated"},
		{name: "mime", mutate: func(document *workspaceExportDocumentDTO) { document.Assets[0].MimeType = "" }, errorFragment: "mimeType"},
		{name: "id", mutate: func(document *workspaceExportDocumentDTO) { document.Assets[0].ID = "../bad" }, errorFragment: "id"},
		{name: "size range", mutate: func(document *workspaceExportDocumentDTO) { document.Assets[0].SizeBytes = 0 }, errorFragment: "sizeBytes"},
		{name: "size", mutate: func(document *workspaceExportDocumentDTO) { document.Assets[0].SizeBytes++ }, errorFragment: "does not match"},
		{name: "base64", mutate: func(document *workspaceExportDocumentDTO) { document.Assets[0].DataBase64 = "!" }, errorFragment: "dataBase64"},
		{name: "digest", mutate: func(document *workspaceExportDocumentDTO) { document.Assets[0].ID = strings.Repeat("a", 64) + ".png" }, errorFragment: "digest"},
		{name: "workspace", mutate: func(document *workspaceExportDocumentDTO) { document.Format = "bad" }, errorFragment: "validate imported workspace"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			document := workspaceExportDocumentDTO{
				WorkspaceDocumentDTO: createTestWorkspaceDocument(),
				Assets:               []EmbeddedManagedAssetDTO{validAsset},
			}
			testCase.mutate(&document)
			encoded, err := json.Marshal(document)
			if err != nil {
				t.Fatalf("marshal fixture: %v", err)
			}
			_, _, err = decodeWorkspaceExportDocument(string(encoded))
			if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
				t.Fatalf("decodeWorkspaceExportDocument() error = %v, want %q", err, testCase.errorFragment)
			}
		})
	}

	validDocument := workspaceExportDocumentDTO{WorkspaceDocumentDTO: createTestWorkspaceDocument()}
	encoded, err := json.Marshal(validDocument)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if _, _, err := decodeWorkspaceExportDocument(string(encoded) + ` {}`); err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("trailing import error = %v", err)
	}
	unknownFieldJSON := strings.TrimSuffix(string(encoded), "}") + `,"unknown":true}`
	if _, _, err := decodeWorkspaceExportDocument(unknownFieldJSON); err == nil || !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("unknown field error = %v", err)
	}
}

// TestStoreEmbeddedManagedAssetsBoundaries 验证空输入 nil Repository 和损坏现有内容策略
func TestStoreEmbeddedManagedAssetsBoundaries(t *testing.T) {
	t.Parallel()

	if err := storeEmbeddedManagedAssets(nil, nil); err != nil {
		t.Fatalf("storeEmbeddedManagedAssets(nil) error = %v", err)
	}
	digest := sha256.Sum256(testPNGContent)
	assetID := hex.EncodeToString(digest[:]) + ".png"
	embeddedAsset := EmbeddedManagedAssetDTO{
		ID:         assetID,
		MimeType:   "image/png",
		SizeBytes:  int64(len(testPNGContent)),
		DataBase64: base64.StdEncoding.EncodeToString(testPNGContent),
	}
	if err := storeEmbeddedManagedAssets(nil, []EmbeddedManagedAssetDTO{embeddedAsset}); err == nil || !strings.Contains(err.Error(), "repository") {
		t.Fatalf("storeEmbeddedManagedAssets() nil repository error = %v", err)
	}

	repository := NewWorkspaceRepository(t.TempDir())
	targetPath, err := repository.resolveManagedAssetPath(assetID)
	if err != nil {
		t.Fatalf("resolveManagedAssetPath() error = %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		t.Fatalf("create assets directory: %v", err)
	}
	if err := os.WriteFile(targetPath, []byte("corrupt"), 0o600); err != nil {
		t.Fatalf("write corrupt target: %v", err)
	}
	if err := repository.storeManagedAssetContent(assetID, testPNGContent); err == nil || !strings.Contains(err.Error(), "different content") {
		t.Fatalf("storeManagedAssetContent() corrupt target error = %v", err)
	}
	if err := repository.storeManagedAssetContent(strings.Repeat("b", 64)+".png", testPNGContent); err == nil || !strings.Contains(err.Error(), "digest") {
		t.Fatalf("storeManagedAssetContent() digest error = %v", err)
	}
}

func createWorkspaceWithReferencedAsset(asset ManagedAssetDTO) WorkspaceDocumentDTO {
	document := createTestWorkspaceDocument()
	document.Threads[0].Cards[0].CardType = "image"
	document.Threads[0].Cards[0].UserPrompt = ""
	document.Threads[0].Cards[0].AIResponse = ""
	document.Threads[0].Cards[0].Asset = &asset
	document.Threads[0].Cards[0].Caption = "diagram"
	return document
}
