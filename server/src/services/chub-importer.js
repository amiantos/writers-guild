/**
 * CHUB Character Importer Service
 *
 * Fetches character data from CHUB API and downloads character images.
 */

import { safeFetch, readBodyWithLimit } from './safe-fetch.js';

// The fallback image URL comes from CHUB's API response, so image downloads
// go through safeFetch and are bounded like any other untrusted fetch.
const IMAGE_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

export class ChubImporter {
  /**
   * Extract character path from CHUB URL
   * @param {string} url - CHUB character URL
   * @returns {string|null} Character path or null if invalid
   */
  static extractCharacterPath(url) {
    // Handle both character page URLs and API URLs
    const patterns = [/chub\.ai\/characters\/(.+)/, /api\.chub\.ai\/api\/characters\/(.+)/];

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
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
          Referer: 'https://chub.ai/',
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
      throw new Error(`Failed to fetch from CHUB: ${error.message}`, { cause: error });
    }
  }

  /**
   * Fetch full character JSON from CHUB GitLab repository
   * @param {number} projectId - Project ID from CHUB API
   * @returns {Promise<Object>} Full character card data with lorebook
   */
  static async fetchCharacterJson(projectId) {
    try {
      const url = `https://gateway.chub.ai/api/v4/projects/${projectId}/repository/files/card.json/raw?ref=main&response_type=blob`;

      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: '*/*',
          Origin: 'https://chub.ai',
          Referer: 'https://chub.ai/',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch character JSON: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      throw new Error(`Character JSON fetch failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Download character image
   * @param {string} imageUrl - Image URL
   * @returns {Promise<Buffer>} Image data as buffer
   */
  static async downloadImage(imageUrl) {
    try {
      const response = await safeFetch(imageUrl, {
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://chub.ai/',
        },
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
      }

      return await readBodyWithLimit(response, MAX_IMAGE_BYTES);
    } catch (error) {
      throw new Error(`Image download failed: ${error.message}`, { cause: error });
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

    const projectId = chubData.node?.id;
    const fullPath = chubData.node?.full_path || chubData.node?.fullPath;

    if (!projectId) {
      throw new Error('No project ID available in API response');
    }

    if (!fullPath) {
      throw new Error('No character path available');
    }

    // Fetch the full character JSON from GitLab repository (includes lorebook)
    const characterData = await this.fetchCharacterJson(projectId);

    // Log lorebook status
    const hasLorebook =
      characterData.data?.character_book &&
      characterData.data.character_book.entries &&
      characterData.data.character_book.entries.length > 0;
    if (hasLorebook) {
      console.log(
        `[CHUB Import] Imported character with ${characterData.data.character_book.entries.length} lorebook entries`,
      );
    }

    // Download the character image separately
    const charCardUrl = `https://avatars.charhub.io/avatars/${fullPath}/chara_card_v2.png`;

    let imageBuffer;
    try {
      imageBuffer = await this.downloadImage(charCardUrl);
    } catch (error) {
      // If that fails (404), fall back to max_res_url from API response
      const imageUrl = chubData.node?.max_res_url || chubData.node?.avatar_url;

      if (!imageUrl) {
        throw new Error('No character image available', { cause: error });
      }

      imageBuffer = await this.downloadImage(imageUrl);
    }

    return {
      characterData,
      imageBuffer,
      imageMimetype: 'image/png',
    };
  }
}
