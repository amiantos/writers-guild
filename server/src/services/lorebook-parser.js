/**
 * Lorebook Parser Service
 * Handles parsing of SillyTavern lorebooks (both standalone and character-embedded)
 */

export class LorebookParser {
  /**
   * Parse a standalone lorebook JSON file
   * @param {Buffer|string} data - The lorebook JSON data
   * @returns {Object} - Normalized lorebook structure
   */
  static parseStandaloneLorebook(data) {
    const json = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());

    // SillyTavern standalone lorebooks have entries as object with numeric keys
    // Format: { "entries": { "0": {...}, "1": {...} } }
    if (!json.entries) {
      throw new Error('Invalid lorebook format: missing entries');
    }

    const entriesArray = Object.values(json.entries);

    return {
      name: json.name || 'Untitled Lorebook',
      description: json.description || '',
      scanDepth: json.scan_depth || json.scanDepth || null, // Global setting
      tokenBudget: json.token_budget || json.tokenBudget || null,
      recursiveScanning: json.recursive_scanning !== undefined ? json.recursive_scanning : true,
      entries: entriesArray.map(entry => this.normalizeEntry(entry, 'standalone')),
      extensions: json.extensions || {},
    };
  }

  /**
   * Parse character card V2 embedded lorebook
   * @param {Object} characterBook - The character_book object from V2 card
   * @returns {Object} - Normalized lorebook structure
   */
  static parseEmbeddedLorebook(characterBook) {
    if (!characterBook || !characterBook.entries) {
      throw new Error('Invalid embedded lorebook: missing entries');
    }

    return {
      name: characterBook.name || 'Character Lorebook',
      description: characterBook.description || '',
      scanDepth: characterBook.scan_depth || characterBook.scanDepth || null,
      tokenBudget: characterBook.token_budget || characterBook.tokenBudget || null,
      recursiveScanning: characterBook.recursive_scanning !== undefined ? characterBook.recursive_scanning : true,
      entries: characterBook.entries.map(entry => this.normalizeEntry(entry, 'v2')),
      extensions: characterBook.extensions || {},
    };
  }

  /**
   * Normalize an entry from either format to internal structure
   * @param {Object} entry - The entry object
   * @param {string} sourceFormat - Either 'standalone' or 'v2'
   * @returns {Object} - Normalized entry
   */
  static normalizeEntry(entry, sourceFormat) {
    if (sourceFormat === 'standalone') {
      // Standalone format uses: uid, key, keysecondary, content, etc.
      return {
        id: entry.uid || entry.id || 0,
        keys: Array.isArray(entry.key) ? entry.key : [entry.key || ''],
        secondaryKeys: Array.isArray(entry.keysecondary) ? entry.keysecondary : (entry.keysecondary ? [entry.keysecondary] : []),
        content: entry.content || '',
        comment: entry.comment || '',
        enabled: !entry.disable,
        constant: entry.constant || false,
        selective: entry.selective || false,
        selectiveLogic: entry.selectiveLogic || 0, // 0=AND_ANY, 1=NOT_ANY, 2=NOT_ALL, 3=AND_ALL
        insertionOrder: entry.order !== undefined ? entry.order : 100,
        position: entry.position || 0,
        caseSensitive: entry.caseSensitive || false,
        matchWholeWords: entry.matchWholeWords || false,
        useRegex: entry.use_regex || entry.useRegex || false,
        probability: entry.probability !== undefined ? entry.probability : 100,
        useProbability: entry.useProbability || false,
        depth: entry.depth || 4,
        scanDepth: entry.scanDepth || null, // Per-entry override
        group: entry.group || '',
        preventRecursion: entry.preventRecursion || entry.excludeRecursion || false,
        delayUntilRecursion: entry.delayUntilRecursion || false,
        displayIndex: entry.displayIndex !== undefined ? entry.displayIndex : entry.id || 0,
        extensions: entry.extensions || {},
      };
    } else {
      // V2 format uses: keys, content, enabled, insertion_order, etc.
      return {
        id: entry.id || 0,
        keys: Array.isArray(entry.keys) ? entry.keys : [entry.keys || ''],
        secondaryKeys: Array.isArray(entry.secondary_keys) ? entry.secondary_keys : (entry.secondary_keys ? [entry.secondary_keys] : []),
        content: entry.content || '',
        comment: entry.comment || entry.name || '',
        enabled: entry.enabled !== undefined ? entry.enabled : true,
        constant: entry.constant || false,
        selective: entry.selective || false,
        selectiveLogic: entry.selective_logic !== undefined ? entry.selective_logic : 0,
        insertionOrder: entry.insertion_order !== undefined ? entry.insertion_order : (entry.priority || 100),
        position: this.normalizePosition(entry.position),
        caseSensitive: entry.case_sensitive || false,
        matchWholeWords: entry.match_whole_words || false,
        useRegex: entry.use_regex || false,
        probability: entry.probability !== undefined ? entry.probability : 100,
        useProbability: entry.use_probability || false,
        depth: entry.depth || 4,
        scanDepth: entry.scan_depth || null,
        group: entry.group || '',
        preventRecursion: entry.prevent_recursion || entry.excludeRecursion || false,
        delayUntilRecursion: entry.delay_until_recursion || false,
        displayIndex: entry.display_index !== undefined ? entry.display_index : entry.id || 0,
        extensions: entry.extensions || {},
      };
    }
  }

  /**
   * Normalize position strings to numeric values
   * @param {string|number} position - Position value
   * @returns {number} - Numeric position
   */
  static normalizePosition(position) {
    if (typeof position === 'number') return position;

    // For now, we only support one insertion position (after character profiles)
    // But we'll store the original position for future compatibility
    const positionMap = {
      'before_char': 0,
      'after_char': 1,
      'before_example': 2,
      'after_example': 3,
      'top_an': 4,
      'bottom_an': 5,
      'at_depth': 6,
      'outlet': 7,
    };

    return positionMap[position] || 1; // Default to after_char
  }

  /**
   * Convert internal format back to standalone lorebook format for saving
   * @param {Object} lorebook - Normalized lorebook
   * @returns {Object} - Standalone format
   */
  static toStandaloneFormat(lorebook) {
    const entries = {};

    lorebook.entries.forEach((entry, index) => {
      entries[index.toString()] = {
        uid: entry.id,
        key: entry.keys,
        keysecondary: entry.secondaryKeys,
        comment: entry.comment,
        content: entry.content,
        constant: entry.constant,
        selective: entry.selective,
        selectiveLogic: entry.selectiveLogic,
        order: entry.insertionOrder,
        position: entry.position,
        disable: !entry.enabled,
        caseSensitive: entry.caseSensitive,
        matchWholeWords: entry.matchWholeWords,
        use_regex: entry.useRegex,
        probability: entry.probability,
        useProbability: entry.useProbability,
        depth: entry.depth,
        scanDepth: entry.scanDepth,
        group: entry.group,
        excludeRecursion: entry.preventRecursion,
        delayUntilRecursion: entry.delayUntilRecursion,
        displayIndex: entry.displayIndex,
        extensions: entry.extensions,
      };
    });

    return {
      name: lorebook.name,
      description: lorebook.description,
      scan_depth: lorebook.scanDepth,
      token_budget: lorebook.tokenBudget,
      recursive_scanning: lorebook.recursiveScanning,
      entries,
      extensions: lorebook.extensions,
    };
  }

  /**
   * Get selective logic as human-readable string
   * @param {number} logic - Logic value (0-3)
   * @returns {string} - Logic name
   */
  static getSelectiveLogicName(logic) {
    const names = ['AND_ANY', 'NOT_ANY', 'NOT_ALL', 'AND_ALL'];
    return names[logic] || 'AND_ANY';
  }
}
