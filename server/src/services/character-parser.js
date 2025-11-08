/**
 * Character Card Parser (Server-side)
 * Parses Tavern Character Card PNG files (V2/V3 format)
 */

export class CharacterParser {
  /**
   * Parse character card from PNG buffer
   */
  static async parseCard(buffer) {
    const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Verify PNG signature
    if (!this.isPNG(dataView)) {
      throw new Error('File is not a valid PNG');
    }

    // Extract chunks
    const chunks = this.extractChunks(dataView);
    const textChunks = chunks.filter(chunk => chunk.type === 'tEXt');

    // Look for character data in tEXt chunks
    for (const chunk of textChunks) {
      const { keyword, text } = this.decodeTextChunk(chunk.data);

      // V3 format
      if (keyword === 'ccv3') {
        const jsonString = this.base64Decode(text);
        return JSON.parse(jsonString);
      }

      // V2 format
      if (keyword === 'chara') {
        const jsonString = this.base64Decode(text);
        return JSON.parse(jsonString);
      }
    }

    throw new Error('No character data found in PNG');
  }

  /**
   * Create a minimal PNG with embedded character data
   * Creates a 1x1 transparent PNG with character data in tEXt chunk
   */
  static createPNGWithCharacterData(characterData) {
    // Base64 encode the character data JSON
    const jsonString = JSON.stringify(characterData);
    const base64Data = Buffer.from(jsonString, 'utf8').toString('base64');

    // Create tEXt chunk with 'chara' keyword
    const keyword = 'chara';
    const keywordBytes = Buffer.from(keyword, 'latin1');
    const textBytes = Buffer.from(base64Data, 'latin1');

    // tEXt chunk: keyword + null byte + text
    const textData = Buffer.concat([
      keywordBytes,
      Buffer.from([0]), // Null separator
      textBytes
    ]);

    // Calculate CRC for tEXt chunk
    const textType = Buffer.from('tEXt', 'latin1');
    const textCRC = this.calculateCRC(Buffer.concat([textType, textData]));

    // Build tEXt chunk: length + type + data + CRC
    const textChunk = Buffer.concat([
      this.uint32ToBuffer(textData.length),
      textType,
      textData,
      this.uint32ToBuffer(textCRC)
    ]);

    // Minimal 1x1 transparent PNG
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk (1x1, RGBA, 8-bit)
    const ihdrData = Buffer.from([
      0, 0, 0, 1, // Width: 1
      0, 0, 0, 1, // Height: 1
      8,          // Bit depth: 8
      6,          // Color type: RGBA
      0,          // Compression: deflate
      0,          // Filter: adaptive
      0           // Interlace: none
    ]);
    const ihdrType = Buffer.from('IHDR', 'latin1');
    const ihdrCRC = this.calculateCRC(Buffer.concat([ihdrType, ihdrData]));
    const ihdrChunk = Buffer.concat([
      this.uint32ToBuffer(ihdrData.length),
      ihdrType,
      ihdrData,
      this.uint32ToBuffer(ihdrCRC)
    ]);

    // IDAT chunk (1x1 transparent pixel)
    const idatData = Buffer.from([0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01]);
    const idatType = Buffer.from('IDAT', 'latin1');
    const idatCRC = this.calculateCRC(Buffer.concat([idatType, idatData]));
    const idatChunk = Buffer.concat([
      this.uint32ToBuffer(idatData.length),
      idatType,
      idatData,
      this.uint32ToBuffer(idatCRC)
    ]);

    // IEND chunk
    const iendType = Buffer.from('IEND', 'latin1');
    const iendCRC = this.calculateCRC(iendType);
    const iendChunk = Buffer.concat([
      this.uint32ToBuffer(0),
      iendType,
      this.uint32ToBuffer(iendCRC)
    ]);

    // Combine all chunks
    return Buffer.concat([
      pngSignature,
      ihdrChunk,
      textChunk,
      idatChunk,
      iendChunk
    ]);
  }

  /**
   * Convert uint32 to 4-byte buffer (big-endian)
   */
  static uint32ToBuffer(value) {
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeUInt32BE(value, 0);
    return buffer;
  }

  /**
   * Calculate CRC-32 checksum
   */
  static calculateCRC(buffer) {
    let crc = 0xFFFFFFFF;

    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
      }
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Check if file is PNG
   */
  static isPNG(dataView) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < signature.length; i++) {
      if (dataView.getUint8(i) !== signature[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Extract chunks from PNG
   */
  static extractChunks(dataView) {
    const chunks = [];
    let offset = 8; // Skip PNG signature

    while (offset < dataView.byteLength) {
      const length = dataView.getUint32(offset);
      offset += 4;

      const type = String.fromCharCode(
        dataView.getUint8(offset),
        dataView.getUint8(offset + 1),
        dataView.getUint8(offset + 2),
        dataView.getUint8(offset + 3)
      );
      offset += 4;

      const data = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, length);
      offset += length;

      const crc = dataView.getUint32(offset);
      offset += 4;

      chunks.push({ type, data, crc, length });

      if (type === 'IEND') {
        break;
      }
    }

    return chunks;
  }

  /**
   * Decode tEXt chunk
   */
  static decodeTextChunk(data) {
    let nullIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0) {
        nullIndex = i;
        break;
      }
    }

    if (nullIndex === -1) {
      throw new Error('Invalid tEXt chunk: no null separator found');
    }

    const keyword = this.arrayBufferToString(data.slice(0, nullIndex));
    const text = this.arrayBufferToString(data.slice(nullIndex + 1));

    return { keyword, text };
  }

  /**
   * Convert Uint8Array to string
   */
  static arrayBufferToString(buffer) {
    return Array.from(buffer)
      .map(byte => String.fromCharCode(byte))
      .join('');
  }

  /**
   * Base64 decode
   */
  static base64Decode(str) {
    return Buffer.from(str, 'base64').toString('utf8');
  }
}
