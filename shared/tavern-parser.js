/**
 * Tavern Character Card Parser
 * Parses PNG files to extract embedded character card JSON data
 */

class TavernCardParser {
  /**
   * Parse a PNG file to extract Tavern character card data
   * @param {File} file - The PNG file to parse
   * @returns {Promise<Object>} - The parsed character card data
   */
  static async parseCard(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const dataView = new DataView(arrayBuffer);

      // Verify PNG signature
      if (!this.isPNG(dataView)) {
        throw new Error("File is not a valid PNG");
      }

      // Extract tEXt chunks
      const chunks = this.extractChunks(dataView);
      const textChunks = chunks.filter((chunk) => chunk.type === "tEXt");

      // Look for character data in tEXt chunks
      for (const chunk of textChunks) {
        const { keyword, text } = this.decodeTextChunk(chunk.data);

        // V3 format (ccv3) or V2 format (chara)
        if (keyword === "ccv3" || keyword === "chara") {
          const jsonString = this.base64Decode(text);
          const cardData = JSON.parse(jsonString);

          // Normalize to ensure we have the expected structure
          if (
            cardData.spec === "chara_card_v2" ||
            cardData.spec === "chara_card_v3"
          ) {
            return cardData;
          } else if (cardData.data) {
            // Already has data property
            return cardData;
          } else {
            // Assume it's the data object itself
            return { data: cardData };
          }
        }
      }

      throw new Error(
        "No character card data found in PNG. Make sure this is a Tavern character card."
      );
    } catch (error) {
      throw new Error(`Failed to parse character card: ${error.message}`);
    }
  }

  /**
   * Check if the file is a valid PNG
   */
  static isPNG(dataView) {
    // PNG signature: 137 80 78 71 13 10 26 10
    return (
      dataView.getUint32(0) === 0x89504e47 &&
      dataView.getUint32(4) === 0x0d0a1a0a
    );
  }

  /**
   * Extract all chunks from PNG file
   */
  static extractChunks(dataView) {
    const chunks = [];
    let offset = 8; // Skip PNG signature

    while (offset < dataView.byteLength) {
      // Read chunk length (4 bytes)
      const length = dataView.getUint32(offset);
      offset += 4;

      // Read chunk type (4 bytes)
      const type = String.fromCharCode(
        dataView.getUint8(offset),
        dataView.getUint8(offset + 1),
        dataView.getUint8(offset + 2),
        dataView.getUint8(offset + 3)
      );
      offset += 4;

      // Read chunk data
      const data = new Uint8Array(dataView.buffer, offset, length);
      offset += length;

      // Skip CRC (4 bytes)
      offset += 4;

      chunks.push({ type, data, length });

      // Stop at IEND chunk
      if (type === "IEND") break;
    }

    return chunks;
  }

  /**
   * Decode a tEXt chunk into keyword and text
   */
  static decodeTextChunk(data) {
    // tEXt format: keyword\0text
    // Find null separator
    let nullIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0) {
        nullIndex = i;
        break;
      }
    }

    if (nullIndex === -1) {
      throw new Error("Invalid tEXt chunk format");
    }

    // Decode keyword (Latin-1)
    const keyword = this.latin1Decode(data.slice(0, nullIndex));

    // Decode text (Latin-1, but it's base64 so ASCII compatible)
    const text = this.latin1Decode(data.slice(nullIndex + 1));

    return { keyword, text };
  }

  /**
   * Decode Latin-1 encoded bytes to string
   */
  static latin1Decode(data) {
    let str = "";
    for (let i = 0; i < data.length; i++) {
      str += String.fromCharCode(data[i]);
    }
    return str;
  }

  /**
   * Decode base64 string to UTF-8 string
   */
  static base64Decode(base64) {
    // Use browser's atob for base64 decoding
    const binaryString = atob(base64);

    // Convert to UTF-8
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Decode UTF-8
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(bytes);
  }

  /**
   * Validate character card structure
   */
  static validateCard(cardData) {
    if (!cardData || !cardData.data) {
      throw new Error("Invalid character card structure");
    }

    const data = cardData.data;

    // Check required fields
    const requiredFields = ["name"];
    for (const field of requiredFields) {
      if (!data.hasOwnProperty(field)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return true;
  }

  /**
   * Get a summary of the character card
   */
  static getSummary(cardData) {
    const data = cardData.data;

    return {
      name: data.name || "Unknown",
      description: data.description || "",
      personality: data.personality || "",
      scenario: data.scenario || "",
      firstMessage: data.first_mes || "",
      creator: data.creator || "Unknown",
      version: data.character_version || cardData.spec_version || "Unknown",
      hasAlternateGreetings:
        Array.isArray(data.alternate_greetings) &&
        data.alternate_greetings.length > 0,
      hasCharacterBook: !!data.character_book,
    };
  }
}

// Export for use in other modules
window.TavernCardParser = TavernCardParser;
