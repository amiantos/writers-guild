/**
 * Lorebook Activation Engine
 * Handles keyword scanning, conditional activation, and token budget management
 */

export class LorebookActivator {
  constructor(settings = {}) {
    this.settings = {
      scanDepth: settings.lorebookScanDepth || 2000, // Tokens to scan
      tokenBudget: settings.lorebookTokenBudget || 1800, // Max tokens for lorebook content
      recursionDepth: settings.lorebookRecursionDepth || 3, // Max recursive depth
      enableRecursion: settings.lorebookEnableRecursion !== false,
    };
  }

  /**
   * Activate lorebooks for given content
   * @param {Array} lorebooks - Array of lorebook objects with entries
   * @param {string} scanContent - Content to scan for keywords
   * @returns {Array} - Activated entries sorted by insertion order
   */
  activate(lorebooks, scanContent) {
    if (!lorebooks || lorebooks.length === 0) {
      return [];
    }

    // Combine all entries from all lorebooks
    const allEntries = [];
    for (const lorebook of lorebooks) {
      if (lorebook.entries && Array.isArray(lorebook.entries)) {
        allEntries.push(...lorebook.entries.map(e => ({
          ...e,
          lorebookName: lorebook.name
        })));
      }
    }

    if (allEntries.length === 0) {
      return [];
    }

    // Prepare scan content (limit to scan depth in tokens, ~4 chars per token)
    const maxChars = this.settings.scanDepth * 4;
    const contentToScan = scanContent.length > maxChars
      ? scanContent.slice(-maxChars) // Take last N characters
      : scanContent;

    // Activate entries
    const activated = this._activateEntries(allEntries, contentToScan, 0);

    // Sort by insertion order (higher = more influence, inserted later)
    activated.sort((a, b) => a.insertionOrder - b.insertionOrder);

    // Apply token budget
    const budgeted = this._applyTokenBudget(activated);

    return budgeted;
  }

  /**
   * Recursively activate entries
   * @param {Array} allEntries - All available entries
   * @param {string} scanContent - Content to scan
   * @param {number} depth - Current recursion depth
   * @param {Set} processedIds - Already processed entry IDs
   * @returns {Array} - Activated entries
   */
  _activateEntries(allEntries, scanContent, depth = 0, processedIds = new Set()) {
    if (depth > this.settings.recursionDepth) {
      return [];
    }

    const activated = [];
    const newlyActivated = [];

    for (const entry of allEntries) {
      // Skip if already processed
      if (processedIds.has(entry.id)) {
        continue;
      }

      // Skip if disabled
      if (!entry.enabled) {
        continue;
      }

      // Skip if should delay until recursion and we're at depth 0
      if (entry.delayUntilRecursion && depth === 0) {
        continue;
      }

      // Check if constant (always active)
      if (entry.constant) {
        // Apply probability check for constant entries too
        if (entry.useProbability && !this._checkProbability(entry.probability)) {
          continue;
        }

        activated.push(entry);
        processedIds.add(entry.id);
        newlyActivated.push(entry);
        continue;
      }

      // Check activation conditions
      if (this._checkActivation(entry, scanContent)) {
        // Apply probability check
        if (entry.useProbability && !this._checkProbability(entry.probability)) {
          continue;
        }

        activated.push(entry);
        processedIds.add(entry.id);
        newlyActivated.push(entry);
      }
    }

    // Recursive activation if enabled
    if (this.settings.enableRecursion && depth < this.settings.recursionDepth && newlyActivated.length > 0) {
      // Scan content of newly activated entries for more keywords
      const recursiveScanContent = newlyActivated
        .filter(e => !e.preventRecursion)
        .map(e => e.content)
        .join('\n\n');

      if (recursiveScanContent) {
        const recursiveActivated = this._activateEntries(
          allEntries,
          recursiveScanContent,
          depth + 1,
          processedIds
        );

        activated.push(...recursiveActivated);
      }
    }

    return activated;
  }

  /**
   * Check if entry should activate based on its keys and conditions
   * @param {Object} entry - Lorebook entry
   * @param {string} content - Content to scan
   * @returns {boolean} - Whether entry should activate
   */
  _checkActivation(entry, content) {
    if (!entry.keys || entry.keys.length === 0) {
      return false;
    }

    // Check primary keys
    const primaryMatch = this._checkKeys(entry.keys, content, entry);

    if (!primaryMatch) {
      return false;
    }

    // If selective, check secondary keys with logic
    if (entry.selective && entry.secondaryKeys && entry.secondaryKeys.length > 0) {
      const secondaryMatches = entry.secondaryKeys.map(key =>
        this._matchKey(key, content, entry)
      );

      const anyMatch = secondaryMatches.some(m => m);
      const allMatch = secondaryMatches.every(m => m);

      switch (entry.selectiveLogic) {
        case 0: // AND_ANY: primary + at least one secondary
          return anyMatch;
        case 1: // NOT_ANY: primary but NO secondary keys
          return !anyMatch;
        case 2: // NOT_ALL: primary but NOT all secondary keys
          return !allMatch;
        case 3: // AND_ALL: primary + all secondary keys
          return allMatch;
        default:
          return true;
      }
    }

    return true;
  }

  /**
   * Check if any key matches in content
   * @param {Array} keys - Array of key strings
   * @param {string} content - Content to search
   * @param {Object} entry - Entry with matching options
   * @returns {boolean} - Whether any key matches
   */
  _checkKeys(keys, content, entry) {
    return keys.some(key => this._matchKey(key, content, entry));
  }

  /**
   * Check if a single key matches in content
   * @param {string} key - Key string (or regex pattern)
   * @param {string} content - Content to search
   * @param {Object} entry - Entry with matching options
   * @returns {boolean} - Whether key matches
   */
  _matchKey(key, content, entry) {
    if (!key) return false;

    try {
      // Regex matching
      if (entry.useRegex) {
        // Extract regex pattern from /pattern/flags format or use as-is
        const regexMatch = key.match(/^\/(.+)\/([gimuy]*)$/);
        let pattern, flags;

        if (regexMatch) {
          pattern = regexMatch[1];
          flags = regexMatch[2];
        } else {
          pattern = key;
          flags = entry.caseSensitive ? '' : 'i';
        }

        const regex = new RegExp(pattern, flags);
        return regex.test(content);
      }

      // Prepare search strings
      let searchContent = content;
      let searchKey = key;

      // Case sensitivity
      if (!entry.caseSensitive) {
        searchContent = searchContent.toLowerCase();
        searchKey = searchKey.toLowerCase();
      }

      // Match whole words only
      if (entry.matchWholeWords) {
        // Use word boundary regex
        const pattern = `\\b${this._escapeRegex(searchKey)}\\b`;
        const regex = new RegExp(pattern, entry.caseSensitive ? '' : 'i');
        return regex.test(searchContent);
      }

      // Simple substring match
      return searchContent.includes(searchKey);
    } catch (error) {
      console.error(`Error matching key "${key}":`, error);
      return false;
    }
  }

  /**
   * Escape special regex characters
   * @param {string} str - String to escape
   * @returns {string} - Escaped string
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check probability (0-100%)
   * @param {number} probability - Probability percentage
   * @returns {boolean} - Whether probability check passes
   */
  _checkProbability(probability) {
    return Math.random() * 100 < probability;
  }

  /**
   * Apply token budget to activated entries
   * @param {Array} entries - Activated entries
   * @returns {Array} - Entries within budget
   */
  _applyTokenBudget(entries) {
    // Handle inclusion groups first
    const processed = this._processInclusionGroups(entries);

    // Estimate tokens (rough: ~4 chars per token)
    let totalTokens = 0;
    const budgeted = [];

    for (const entry of processed) {
      const entryTokens = Math.ceil(entry.content.length / 4);

      if (totalTokens + entryTokens <= this.settings.tokenBudget) {
        budgeted.push(entry);
        totalTokens += entryTokens;
      } else {
        // Budget exceeded - stop adding entries
        // Lower insertion order entries are discarded
        break;
      }
    }

    return budgeted;
  }

  /**
   * Process inclusion groups (randomly select one entry per group)
   * @param {Array} entries - All activated entries
   * @returns {Array} - Entries with groups resolved
   */
  _processInclusionGroups(entries) {
    const groups = new Map();
    const ungrouped = [];

    // Separate grouped and ungrouped entries
    for (const entry of entries) {
      if (entry.group && entry.group.trim()) {
        const groupKey = entry.group.trim();
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey).push(entry);
      } else {
        ungrouped.push(entry);
      }
    }

    // Select one entry from each group
    const selected = [];
    for (const [groupKey, groupEntries] of groups) {
      if (groupEntries.length === 1) {
        selected.push(groupEntries[0]);
      } else {
        // Weighted random selection (use insertion order as weight)
        // Higher insertion order = more likely to be selected
        const totalWeight = groupEntries.reduce((sum, e) => sum + (e.insertionOrder || 100), 0);
        let random = Math.random() * totalWeight;

        for (const entry of groupEntries) {
          random -= (entry.insertionOrder || 100);
          if (random <= 0) {
            selected.push(entry);
            break;
          }
        }
      }
    }

    // Combine ungrouped and selected grouped entries
    return [...ungrouped, ...selected];
  }

  /**
   * Format activated entries as text for insertion into prompt
   * @param {Array} entries - Activated entries
   * @returns {string} - Formatted text
   */
  formatForPrompt(entries) {
    if (!entries || entries.length === 0) {
      return '';
    }

    return entries
      .map(entry => {
        const comment = entry.comment ? `<!-- ${entry.comment} -->\n` : '';
        return `${comment}${entry.content}`;
      })
      .join('\n\n');
  }
}
