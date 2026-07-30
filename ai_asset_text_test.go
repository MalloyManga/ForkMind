package main

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

// TestExtractManagedAssetPlainText 验证 UTF-8 Markdown 和 UTF-16 记事本文本能够稳定解码
func TestExtractManagedAssetPlainText(t *testing.T) {
	t.Parallel()

	markdownAsset := ManagedAssetDTO{Name: "guide.md"}
	markdownText, err := ExtractManagedAssetText(markdownAsset, []byte("# Guide\n正文"), "text/markdown")
	if err != nil || markdownText != "# Guide\n正文" {
		t.Fatalf("Markdown extraction = (%q, %v)", markdownText, err)
	}

	utf16Content := []byte{0xff, 0xfe, 'H', 0, 'i', 0}
	plainText, err := ExtractManagedAssetText(ManagedAssetDTO{Name: "note.txt"}, utf16Content, "text/plain")
	if err != nil || plainText != "Hi" {
		t.Fatalf("UTF-16 extraction = (%q, %v)", plainText, err)
	}
}

// TestExtractManagedAssetDOCX 验证 Word Open XML 段落和制表符会转成纯文本
func TestExtractManagedAssetDOCX(t *testing.T) {
	t.Parallel()

	var archiveBuffer bytes.Buffer
	archiveWriter := zip.NewWriter(&archiveBuffer)
	documentWriter, err := archiveWriter.Create("word/document.xml")
	if err != nil {
		t.Fatalf("create DOCX document: %v", err)
	}
	_, _ = documentWriter.Write([]byte(`<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t><w:tab/><w:t>Again</w:t></w:r></w:p></w:body></w:document>`))
	if err := archiveWriter.Close(); err != nil {
		t.Fatalf("close DOCX archive: %v", err)
	}

	extractedText, err := ExtractManagedAssetText(
		ManagedAssetDTO{Name: "document.docx"},
		archiveBuffer.Bytes(),
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	)
	if err != nil || extractedText != "Hello\nWorld\tAgain" {
		t.Fatalf("DOCX extraction = (%q, %v)", extractedText, err)
	}
}

// TestExtractManagedAssetPDF 验证常见 PDF Tj 和 TJ 文本操作符能够提取
func TestExtractManagedAssetPDF(t *testing.T) {
	t.Parallel()

	pdfContent := []byte("%PDF-1.4\n1 0 obj\n<< /Length 64 >>\nstream\nBT (Hello\\ World) Tj [(from) 20 (PDF)] TJ ET\nendstream\nendobj\n%%EOF")
	extractedText, err := ExtractManagedAssetText(ManagedAssetDTO{Name: "sample.pdf"}, pdfContent, "application/pdf")
	if err != nil || extractedText != "Hello World from PDF" {
		t.Fatalf("PDF extraction = (%q, %v)", extractedText, err)
	}
}

// TestExtractManagedAssetRejectsUnsupportedAndEmpty 验证未知二进制和无文本 PDF 不会静默进入 AI 上下文
func TestExtractManagedAssetRejectsUnsupportedAndEmpty(t *testing.T) {
	t.Parallel()

	if _, err := ExtractManagedAssetText(ManagedAssetDTO{Name: "archive.zip"}, []byte("binary"), "application/zip"); err == nil {
		t.Fatal("unsupported ZIP extraction error = nil")
	}
	if _, err := ExtractManagedAssetText(ManagedAssetDTO{Name: "scan.pdf"}, []byte("%PDF-1.4 no text stream"), "application/pdf"); err == nil {
		t.Fatal("empty PDF extraction error = nil")
	}
}

// TestHydrateAIFileReferences 验证只读取主链和当前节点直接引用中的 File Card
func TestHydrateAIFileReferences(t *testing.T) {
	t.Parallel()

	thread := createContextTestThread()
	assetID := strings.Repeat("a", 64) + ".txt"
	thread.Cards = append(thread.Cards,
		ConversationCardDTO{
			ID:       "reference-file",
			CardType: "file",
			Position: CardPositionDTO{X: 1, Y: 1},
			Size:     CardSizeDTO{Mode: "auto", Width: 320, MinHeight: 160},
			Status:   "idle", CreatedAt: thread.CreatedAt, UpdatedAt: thread.UpdatedAt,
			Asset:       &ManagedAssetDTO{ID: assetID, Name: "notes.txt", MimeType: "text/plain", SizeBytes: 5},
			Description: "用户说明",
		},
		ConversationCardDTO{
			ID:       "unrelated-file",
			CardType: "file",
			Position: CardPositionDTO{X: 2, Y: 2},
			Size:     CardSizeDTO{Mode: "auto", Width: 320, MinHeight: 160},
			Status:   "idle", CreatedAt: thread.CreatedAt, UpdatedAt: thread.UpdatedAt,
			Asset: &ManagedAssetDTO{ID: strings.Repeat("b", 64) + ".txt", Name: "other.txt", MimeType: "text/plain", SizeBytes: 5},
		},
	)
	for cardIndex := range thread.Cards {
		if thread.Cards[cardIndex].ID == "child-chat" {
			thread.Cards[cardIndex].ReferenceNodeIDs = []string{"reference-file"}
		}
	}

	readCount := 0
	hydratedThread, err := HydrateAIFileReferences(thread, "child-chat", func(asset ManagedAssetDTO) (string, error) {
		readCount++
		return "文件正文", nil
	})
	if err != nil {
		t.Fatalf("HydrateAIFileReferences() error = %v", err)
	}
	if readCount != 1 {
		t.Fatalf("reader calls = %d, want 1", readCount)
	}
	if thread.Cards[len(thread.Cards)-2].Description != "用户说明" {
		t.Fatal("HydrateAIFileReferences() mutated source thread")
	}
	if description := hydratedThread.Cards[len(hydratedThread.Cards)-2].Description; !strings.Contains(description, "[本地文件正文]\n文件正文") {
		t.Fatalf("hydrated description = %q", description)
	}
	runtimeContext, err := BuildAIRuntimeContext(BuildAIContextInput{Thread: hydratedThread, ActiveNodeID: "child-chat"})
	if err != nil {
		t.Fatalf("BuildAIRuntimeContext() error = %v", err)
	}
	joinedMessages := ""
	for _, message := range runtimeContext.Messages {
		joinedMessages += message.Content
	}
	if !strings.Contains(joinedMessages, "[本地文件正文]\n文件正文") {
		t.Fatalf("runtime messages do not contain extracted file text: %q", joinedMessages)
	}
}
