/**
 * CHUB Character Importer Service
 *
 * Fetches character data from CHUB API and downloads character images.
 */

import { CharacterParser } from './character-parser.js';

export class ChubImporter {
  /**
   * Extract character path from CHUB URL
   * @param {string} url - CHUB character URL
   * @returns {string|null} Character path or null if invalid
   */
  static extractCharacterPath(url) {
    // Handle both character page URLs and API URLs
    const patterns = [
      /chub\.ai\/characters\/(.+)/,
      /api\.chub\.ai\/api\/characters\/(.+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Fetch character data from CHUB API
   * @param {string} url - CHUB character URL
   * @returns {Promise<Object>} Character data
   */
  static async fetchCharacter(url) {
    const characterPath = this.extractCharacterPath(url);

    if (!characterPath) {
      throw new Error('Invalid CHUB URL. Expected format: https://chub.ai/characters/...');
    }

    const apiUrl = `https://api.chub.ai/api/characters/${characterPath}`;

    try {
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://chub.ai/',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Character not found on CHUB');
        }
        throw new Error(`CHUB API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error.message.includes('CHUB')) {
        throw error;
      }
      throw new Error(`Failed to fetch from CHUB: ${error.message}`);
    }
  }

  /**
   * Download character image
   * @param {string} imageUrl - Image URL
   * @returns {Promise<Buffer>} Image data as buffer
   */
  static async downloadImage(imageUrl) {
    try {
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://chub.ai/',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return buffer;
    } catch (error) {
      throw new Error(`Image download failed: ${error.message}`);
    }
  }

  /**
   * Import character from CHUB URL
   * @param {string} url - CHUB character URL
   * @returns {Promise<Object>} Object with character data and image buffer
   */
  static async importFromUrl(url) {
    // Fetch character metadata from API
    const chubData = await this.fetchCharacter(url);

    // Get the character card PNG URL (has embedded character data including lorebooks)
    // Note: full_path contains the complete character card export with embedded lorebooks
    // max_res_url and avatar_url are just display images without embedded data
    const imageUrl = chubData.node?.full_path ||
                     chubData.node?.fullPath ||
                     chubData.node?.max_res_url ||
                     chubData.node?.avatar_url;

    if (!imageUrl) {
      throw new Error('No character image available');
    }

    // Log which URL we're using for debugging
    const urlType = chubData.node?.full_path ? 'full_path' :
                    chubData.node?.fullPath ? 'fullPath' :
                    chubData.node?.max_res_url ? 'max_res_url' : 'avatar_url';
    console.log(`[CHUB Import] Using ${urlType} for character card download`);

    // Download the PNG file which contains embedded character data
    const imageBuffer = await this.downloadImage(imageUrl);

    // Parse character data from the PNG using CharacterParser
    const characterData = await CharacterParser.parseCard(imageBuffer);

    if (!characterData) {
      throw new Error('Failed to parse character data from PNG');
    }

    // Log lorebook status for debugging
    const hasLorebook = characterData.data?.character_book &&
                       characterData.data.character_book.entries &&
                       characterData.data.character_book.entries.length > 0;
    if (hasLorebook) {
      console.log(`[CHUB Import] Found embedded lorebook with ${characterData.data.character_book.entries.length} entries`);
    } else {
      console.log('[CHUB Import] No embedded lorebook found in character card');
    }

    return {
      characterData,
      imageBuffer,
      imageMimetype: 'image/png',
    };
  }
}
