package main

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const maxAIExtractedAssetTextBytes = 128 * 1024

var (
	pdfStreamPattern       = regexp.MustCompile(`(?s)(<<.*?>>)\s*stream\r?\n(.*?)\r?\nendstream`)
	pdfTextOperatorPattern = regexp.MustCompile(`(?s)(\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>|\[(.*?)\])\s*(?:Tj|TJ|')`)
	pdfArrayStringPattern  = regexp.MustCompile(`\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>`)
)

// ExtractManagedAssetText 把受支持的 Managed File 资产转换为 AI 可读纯文本
// asset 来自 File Card 元数据 content 和 detectedMimeType 来自 WorkspaceRepository 安全读取结果
// 返回值经过空文本和长度校验 不支持的类型或无法提取正文时返回明确错误
// AI 上下文组装发现主链或直接 reference 中的 File Card 时触发
func ExtractManagedAssetText(asset ManagedAssetDTO, content []byte, detectedMimeType string) (string, error) {
	extension := strings.ToLower(filepath.Ext(asset.Name))
	var (
		extractedText string
		err           error
	)

	switch {
	case extension == ".md" || extension == ".markdown" || extension == ".txt" ||
		strings.HasPrefix(detectedMimeType, "text/plain") || detectedMimeType == "text/markdown":
		extractedText, err = decodePlainText(content)
	case extension == ".docx" || detectedMimeType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		extractedText, err = extractDOCXText(content)
	case extension == ".pdf" || detectedMimeType == "application/pdf":
		extractedText, err = extractPDFText(content)
	default:
		return "", fmt.Errorf("file type %q is not supported for AI text extraction", extension)
	}
	if err != nil {
		return "", err
	}
	normalizedText := strings.TrimSpace(extractedText)
	if normalizedText == "" {
		return "", fmt.Errorf("file %q contains no extractable text", asset.Name)
	}
	if len(normalizedText) > maxAIExtractedAssetTextBytes {
		normalizedText = normalizedText[:maxAIExtractedAssetTextBytes] + "\n[正文已截断]"
	}
	return normalizedText, nil
}

// decodePlainText 解码 UTF-8 BOM 与常见 UTF-16 记事本文本
// content 来自受大小限制的 Managed Asset 字节
// 返回有效 UTF-8 字符串 非法编码返回错误而不是替换成乱码
func decodePlainText(content []byte) (string, error) {
	if bytes.HasPrefix(content, []byte{0xef, 0xbb, 0xbf}) {
		content = content[3:]
	}
	if bytes.HasPrefix(content, []byte{0xff, 0xfe}) {
		return decodeUTF16(content[2:], true)
	}
	if bytes.HasPrefix(content, []byte{0xfe, 0xff}) {
		return decodeUTF16(content[2:], false)
	}
	if !utf8.Valid(content) {
		return "", fmt.Errorf("plain text is not valid UTF-8 or BOM-marked UTF-16")
	}
	return string(content), nil
}

func decodeUTF16(content []byte, littleEndian bool) (string, error) {
	if len(content)%2 != 0 {
		return "", fmt.Errorf("UTF-16 text contains an incomplete code unit")
	}
	codeUnits := make([]uint16, 0, len(content)/2)
	for offset := 0; offset < len(content); offset += 2 {
		if littleEndian {
			codeUnits = append(codeUnits, uint16(content[offset])|uint16(content[offset+1])<<8)
		} else {
			codeUnits = append(codeUnits, uint16(content[offset])<<8|uint16(content[offset+1]))
		}
	}
	return string(utf16.Decode(codeUnits)), nil
}

// extractDOCXText 从 Word Open XML 包的 word/document.xml 提取段落文本
// content 来自 .docx Managed Asset 返回纯文本段落 表格单元格会按原 XML 顺序输出
func extractDOCXText(content []byte) (string, error) {
	archive, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return "", fmt.Errorf("open DOCX archive: %w", err)
	}
	for _, archiveFile := range archive.File {
		if archiveFile.Name != "word/document.xml" {
			continue
		}
		documentFile, err := archiveFile.Open()
		if err != nil {
			return "", fmt.Errorf("open DOCX document XML: %w", err)
		}
		documentText, parseErr := parseDOCXDocumentXML(io.LimitReader(documentFile, maxAIExtractedAssetTextBytes*8))
		closeErr := documentFile.Close()
		if parseErr != nil {
			if closeErr != nil {
				return "", fmt.Errorf("parse DOCX document: %v; close document XML: %w", parseErr, closeErr)
			}
			return "", parseErr
		}
		if closeErr != nil {
			return "", fmt.Errorf("close DOCX document XML: %w", closeErr)
		}
		return documentText, nil
	}
	return "", fmt.Errorf("DOCX archive does not contain word/document.xml")
}

func parseDOCXDocumentXML(reader io.Reader) (string, error) {
	decoder := xml.NewDecoder(reader)
	var textBuilder strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("decode DOCX XML: %w", err)
		}
		switch typedToken := token.(type) {
		case xml.StartElement:
			switch typedToken.Name.Local {
			case "tab":
				textBuilder.WriteByte('\t')
			case "br", "cr":
				textBuilder.WriteByte('\n')
			}
		case xml.CharData:
			textBuilder.Write(typedToken)
		case xml.EndElement:
			if typedToken.Name.Local == "p" {
				textBuilder.WriteByte('\n')
			}
		}
	}
	return textBuilder.String(), nil
}

// extractPDFText 从常见 PDF content stream 中提取 Tj 和 TJ 文本操作符
// 支持未压缩和 FlateDecode stream 不支持扫描图片和复杂字体 ToUnicode 映射
func extractPDFText(content []byte) (string, error) {
	streamMatches := pdfStreamPattern.FindAllSubmatch(content, -1)
	var textSections []string
	for _, streamMatch := range streamMatches {
		streamContent := streamMatch[2]
		if bytes.Contains(streamMatch[1], []byte("/FlateDecode")) {
			flateReader, openErr := zlib.NewReader(bytes.NewReader(streamContent))
			if openErr != nil {
				continue
			}
			decodedContent, err := io.ReadAll(io.LimitReader(flateReader, maxAIExtractedAssetTextBytes*8))
			closeErr := flateReader.Close()
			if err != nil {
				continue
			}
			if closeErr != nil {
				return "", fmt.Errorf("close PDF Flate stream: %w", closeErr)
			}
			streamContent = decodedContent
		}
		if extracted := extractPDFTextOperators(streamContent); extracted != "" {
			textSections = append(textSections, extracted)
		}
	}
	if len(textSections) == 0 {
		return "", fmt.Errorf("PDF contains no supported text stream and may be scanned or use a complex font mapping")
	}
	return strings.Join(textSections, "\n"), nil
}

func extractPDFTextOperators(content []byte) string {
	operatorMatches := pdfTextOperatorPattern.FindAllSubmatch(content, -1)
	textParts := make([]string, 0, len(operatorMatches))
	for _, operatorMatch := range operatorMatches {
		operand := operatorMatch[1]
		if len(operand) > 0 && operand[0] == '[' {
			for _, arrayMatch := range pdfArrayStringPattern.FindAllSubmatch(operand, -1) {
				if decoded := decodePDFString(arrayMatch[0]); decoded != "" {
					textParts = append(textParts, decoded)
				}
			}
			continue
		}
		if decoded := decodePDFString(operand); decoded != "" {
			textParts = append(textParts, decoded)
		}
	}
	return strings.Join(textParts, " ")
}

func decodePDFString(encoded []byte) string {
	if len(encoded) < 2 {
		return ""
	}
	if encoded[0] == '<' {
		hexText := strings.Map(func(character rune) rune {
			if character == ' ' || character == '\n' || character == '\r' || character == '\t' || character == '<' || character == '>' {
				return -1
			}
			return character
		}, string(encoded))
		decoded, err := hex.DecodeString(hexText)
		if err != nil || !utf8.Valid(decoded) {
			return ""
		}
		return string(decoded)
	}

	literal := encoded[1 : len(encoded)-1]
	var decoded strings.Builder
	for offset := 0; offset < len(literal); offset++ {
		if literal[offset] != '\\' || offset+1 >= len(literal) {
			decoded.WriteByte(literal[offset])
			continue
		}
		offset++
		switch literal[offset] {
		case 'n':
			decoded.WriteByte('\n')
		case 'r':
			decoded.WriteByte('\r')
		case 't':
			decoded.WriteByte('\t')
		case '(', ')', '\\':
			decoded.WriteByte(literal[offset])
		default:
			decoded.WriteByte(literal[offset])
		}
	}
	if !utf8.ValidString(decoded.String()) {
		return ""
	}
	return decoded.String()
}
