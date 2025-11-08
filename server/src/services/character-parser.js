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
   * Encode character card to PNG buffer
   * Takes existing PNG buffer and character data, returns new PNG with embedded data
   */
  static async encodeCard(pngBuffer, characterData) {
    // For now, just return the original buffer
    // TODO: Implement proper PNG chunk encoding
    return pngBuffer;
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
