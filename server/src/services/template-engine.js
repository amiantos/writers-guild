/**
 * Simple Template Engine for System Prompts
 * Supports variables, conditionals, and loops
 */

export class TemplateEngine {
  /**
   * Render a template with the provided data
   * @param {string} template - Template string
   * @param {Object} data - Data object for substitution
   * @returns {string} Rendered template
   */
  render(template, data) {
    if (!template) return '';

    // Process template blocks (conditionals and loops) first
    let result = this.processBlocks(template, data);

    // Then process simple variable substitutions
    result = this.processVariables(result, data);

    // Clean up excessive consecutive newlines (3+ becomes 2)
    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
  }

  /**
   * Find matching closing tag for a block, accounting for nesting
   */
  findMatchingClose(template, openTag, closeTag, startPos) {
    let depth = 1;
    let pos = startPos;

    while (pos < template.length && depth > 0) {
      // Look for next opening or closing tag
      const nextOpen = template.indexOf(openTag, pos);
      const nextClose = template.indexOf(closeTag, pos);

      // If no closing tag found, return -1
      if (nextClose === -1) return -1;

      // If we find a closing tag before another opening tag (or no opening tag)
      if (nextOpen === -1 || nextClose < nextOpen) {
        depth--;
        if (depth === 0) {
          return nextClose;
        }
        pos = nextClose + closeTag.length;
      } else {
        // Found another opening tag before the closing tag
        depth++;
        pos = nextOpen + openTag.length;
      }
    }

    return -1;
  }

  /**
   * Process block directives (if, each)
   */
  processBlocks(template, data, context = data) {
    let result = template;
    let maxIterations = 100; // Prevent infinite loops
    let iteration = 0;

    // Keep processing until no more blocks are found
    while (iteration < maxIterations) {
      iteration++;
      let processed = false;

      // Process {{#if}} blocks
      const ifStart = result.indexOf('{{#if ');
      if (ifStart !== -1) {
        const conditionStart = ifStart + 6; // length of '{{#if '
        const conditionEnd = result.indexOf('}}', conditionStart);

        if (conditionEnd !== -1) {
          const condition = result.substring(conditionStart, conditionEnd).trim();
          const contentStart = conditionEnd + 2; // after '}}'
          const closePos = this.findMatchingClose(result, '{{#if ', '{{/if}}', contentStart);

          if (closePos !== -1) {
            const content = result.substring(contentStart, closePos);
            const conditionValue = this.evaluateCondition(condition, context);
            const fullBlock = result.substring(ifStart, closePos + 7); // 7 = length of '{{/if}}'

            result = result.replace(fullBlock, conditionValue ? content : '');
            processed = true;
            continue;
          }
        }
      }

      // Process {{#unless}} blocks (inverse if)
      const unlessStart = result.indexOf('{{#unless ');
      if (unlessStart !== -1) {
        const conditionStart = unlessStart + 10; // length of '{{#unless '
        const conditionEnd = result.indexOf('}}', conditionStart);

        if (conditionEnd !== -1) {
          const condition = result.substring(conditionStart, conditionEnd).trim();
          const contentStart = conditionEnd + 2;
          const closePos = this.findMatchingClose(result, '{{#unless ', '{{/unless}}', contentStart);

          if (closePos !== -1) {
            const content = result.substring(contentStart, closePos);
            const conditionValue = this.evaluateCondition(condition, context);
            const fullBlock = result.substring(unlessStart, closePos + 11); // 11 = length of '{{/unless}}'

            result = result.replace(fullBlock, !conditionValue ? content : '');
            processed = true;
            continue;
          }
        }
      }

      // Process {{#each}} blocks
      const eachStart = result.indexOf('{{#each ');
      if (eachStart !== -1) {
        const arrayPathStart = eachStart + 8; // length of '{{#each '
        const arrayPathEnd = result.indexOf('}}', arrayPathStart);

        if (arrayPathEnd !== -1) {
          const arrayPath = result.substring(arrayPathStart, arrayPathEnd).trim();
          const contentStart = arrayPathEnd + 2;
          const closePos = this.findMatchingClose(result, '{{#each ', '{{/each}}', contentStart);

          if (closePos !== -1) {
            const content = result.substring(contentStart, closePos);
            const array = this.getNestedValue(arrayPath, context);
            const fullBlock = result.substring(eachStart, closePos + 9); // 9 = length of '{{/each}}'

            let replacement = '';
            if (Array.isArray(array)) {
              array.forEach((item, index) => {
                const itemContext = {
                  ...item,
                  '@index': index,
                  '@index_1': index + 1,
                  '@first': index === 0,
                  '@last': index === array.length - 1,
                  '@length': array.length
                };

                // Recursively process the content with item context
                let itemResult = this.processBlocks(content, data, itemContext);
                itemResult = this.processVariables(itemResult, itemContext);
                replacement += itemResult;
              });
            }

            result = result.replace(fullBlock, replacement);
            processed = true;
            continue;
          }
        }
      }

      // If no blocks were processed, we're done
      if (!processed) break;
    }

    return result;
  }

  /**
   * Evaluate a condition
   */
  evaluateCondition(condition, context) {
    // Handle simple existence checks
    const value = this.getNestedValue(condition, context);

    // Truthy check
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return !!value;
  }

  /**
   * Process variable substitutions
   */
  processVariables(template, context) {
    return template.replace(/\{\{([^#\/][^}]*)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();
      const value = this.getNestedValue(trimmedPath, context);

      // Return empty string for null/undefined, otherwise stringify
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(path, obj) {
    if (!path || !obj) return undefined;

    const keys = path.split('.');
    let value = obj;

    for (const key of keys) {
      if (value === null || value === undefined) return undefined;
      value = value[key];
    }

    return value;
  }
}
