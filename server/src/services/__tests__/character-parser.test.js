import { describe, it, expect } from 'vitest';
import { CharacterParser } from '../character-parser.js';

describe('CharacterParser', () => {
  describe('createPNGWithCharacterData', () => {
    it('should create a valid PNG with embedded character data', async () => {
      const characterData = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Test Character',
          description: 'A test character',
          personality: 'Friendly'
        }
      };

      const pngBuffer = CharacterParser.createPNGWithCharacterData(characterData);

      // Verify it's a valid PNG
      expect(pngBuffer[0]).toBe(137); // PNG signature
      expect(pngBuffer[1]).toBe(80);  // P
      expect(pngBuffer[2]).toBe(78);  // N
      expect(pngBuffer[3]).toBe(71);  // G
    });

    it('should create PNG that can be parsed back', async () => {
      const originalData = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Roundtrip Test',
          description: 'Testing roundtrip',
          first_mes: 'Hello!'
        }
      };

      const pngBuffer = CharacterParser.createPNGWithCharacterData(originalData);
      const parsed = await CharacterParser.parseCard(pngBuffer);

      expect(parsed.data.name).toBe('Roundtrip Test');
      expect(parsed.data.description).toBe('Testing roundtrip');
      expect(parsed.data.first_mes).toBe('Hello!');
    });
  });

  describe('parseCard', () => {
    it('should throw error for non-PNG buffer', async () => {
      const notPNG = Buffer.from('Not a PNG file');

      await expect(CharacterParser.parseCard(notPNG))
        .rejects.toThrow('File is not a valid PNG');
    });

    it('should throw error when no character data found', async () => {
      // Create a minimal valid PNG without character data
      const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

      // IHDR chunk
      const ihdrData = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
      const ihdrType = Buffer.from('IHDR', 'latin1');
      const ihdrCRC = CharacterParser.calculateCRC(Buffer.concat([ihdrType, ihdrData]));
      const ihdrChunk = Buffer.concat([
        CharacterParser.uint32ToBuffer(ihdrData.length),
        ihdrType,
        ihdrData,
        CharacterParser.uint32ToBuffer(ihdrCRC)
      ]);

      // IEND chunk
      const iendType = Buffer.from('IEND', 'latin1');
      const iendCRC = CharacterParser.calculateCRC(iendType);
      const iendChunk = Buffer.concat([
        CharacterParser.uint32ToBuffer(0),
        iendType,
        CharacterParser.uint32ToBuffer(iendCRC)
      ]);

      const minimalPNG = Buffer.concat([pngSignature, ihdrChunk, iendChunk]);

      await expect(CharacterParser.parseCard(minimalPNG))
        .rejects.toThrow('No character data found');
    });
  });

  describe('isPNG', () => {
    it('should return true for valid PNG signature', () => {
      const pngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
      const dataView = new DataView(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength);
      expect(CharacterParser.isPNG(dataView)).toBe(true);
    });

    it('should return false for invalid signature', () => {
      const notPNG = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      const dataView = new DataView(notPNG.buffer, notPNG.byteOffset, notPNG.byteLength);
      expect(CharacterParser.isPNG(dataView)).toBe(false);
    });

    it('should return false for JPEG signature', () => {
      const jpegBuffer = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70]);
      const dataView = new DataView(jpegBuffer.buffer, jpegBuffer.byteOffset, jpegBuffer.byteLength);
      expect(CharacterParser.isPNG(dataView)).toBe(false);
    });
  });

  describe('base64Decode', () => {
    it('should decode base64 string correctly', () => {
      const original = 'Hello, World!';
      const encoded = Buffer.from(original, 'utf8').toString('base64');
      const decoded = CharacterParser.base64Decode(encoded);
      expect(decoded).toBe(original);
    });

    it('should handle unicode characters', () => {
      const original = 'Hello, 世界! Привет!';
      const encoded = Buffer.from(original, 'utf8').toString('base64');
      const decoded = CharacterParser.base64Decode(encoded);
      expect(decoded).toBe(original);
    });
  });

  describe('calculateCRC', () => {
    it('should calculate correct CRC', () => {
      const data = Buffer.from('IEND', 'latin1');
      const crc = CharacterParser.calculateCRC(data);
      expect(typeof crc).toBe('number');
      expect(crc).toBeGreaterThan(0);
    });

    it('should return different CRC for different data', () => {
      const crc1 = CharacterParser.calculateCRC(Buffer.from('hello'));
      const crc2 = CharacterParser.calculateCRC(Buffer.from('world'));
      expect(crc1).not.toBe(crc2);
    });

    it('should return same CRC for same data', () => {
      const data = Buffer.from('consistent data');
      const crc1 = CharacterParser.calculateCRC(data);
      const crc2 = CharacterParser.calculateCRC(data);
      expect(crc1).toBe(crc2);
    });
  });

  describe('uint32ToBuffer', () => {
    it('should convert 0 correctly', () => {
      const buffer = CharacterParser.uint32ToBuffer(0);
      expect(buffer.length).toBe(4);
      expect(buffer[0]).toBe(0);
      expect(buffer[1]).toBe(0);
      expect(buffer[2]).toBe(0);
      expect(buffer[3]).toBe(0);
    });

    it('should convert 256 correctly (big-endian)', () => {
      const buffer = CharacterParser.uint32ToBuffer(256);
      expect(buffer[0]).toBe(0);
      expect(buffer[1]).toBe(0);
      expect(buffer[2]).toBe(1);
      expect(buffer[3]).toBe(0);
    });

    it('should convert max uint32 correctly', () => {
      const buffer = CharacterParser.uint32ToBuffer(0xFFFFFFFF);
      expect(buffer[0]).toBe(255);
      expect(buffer[1]).toBe(255);
      expect(buffer[2]).toBe(255);
      expect(buffer[3]).toBe(255);
    });
  });

  describe('arrayBufferToString', () => {
    it('should convert Uint8Array to string', () => {
      const arr = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = CharacterParser.arrayBufferToString(arr);
      expect(result).toBe('Hello');
    });

    it('should handle empty array', () => {
      const arr = new Uint8Array([]);
      const result = CharacterParser.arrayBufferToString(arr);
      expect(result).toBe('');
    });
  });

  describe('decodeTextChunk', () => {
    it('should decode text chunk with keyword and text', () => {
      // "chara" + null byte + "test"
      const data = new Uint8Array([99, 104, 97, 114, 97, 0, 116, 101, 115, 116]);
      const result = CharacterParser.decodeTextChunk(data);
      expect(result.keyword).toBe('chara');
      expect(result.text).toBe('test');
    });

    it('should throw error for chunk without null separator', () => {
      const data = new Uint8Array([99, 104, 97, 114, 97, 116, 101, 115, 116]);
      expect(() => CharacterParser.decodeTextChunk(data))
        .toThrow('Invalid tEXt chunk');
    });
  });

  describe('extractChunks', () => {
    it('should extract chunks from PNG', () => {
      // Create a simple PNG-like structure
      const characterData = { data: { name: 'Test' } };
      const pngBuffer = CharacterParser.createPNGWithCharacterData(characterData);
      const dataView = new DataView(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength);

      const chunks = CharacterParser.extractChunks(dataView);

      // Should have at least IHDR, tEXt, IDAT, IEND
      expect(chunks.length).toBeGreaterThanOrEqual(4);

      const chunkTypes = chunks.map(c => c.type);
      expect(chunkTypes).toContain('IHDR');
      expect(chunkTypes).toContain('tEXt');
      expect(chunkTypes).toContain('IEND');
    });
  });
});
