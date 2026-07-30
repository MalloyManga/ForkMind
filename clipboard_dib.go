package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/png"
	"math/bits"
)

const (
	dibBitmapInfoHeaderSize = 40
	dibCompressionRGB       = 0
	dibCompressionBitfields = 3
	dibCompressionAlphaBits = 6
	maxClipboardImageWidth  = 16_384
	maxClipboardImageHeight = 16_384
	maxClipboardImagePixels = 64 * 1024 * 1024
)

// dibChannelMasks 描述 BITFIELDS DIB 中每个颜色通道占用的位
// Alpha 为 0 表示来源没有可靠透明通道 解码结果统一使用完全不透明
type dibChannelMasks struct {
	Red   uint32
	Green uint32
	Blue  uint32
	Alpha uint32
}

// decodeDIBToPNG 把 Win32 CF_DIB 或 CF_DIBV5 内存块转换为标准 PNG
// dib 来自锁定后的 HGLOBAL 副本 返回内容可直接写入 Managed Asset Repository
// Windows 剪贴板包含截图且没有可直接读取的图片文件时触发
func decodeDIBToPNG(dib []byte) ([]byte, error) {
	if len(dib) < dibBitmapInfoHeaderSize {
		return nil, fmt.Errorf("DIB is shorter than BITMAPINFOHEADER")
	}

	headerSize := int(binary.LittleEndian.Uint32(dib[0:4]))
	if headerSize < dibBitmapInfoHeaderSize || headerSize > len(dib) {
		return nil, fmt.Errorf("DIB header size %d is invalid", headerSize)
	}
	widthValue := int64(int32(binary.LittleEndian.Uint32(dib[4:8])))
	heightValue := int64(int32(binary.LittleEndian.Uint32(dib[8:12])))
	planes := binary.LittleEndian.Uint16(dib[12:14])
	bitCount := binary.LittleEndian.Uint16(dib[14:16])
	compression := binary.LittleEndian.Uint32(dib[16:20])
	if planes != 1 {
		return nil, fmt.Errorf("DIB planes must be 1")
	}
	if widthValue <= 0 || widthValue > maxClipboardImageWidth {
		return nil, fmt.Errorf("DIB width %d is outside supported range", widthValue)
	}
	if heightValue == 0 || heightValue < -maxClipboardImageHeight || heightValue > maxClipboardImageHeight {
		return nil, fmt.Errorf("DIB height %d is outside supported range", heightValue)
	}
	if bitCount != 24 && bitCount != 32 {
		return nil, fmt.Errorf("DIB bit depth %d is not supported", bitCount)
	}
	if compression != dibCompressionRGB &&
		compression != dibCompressionBitfields &&
		compression != dibCompressionAlphaBits {
		return nil, fmt.Errorf("DIB compression %d is not supported", compression)
	}
	if bitCount == 24 && compression != dibCompressionRGB {
		return nil, fmt.Errorf("24-bit DIB must use BI_RGB compression")
	}

	height := heightValue
	if height < 0 {
		height = -height
	}
	pixelCount := widthValue * height
	if pixelCount <= 0 || pixelCount > maxClipboardImagePixels {
		return nil, fmt.Errorf("DIB pixel count %d exceeds supported limit", pixelCount)
	}

	pixelOffset, masks, err := resolveDIBPixelLayout(dib, headerSize, bitCount, compression)
	if err != nil {
		return nil, err
	}
	rowStride := ((widthValue*int64(bitCount) + 31) / 32) * 4
	requiredBytes := int64(pixelOffset) + rowStride*height
	if requiredBytes > int64(len(dib)) {
		return nil, fmt.Errorf("DIB pixel data requires %d bytes but only %d are available", requiredBytes, len(dib))
	}

	decodedImage := image.NewNRGBA(image.Rect(0, 0, int(widthValue), int(height)))
	hasNonZeroAlpha := false
	for targetY := 0; targetY < int(height); targetY++ {
		sourceY := targetY
		if heightValue > 0 {
			sourceY = int(height) - 1 - targetY
		}
		rowStart := pixelOffset + sourceY*int(rowStride)
		for targetX := 0; targetX < int(widthValue); targetX++ {
			pixelIndex := decodedImage.PixOffset(targetX, targetY)
			if bitCount == 24 {
				sourceIndex := rowStart + targetX*3
				decodedImage.Pix[pixelIndex] = dib[sourceIndex+2]
				decodedImage.Pix[pixelIndex+1] = dib[sourceIndex+1]
				decodedImage.Pix[pixelIndex+2] = dib[sourceIndex]
				decodedImage.Pix[pixelIndex+3] = 0xff
				continue
			}

			sourceIndex := rowStart + targetX*4
			pixelValue := binary.LittleEndian.Uint32(dib[sourceIndex : sourceIndex+4])
			decodedImage.Pix[pixelIndex] = scaleDIBChannel(pixelValue, masks.Red, 0)
			decodedImage.Pix[pixelIndex+1] = scaleDIBChannel(pixelValue, masks.Green, 0)
			decodedImage.Pix[pixelIndex+2] = scaleDIBChannel(pixelValue, masks.Blue, 0)
			alpha := scaleDIBChannel(pixelValue, masks.Alpha, 0xff)
			decodedImage.Pix[pixelIndex+3] = alpha
			if masks.Alpha != 0 && alpha != 0 {
				hasNonZeroAlpha = true
			}
		}
	}

	// BI_RGB 32-bit 来源经常把保留字节全部写为 0
	// 只有整张图都没有非零 alpha 时才按 Windows 传统 DIB 语义恢复为不透明
	if masks.Alpha != 0 && !hasNonZeroAlpha {
		for alphaIndex := 3; alphaIndex < len(decodedImage.Pix); alphaIndex += 4 {
			decodedImage.Pix[alphaIndex] = 0xff
		}
	}

	var encodedPNG bytes.Buffer
	if err := png.Encode(&encodedPNG, decodedImage); err != nil {
		return nil, fmt.Errorf("encode clipboard DIB as PNG: %w", err)
	}
	if encodedPNG.Len() > managedAssetMaxBytes {
		return nil, fmt.Errorf("encoded clipboard image exceeds %d bytes", managedAssetMaxBytes)
	}
	return encodedPNG.Bytes(), nil
}

// resolveDIBPixelLayout 计算 DIB 像素起点并读取可选颜色掩码
// headerSize bitCount compression 来自已完成边界检查的 BITMAPINFOHEADER
// 返回 pixelOffset 和通道掩码供逐像素解码使用
func resolveDIBPixelLayout(
	dib []byte,
	headerSize int,
	bitCount uint16,
	compression uint32,
) (int, dibChannelMasks, error) {
	if bitCount == 24 {
		return headerSize, dibChannelMasks{
			Red:   0x00ff0000,
			Green: 0x0000ff00,
			Blue:  0x000000ff,
		}, nil
	}
	if compression == dibCompressionRGB {
		return headerSize, dibChannelMasks{
			Red:   0x00ff0000,
			Green: 0x0000ff00,
			Blue:  0x000000ff,
			Alpha: 0xff000000,
		}, nil
	}

	maskOffset := 40
	pixelOffset := headerSize
	if headerSize == dibBitmapInfoHeaderSize {
		maskBytes := 12
		if compression == dibCompressionAlphaBits {
			maskBytes = 16
		}
		if len(dib) < headerSize+maskBytes {
			return 0, dibChannelMasks{}, fmt.Errorf("DIB channel masks are truncated")
		}
		pixelOffset += maskBytes
	} else if headerSize < 52 {
		return 0, dibChannelMasks{}, fmt.Errorf("DIB extended header does not contain RGB masks")
	}

	masks := dibChannelMasks{
		Red:   binary.LittleEndian.Uint32(dib[maskOffset : maskOffset+4]),
		Green: binary.LittleEndian.Uint32(dib[maskOffset+4 : maskOffset+8]),
		Blue:  binary.LittleEndian.Uint32(dib[maskOffset+8 : maskOffset+12]),
	}
	if headerSize >= 56 || compression == dibCompressionAlphaBits {
		masks.Alpha = binary.LittleEndian.Uint32(dib[maskOffset+12 : maskOffset+16])
	}
	if masks.Red == 0 || masks.Green == 0 || masks.Blue == 0 {
		return 0, dibChannelMasks{}, fmt.Errorf("DIB RGB channel masks cannot be empty")
	}
	return pixelOffset, masks, nil
}

// scaleDIBChannel 把任意连续 BITFIELDS 掩码缩放为 0 到 255
// pixelValue 是一个 32-bit 像素 mask 为 0 时返回 missingValue
func scaleDIBChannel(pixelValue uint32, mask uint32, missingValue uint8) uint8 {
	if mask == 0 {
		return missingValue
	}
	shift := bits.TrailingZeros32(mask)
	channelMaximum := mask >> shift
	channelValue := (pixelValue & mask) >> shift
	return uint8((uint64(channelValue)*255 + uint64(channelMaximum)/2) / uint64(channelMaximum))
}
