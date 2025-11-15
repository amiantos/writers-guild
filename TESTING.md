# Testing Guide for Úrscéal

This document provides information about the testing setup and how to write and run tests for Úrscéal.

## Overview

Úrscéal uses **Vitest** as the primary testing framework for both backend and frontend code. Vitest is a fast, modern testing framework that works seamlessly with ES modules and provides a Jest-compatible API.

**Test Coverage:**
- **Server**: 223 tests covering services and providers
- **Client**: 118 tests covering composables and components
- **Total**: 341 tests

## Test Structure

```
ursceal/
├── server/
│   ├── vitest.config.js
│   └── src/
│       ├── services/
│       │   └── __tests__/          # Service unit tests
│       │       ├── macro-processor.test.js
│       │       ├── template-engine.test.js
│       │       ├── prompt-builder.test.js
│       │       └── lorebook-activator.test.js
│       └── providers/
│           └── __tests__/          # Provider unit tests
│               ├── anthropic-provider.test.js
│               └── openai-provider.test.js
└── vue_client/
    ├── vite.config.js              # Includes Vitest config
    └── src/
        ├── composables/
        │   └── __tests__/          # Composable unit tests
        │       ├── useConfirm.test.js
        │       └── useToast.test.js
        └── components/
            └── __tests__/          # Component tests
                ├── ConfirmDialog.test.js
                └── Tabs.test.js
```

## Running Tests

### All Tests

```bash
# Run all tests (server + client)
npm test

# Run all tests with coverage
npm run test:coverage
```

### Server Tests

```bash
# Run all server tests
npm run test:server

# Run specific server test file
cd server && npm test -- macro-processor

# Run server tests with coverage
npm run test:server:coverage

# Run tests in watch mode
cd server && npm test
```

### Client Tests

```bash
# Run all client tests
npm run test:client

# Run specific client test file
cd vue_client && npm test -- useConfirm

# Run client tests with coverage
npm run test:client:coverage

# Run tests in watch mode
cd vue_client && npm test
```

## Writing Tests

### Backend Service Tests

Backend tests focus on business logic in services and providers. They mock external dependencies like `fetch`.

**Example: Service Test**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { MacroProcessor } from '../macro-processor.js';

describe('MacroProcessor', () => {
  let processor;

  beforeEach(() => {
    processor = new MacroProcessor({
      userName: 'Alice',
      charName: 'Bob'
    });
  });

  describe('Context Macros', () => {
    it('should replace {{user}} with user name', () => {
      const result = processor.processContextMacros('Hello {{user}}!');
      expect(result).toBe('Hello Alice!');
    });
  });
});
```

**Example: Provider Test with Mocked Fetch**

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider.js';

describe('AnthropicProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    provider = new AnthropicProvider({
      apiKey: 'test-api-key',
      model: 'claude-3-5-sonnet-20241022'
    });
  });

  it('should generate content successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Generated response' }]
      })
    });

    const result = await provider.generate(
      'System prompt',
      'User prompt'
    );

    expect(result.content).toBe('Generated response');
  });
});
```

### Frontend Composable Tests

Composable tests verify Vue 3 composition API logic.

**Example: Composable Test**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { useConfirm } from '../useConfirm.js';

describe('useConfirm', () => {
  let confirmInstance;

  beforeEach(() => {
    confirmInstance = useConfirm();
    confirmInstance.isVisible.value = false;
  });

  it('should show dialog when confirm is called', () => {
    confirmInstance.confirm({ message: 'Test message' });
    expect(confirmInstance.isVisible.value).toBe(true);
  });

  it('should resolve promise with true when confirmed', async () => {
    const promise = confirmInstance.confirm({ message: 'Test' });
    confirmInstance.handleConfirm();
    const result = await promise;
    expect(result).toBe(true);
  });
});
```

### Frontend Component Tests

Component tests use Vue Test Utils to mount and interact with components.

**Example: Component Test**

```javascript
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfirmDialog from '../ConfirmDialog.vue';

describe('ConfirmDialog', () => {
  it('should render with required props', () => {
    const wrapper = mount(ConfirmDialog, {
      props: {
        message: 'Are you sure?'
      }
    });

    expect(wrapper.text()).toContain('Are you sure?');
  });

  it('should emit confirm event when confirm button clicked', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { message: 'Test' }
    });

    const confirmButton = wrapper.findAll('button')[1];
    await confirmButton.trigger('click');

    expect(wrapper.emitted('confirm')).toBeTruthy();
  });
});
```

## Testing Best Practices

### 1. Test Organization

- Group related tests with `describe` blocks
- Use clear, descriptive test names
- Follow the Arrange-Act-Assert pattern
- One assertion per test when possible

### 2. beforeEach and afterEach

```javascript
beforeEach(() => {
  // Setup runs before each test
  vi.useFakeTimers();
});

afterEach(() => {
  // Cleanup runs after each test
  vi.restoreAllMocks();
});
```

### 3. Mocking

**Mock functions:**
```javascript
const mockCallback = vi.fn();
mockCallback('test');
expect(mockCallback).toHaveBeenCalledWith('test');
```

**Mock timers:**
```javascript
vi.useFakeTimers();
setTimeout(() => doSomething(), 1000);
vi.advanceTimersByTime(1000);
expect(doSomething).toHaveBeenCalled();
```

**Mock modules:**
```javascript
vi.mock('./module.js', () => ({
  default: vi.fn(() => 'mocked')
}));
```

### 4. Testing Async Code

```javascript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBe(expected);
});

it('should reject with error', async () => {
  await expect(failingFunction()).rejects.toThrow('Error message');
});
```

### 5. Component Testing Tips

**Finding elements:**
```javascript
wrapper.find('.class-name')
wrapper.findAll('button')
wrapper.find('[data-testid="my-element"]')
```

**Triggering events:**
```javascript
await wrapper.find('button').trigger('click');
await wrapper.find('input').setValue('value');
```

**Checking emissions:**
```javascript
expect(wrapper.emitted('event-name')).toBeTruthy();
expect(wrapper.emitted('event-name')[0]).toEqual(['arg1', 'arg2']);
```

**Using slots:**
```javascript
mount(Component, {
  slots: {
    default: '<div>Slot content</div>'
  }
});
```

## Coverage Reports

After running tests with coverage, reports are available in:
- `server/coverage/` - Server code coverage
- `vue_client/coverage/` - Client code coverage

Open `coverage/index.html` in a browser to view detailed coverage reports.

## Continuous Integration

Tests are automatically run on:
- Pre-commit hooks (if configured)
- Pull requests
- Main branch commits

Ensure all tests pass before submitting a PR:
```bash
npm test
```

## Common Issues

### Issue: Tests fail with "Cannot find module"

**Solution:** Ensure you're using the correct import paths and that modules are exported correctly.

### Issue: Component tests fail with "Cannot read property of undefined"

**Solution:** Check that all required props are provided in the mount() call.

### Issue: Async tests timeout

**Solution:** Ensure you're using `async/await` properly and not forgetting to resolve promises.

### Issue: Mocked timers don't work

**Solution:** Remember to call `vi.useFakeTimers()` in beforeEach and restore with `vi.restoreAllMocks()`.

## Test Coverage Goals

| Category | Current | Goal |
|----------|---------|------|
| Services | 100% | 100% |
| Providers | 90% | 90% |
| Composables | 95% | 95% |
| Components | 70% | 80% |
| Overall | 85% | 85% |

## Adding New Tests

When adding new features:

1. **Write tests first** (TDD approach) or alongside implementation
2. **Cover edge cases**: null/undefined inputs, empty arrays, boundary conditions
3. **Test error handling**: What happens when things go wrong?
4. **Mock external dependencies**: Don't test API services directly
5. **Keep tests fast**: Avoid unnecessary delays or real API calls
6. **Update this guide** if you introduce new testing patterns

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Testing Library Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

## Questions?

If you have questions about testing or need help writing tests for a specific feature, feel free to:
- Check existing test files for examples
- Review this guide
- Ask in the project discussions
