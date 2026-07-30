package main

import (
	"bytes"
	"encoding/binary"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

// TestDecodeDIBToPNGDecodesBottomUp24Bit 验证 24-bit DIB 行填充和 bottom-up 坐标转换
func TestDecodeDIBToPNGDecodesBottomUp24Bit(t *testing.T) {
	t.Parallel()

	dib := createTestDIBHeader(2, 2, 24, dibCompressionRGB, dibBitmapInfoHeaderSize+16)
	// DIB 正高度从底行开始 每行 6 字节像素加 2 字节 padding
	copy(dib[40:48], []byte{
		0xff, 0x00, 0x00, // bottom-left blue
		0xff, 0xff, 0xff, // bottom-right white
		0x00, 0x00,
	})
	copy(dib[48:56], []byte{
		0x00, 0x00, 0xff, // top-left red
		0x00, 0xff, 0x00, // top-right green
		0x00, 0x00,
	})

	encodedPNG, err := decodeDIBToPNG(dib)
	if err != nil {
		t.Fatalf("decodeDIBToPNG() error = %v", err)
	}
	decodedImage, err := png.Decode(bytes.NewReader(encodedPNG))
	if err != nil {
		t.Fatalf("decode result PNG: %v", err)
	}
	assertTestPixel(t, decodedImage.At(0, 0), color.NRGBA{R: 0xff, A: 0xff})
	assertTestPixel(t, decodedImage.At(1, 0), color.NRGBA{G: 0xff, A: 0xff})
	assertTestPixel(t, decodedImage.At(0, 1), color.NRGBA{B: 0xff, A: 0xff})
	assertTestPixel(t, decodedImage.At(1, 1), color.NRGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff})
}

// TestDecodeDIBToPNGRestoresZeroAlpha 验证常见 32-bit BI_RGB 保留字节全零时恢复不透明
func TestDecodeDIBToPNGRestoresZeroAlpha(t *testing.T) {
	t.Parallel()

	dib := createTestDIBHeader(2, -1, 32, dibCompressionRGB, dibBitmapInfoHeaderSize+8)
	copy(dib[40:], []byte{
		0x00, 0x00, 0xff, 0x00,
		0x00, 0xff, 0x00, 0x00,
	})

	encodedPNG, err := decodeDIBToPNG(dib)
	if err != nil {
		t.Fatalf("decodeDIBToPNG() error = %v", err)
	}
	decodedImage, err := png.Decode(bytes.NewReader(encodedPNG))
	if err != nil {
		t.Fatalf("decode result PNG: %v", err)
	}
	assertTestPixel(t, decodedImage.At(0, 0), color.NRGBA{R: 0xff, A: 0xff})
	assertTestPixel(t, decodedImage.At(1, 0), color.NRGBA{G: 0xff, A: 0xff})
}

// TestDecodeDIBToPNGUsesExtendedBitfieldMasks 验证 DIBV4 自定义 RGB 和 alpha 掩码
func TestDecodeDIBToPNGUsesExtendedBitfieldMasks(t *testing.T) {
	t.Parallel()

	const headerSize = 108
	dib := createTestDIBHeader(1, -1, 32, dibCompressionBitfields, headerSize+4)
	binary.LittleEndian.PutUint32(dib[0:4], headerSize)
	binary.LittleEndian.PutUint32(dib[40:44], 0x000000ff)
	binary.LittleEndian.PutUint32(dib[44:48], 0x0000ff00)
	binary.LittleEndian.PutUint32(dib[48:52], 0x00ff0000)
	binary.LittleEndian.PutUint32(dib[52:56], 0xff000000)
	binary.LittleEndian.PutUint32(dib[headerSize:], 0x80402010)

	encodedPNG, err := decodeDIBToPNG(dib)
	if err != nil {
		t.Fatalf("decodeDIBToPNG() error = %v", err)
	}
	decodedImage, err := png.Decode(bytes.NewReader(encodedPNG))
	if err != nil {
		t.Fatalf("decode result PNG: %v", err)
	}
	assertTestPixel(t, decodedImage.At(0, 0), color.NRGBA{R: 0x10, G: 0x20, B: 0x40, A: 0x80})
}

// TestDecodeDIBToPNGRejectsMalformedInputs 验证短头 超限尺寸 位深和像素截断不会进入 PNG 编码
func TestDecodeDIBToPNGRejectsMalformedInputs(t *testing.T) {
	t.Parallel()

	unsupportedDepth := createTestDIBHeader(1, 1, 16, dibCompressionRGB, 44)
	tooWide := createTestDIBHeader(maxClipboardImageWidth+1, 1, 24, dibCompressionRGB, 44)
	truncatedPixels := createTestDIBHeader(2, 2, 24, dibCompressionRGB, 41)
	for _, testCase := range []struct {
		name          string
		dib           []byte
		errorFragment string
	}{
		{name: "short header", dib: []byte{1, 2, 3}, errorFragment: "shorter"},
		{name: "unsupported depth", dib: unsupportedDepth, errorFragment: "bit depth"},
		{name: "too wide", dib: tooWide, errorFragment: "width"},
		{name: "truncated pixels", dib: truncatedPixels, errorFragment: "requires"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := decodeDIBToPNG(testCase.dib)
			if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
				t.Fatalf("decodeDIBToPNG() error = %v want fragment %q", err, testCase.errorFragment)
			}
		})
	}
}

// createTestDIBHeader 创建测试需要的 BITMAPINFOHEADER 和指定总长度缓冲区
func createTestDIBHeader(width int, height int, bitCount uint16, compression uint32, totalBytes int) []byte {
	dib := make([]byte, totalBytes)
	binary.LittleEndian.PutUint32(dib[0:4], dibBitmapInfoHeaderSize)
	binary.LittleEndian.PutUint32(dib[4:8], uint32(int32(width)))
	binary.LittleEndian.PutUint32(dib[8:12], uint32(int32(height)))
	binary.LittleEndian.PutUint16(dib[12:14], 1)
	binary.LittleEndian.PutUint16(dib[14:16], bitCount)
	binary.LittleEndian.PutUint32(dib[16:20], compression)
	return dib
}

// assertTestPixel 比较 PNG 解码后单个像素的非预乘 RGBA 值
func assertTestPixel(t *testing.T, actualColor color.Color, expectedColor color.NRGBA) {
	t.Helper()
	actualNRGBA := color.NRGBAModel.Convert(actualColor).(color.NRGBA)
	if actualNRGBA != expectedColor {
		t.Fatalf("pixel = %#v want %#v", actualNRGBA, expectedColor)
	}
}
