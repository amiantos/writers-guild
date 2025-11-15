# API Provider Configuration Improvements

## Executive Summary

After analyzing all 5 API providers (Anthropic, OpenAI, DeepSeek, AI Horde, OpenRouter) and their official documentation, several critical configuration issues and enhancement opportunities have been identified.

---

## 🚨 Critical Issues (Fix Required)

### 1. **Anthropic (Claude) - Invalid Temperature Range**

**Issue**: The UI allows temperature values from 0-2.0, but Anthropic's API only accepts **0.0 to 1.0**.

**Location**:
- UI: `/vue_client/src/components/providers/shared/GenerationSettings.vue`
- Provider: `/server/src/services/providers/anthropic-provider.js:78,125`

**Impact**: Setting temperature above 1.0 may cause API errors or unexpected behavior.

**Fix**: Add provider-specific temperature validation. Anthropic should max at 1.0.

**API Documentation**: https://docs.claude.com/en/api/messages
> "Temperature: Valid Range: 0.0 to 1.0 (defaults to 1.0)"

---

### 2. **DeepSeek Reasoner - Temperature Parameter Ignored**

**Issue**: The `deepseek-reasoner` model **completely ignores** the temperature parameter (and top_p, presence_penalty, frequency_penalty). Setting these parameters has no effect but doesn't cause errors for compatibility reasons.

**Location**:
- Provider: `/server/src/services/providers/deepseek-provider.js:75,123`
- Default preset: `/server/src/services/default-presets.js:62` (defaults to 1.5)

**Impact**: Users may think they're controlling the model's creativity, but they're not. The UI should indicate this.

**Evidence from API Issues**:
- https://github.com/vercel/ai/issues/4455
- https://github.com/deepseek-ai/DeepSeek-R1/issues/7

**Recommendation**:
1. Add a UI indicator that temperature is ignored for `deepseek-reasoner`
2. Only the `deepseek-chat` model respects temperature
3. Consider disabling the temperature slider or showing a warning when using `deepseek-reasoner`

---

## 📊 Missing "Must-Have" Parameters

### **All Providers (Except AI Horde)**

These parameters are supported by the APIs but not exposed in our UI:

| Parameter | Anthropic | OpenAI | DeepSeek | Purpose |
|-----------|-----------|--------|----------|---------|
| **top_p** | ✅ | ✅ | ✅* | Nucleus sampling (0-1) |
| **top_k** | ✅ | ❌ | ✅* | Sample from top K tokens |
| **frequency_penalty** | ❌ | ✅ | ✅* | Penalize frequent tokens (-2 to 2) |
| **presence_penalty** | ❌ | ✅ | ✅* | Penalize repeated topics (-2 to 2) |
| **stop_sequences** | ✅ | ✅ | ✅ | Custom stop sequences |

*Not available for `deepseek-reasoner`, only `deepseek-chat`

**Anthropic Additional Parameters**:
- `thinking` - Extended thinking mode with budget
- `service_tier` - Capacity priority control

**OpenAI Additional Parameters**:
- `seed` - Deterministic generation
- `logprobs` - Token probability logging
- `max_completion_tokens` - Already implemented! ✅

---

### **AI Horde - Many Hardcoded Parameters**

**Current Hardcoded Values** (in `/server/src/services/providers/aihorde-provider.js:135-139`):

```javascript
rep_pen: 1.1              // Repetition penalty
rep_pen_range: 320        // Penalty range
sampler_order: [6,0,1,3,4,2,5]  // Order: rep_pen, top_k, top_a, top_p, tfs, temp, typ
use_default_badwordsids: true   // Prevent EOS token issues
pollingInterval: 2000     // Status check interval (ms)
```

**Available But Not Exposed** (from AI Horde API):

| Parameter | Current | Range | Purpose |
|-----------|---------|-------|---------|
| `temperature` | ✅ Exposed | 0-2.0 | Randomness control |
| `top_p` | ❌ | 0-1 | Nucleus sampling |
| `top_k` | ❌ | 0+ | Top-K sampling |
| `top_a` | ❌ | 0-1 | Top-A sampling |
| `typical` (typ) | ❌ | 0-1 | Typical sampling |
| `tfs` | ❌ | 0-1 | Tail-free sampling |
| `rep_pen` | ❌ Hardcoded: 1.1 | 1.0-3.0 | Repetition penalty |
| `rep_pen_range` | ❌ Hardcoded: 320 | 0-4096 | Penalty lookback range |
| `rep_pen_slope` | ❌ | 0-10 | Penalty curve slope |
| `sampler_order` | ❌ Hardcoded | Array[7] | Order of sampler application |
| `min_p` | ❌ | 0-1 | Minimum probability threshold |
| `dynatemp_range` | ❌ | 0+ | Dynamic temperature range |
| `dynatemp_exponent` | ❌ | 0+ | Dynamic temperature curve |
| `smoothing_factor` | ❌ | 0+ | Probability smoothing |

**Sampler Order Reference**:
- 0 = top_k
- 1 = top_a
- 2 = top_p
- 3 = tfs
- 4 = typ (typical)
- 5 = temp (temperature)
- 6 = rep_pen (repetition penalty)

**Default Best Practice**: `[6,0,1,3,4,2,5]` with Top-P=0.92, RepPen=1.1, Temp=0.7

---

## 🎯 Recommended Implementation Priorities

### **Priority 1: Critical Fixes**

1. **Fix Anthropic Temperature Range**
   - Change max from 2.0 to 1.0 for Anthropic provider
   - Add provider-specific validation in `GenerationSettings.vue`

2. **Add DeepSeek Reasoner Warning**
   - Detect when `deepseek-reasoner` model is selected
   - Show UI indicator that temperature/sampling params are ignored
   - Optionally disable these controls for this model

### **Priority 2: Essential Missing Parameters**

3. **Add Universal Parameters** (all providers where supported):
   - `top_p` (0-1) - Most important sampling parameter
   - `stop_sequences` (array of strings) - Critical for controlling output
   - `frequency_penalty` (OpenAI/DeepSeek) - Useful for creative writing
   - `presence_penalty` (OpenAI/DeepSeek) - Useful for avoiding repetition

### **Priority 3: AI Horde Enhancements**

4. **Expose Core AI Horde Samplers**:
   - `rep_pen` (1.0-3.0, default 1.1) - Currently hardcoded
   - `rep_pen_range` (0-4096, default 320) - Currently hardcoded
   - `top_p` (0-1, default 0.92) - Not available at all
   - `top_k` (0+, default -1 for disabled) - Not available at all

5. **Advanced AI Horde Panel** (optional):
   - `sampler_order` configurator with visual ordering
   - Advanced samplers: top_a, tfs, typical, min_p
   - Dynamic temperature settings

### **Priority 4: Nice-to-Have**

6. **Provider-Specific Features**:
   - Anthropic `thinking` mode support (extended reasoning)
   - OpenAI `seed` parameter (deterministic generation)
   - Provider capability badges (vision, reasoning, streaming)

7. **UI Enhancements**:
   - Per-provider "Advanced Settings" collapsible section
   - Parameter tooltips with explanations
   - Preset templates for common use cases ("Creative", "Balanced", "Precise")
   - Context usage visualization

---

## 📋 Implementation Approach

### **UI Changes Needed**

1. **GenerationSettings.vue**:
   ```vue
   <!-- Add provider-aware temperature max -->
   <input
     type="range"
     :max="getMaxTemperature(provider)"
     v-model="temperature"
   />

   <!-- Add warning for deepseek-reasoner -->
   <div v-if="isDeepSeekReasoner" class="warning">
     Note: Temperature is ignored by deepseek-reasoner model
   </div>
   ```

2. **New Component: AdvancedSamplingSettings.vue**:
   - Top-P slider (0-1)
   - Top-K input (integer)
   - Frequency penalty (-2 to 2)
   - Presence penalty (-2 to 2)
   - Stop sequences (text area, comma-separated)

3. **AIHordeConfig.vue Additions**:
   - Repetition penalty slider
   - Repetition penalty range input
   - Top-P slider
   - Optional: Sampler order configurator

### **Backend Changes Needed**

1. **Update Provider Classes**:
   ```javascript
   // anthropic-provider.js, openai-provider.js, etc.
   generate(systemPrompt, userPrompt, options = {}) {
     // Add to request body:
     top_p: options.top_p,
     frequency_penalty: options.frequency_penalty,
     presence_penalty: options.presence_penalty,
     stop: options.stop_sequences,
   }
   ```

2. **Update Preset Schema**:
   ```javascript
   generationSettings: {
     // Existing
     maxTokens: 4000,
     temperature: 1.0,

     // New additions
     top_p: null,  // null = use API default
     top_k: null,
     frequency_penalty: null,
     presence_penalty: null,
     stop_sequences: [],
   }
   ```

3. **AI Horde Specific** (`aihorde-provider.js:129-139`):
   ```javascript
   const params = {
     // ... existing params
     temperature: options.temperature,

     // Make configurable (currently hardcoded):
     rep_pen: options.rep_pen || 1.1,
     rep_pen_range: options.rep_pen_range || 320,
     sampler_order: options.sampler_order || [6,0,1,3,4,2,5],

     // Add new samplers:
     top_p: options.top_p,
     top_k: options.top_k || -1,
     top_a: options.top_a,
     typical: options.typical,
     tfs: options.tfs,
   }
   ```

### **Validation Logic**

```javascript
// New file: /server/src/services/providers/validation.js

export function validateTemperature(provider, temperature) {
  const ranges = {
    anthropic: { min: 0, max: 1.0 },
    openai: { min: 0, max: 2.0 },
    deepseek: { min: 0, max: 2.0 },  // Ignored by reasoner
    aihorde: { min: 0, max: 2.0 },
    openrouter: { min: 0, max: 2.0 },
  };

  const range = ranges[provider];
  return temperature >= range.min && temperature <= range.max;
}

export function shouldWarnAboutIgnoredParams(provider, model) {
  // DeepSeek reasoner ignores temperature/sampling
  return provider === 'deepseek' && model === 'deepseek-reasoner';
}
```

---

## 🔍 Testing Checklist

After implementing changes:

- [ ] Test Anthropic with temperature > 1.0 (should error or be clamped)
- [ ] Verify DeepSeek reasoner shows warning about ignored parameters
- [ ] Test top_p with all providers that support it
- [ ] Test stop_sequences with custom stop strings
- [ ] Test AI Horde with custom rep_pen and sampler settings
- [ ] Verify preset migration handles new optional fields
- [ ] Test that null/undefined values use API defaults

---

## 📚 References

### API Documentation
- **Anthropic**: https://docs.claude.com/en/api/messages
- **OpenAI**: https://platform.openai.com/docs/api-reference/chat/create
- **DeepSeek**: https://api-docs.deepseek.com/guides/reasoning_model
- **AI Horde**: https://stablehorde.net/api/ (Swagger UI)
- **OpenRouter**: Uses OpenAI-compatible API

### Known Issues
- DeepSeek temperature issue: https://github.com/deepseek-ai/DeepSeek-R1/issues/7
- Vercel AI SDK error: https://github.com/vercel/ai/issues/4455

---

## 📂 Files to Modify

### Frontend (Vue)
- `/vue_client/src/components/providers/shared/GenerationSettings.vue` - Add temp validation
- `/vue_client/src/components/providers/shared/AdvancedSamplingSettings.vue` - NEW FILE
- `/vue_client/src/components/providers/AIHordeConfig.vue` - Add sampler controls

### Backend (Node.js)
- `/server/src/services/providers/anthropic-provider.js` - Add top_p, top_k, stop
- `/server/src/services/providers/openai-provider.js` - Add missing params
- `/server/src/services/providers/deepseek-provider.js` - Add warning flag
- `/server/src/services/providers/aihorde-provider.js` - Expose hardcoded params
- `/server/src/services/default-presets.js` - Update defaults
- `/server/src/services/providers/validation.js` - NEW FILE

### Schema Updates
- Preset JSON schema needs extension for new fields

---

## Summary

**Critical Issues**: 2 (Anthropic temp range, DeepSeek reasoner ignored params)
**Missing Essential Parameters**: 5 (top_p, top_k, frequency_penalty, presence_penalty, stop_sequences)
**AI Horde Hardcoded Parameters**: 8+ (rep_pen, top_p, sampler_order, etc.)
**Estimated Implementation Time**:
- Priority 1 (Critical): 2-4 hours
- Priority 2 (Essential): 4-6 hours
- Priority 3 (AI Horde): 6-8 hours
- Priority 4 (Nice-to-have): 8-12 hours

**Total for Priorities 1-3**: ~20 hours of development + testing
