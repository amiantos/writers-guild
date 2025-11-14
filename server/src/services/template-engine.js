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

    return result;
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
      const ifRegex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/;
      const ifMatch = result.match(ifRegex);

      if (ifMatch) {
        const condition = ifMatch[1].trim();
        const content = ifMatch[2];
        const conditionValue = this.evaluateCondition(condition, context);

        result = result.replace(ifMatch[0], conditionValue ? content : '');
        processed = true;
        continue;
      }

      // Process {{#unless}} blocks (inverse if)
      const unlessRegex = /\{\{#unless\s+([^}]+)\}\}([\s\S]*?)\{\{\/unless\}\}/;
      const unlessMatch = result.match(unlessRegex);

      if (unlessMatch) {
        const condition = unlessMatch[1].trim();
        const content = unlessMatch[2];
        const conditionValue = this.evaluateCondition(condition, context);

        result = result.replace(unlessMatch[0], !conditionValue ? content : '');
        processed = true;
        continue;
      }

      // Process {{#each}} blocks
      const eachRegex = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/;
      const eachMatch = result.match(eachRegex);

      if (eachMatch) {
        const arrayPath = eachMatch[1].trim();
        const content = eachMatch[2];
        const array = this.getNestedValue(arrayPath, context);

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

        result = result.replace(eachMatch[0], replacement);
        processed = true;
        continue;
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
