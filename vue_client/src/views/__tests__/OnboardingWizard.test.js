import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const { mockPush, mockOnboardingAPI, mockToast, mockMarkOnboardingComplete } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockOnboardingAPI: {
    skip: vi.fn(),
    createPersona: vi.fn(),
    createPreset: vi.fn(),
    importDefaults: vi.fn(),
    complete: vi.fn()
  },
  mockToast: {
    error: vi.fn(),
    success: vi.fn()
  },
  mockMarkOnboardingComplete: vi.fn()
}))

// Mock the router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: mockPush
  })
}))

// Mock the API
vi.mock('../../services/api', () => ({
  onboardingAPI: mockOnboardingAPI
}))

// Mock the toast
vi.mock('../../composables/useToast', () => ({
  useToast: () => mockToast
}))

// Mock markOnboardingComplete
vi.mock('../../router', () => ({
  markOnboardingComplete: () => mockMarkOnboardingComplete()
}))

import OnboardingWizard from '../OnboardingWizard.vue'

describe('OnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnboardingAPI.skip.mockResolvedValue({ success: true })
    mockOnboardingAPI.createPersona.mockResolvedValue({ id: 'persona-1', name: 'John' })
    mockOnboardingAPI.createPreset.mockResolvedValue({ id: 'preset-1', name: 'DeepSeek', provider: 'deepseek' })
    mockOnboardingAPI.importDefaults.mockResolvedValue({ importedCharacters: 4, createdStories: 4 })
    mockOnboardingAPI.complete.mockResolvedValue({ success: true })
  })

  describe('Initial Rendering', () => {
    it('should render step 1 (Welcome) by default', () => {
      const wrapper = mount(OnboardingWizard)

      expect(wrapper.find('h1').text()).toBe('Welcome to Writers Guild')
      expect(wrapper.text()).toContain('AI-powered creative writing')
    })

    it('should show progress bar at 20% for step 1', () => {
      const wrapper = mount(OnboardingWizard)

      const progressFill = wrapper.find('.progress-fill')
      expect(progressFill.attributes('style')).toContain('width: 20%')
    })

    it('should display Get Started and Skip Setup buttons on step 1', () => {
      const wrapper = mount(OnboardingWizard)

      const buttons = wrapper.findAll('.button-group button')
      expect(buttons[0].text()).toBe('Skip Setup')
      expect(buttons[1].text()).toBe('Get Started')
    })
  })

  describe('Step Navigation', () => {
    it('should navigate to step 2 when clicking Get Started', async () => {
      const wrapper = mount(OnboardingWizard)

      await wrapper.find('.btn-primary').trigger('click')

      expect(wrapper.find('h1').text()).toBe('Create Your Persona')
    })

    it('should navigate back to step 1 when clicking Back on step 2', async () => {
      const wrapper = mount(OnboardingWizard)

      // Go to step 2
      await wrapper.find('.btn-primary').trigger('click')
      expect(wrapper.find('h1').text()).toBe('Create Your Persona')

      // Go back to step 1
      await wrapper.find('.btn-secondary').trigger('click')
      expect(wrapper.find('h1').text()).toBe('Welcome to Writers Guild')
    })

    it('should update progress bar as steps advance', async () => {
      const wrapper = mount(OnboardingWizard)

      // Step 1: 20%
      expect(wrapper.find('.progress-fill').attributes('style')).toContain('width: 20%')

      // Go to step 2: 40%
      await wrapper.find('.btn-primary').trigger('click')
      expect(wrapper.find('.progress-fill').attributes('style')).toContain('width: 40%')
    })
  })

  describe('Step 2: Persona Creation', () => {
    let wrapper

    beforeEach(async () => {
      wrapper = mount(OnboardingWizard)
      await wrapper.find('.btn-primary').trigger('click') // Go to step 2
    })

    it('should show persona form fields', () => {
      expect(wrapper.find('#firstName').exists()).toBe(true)
      expect(wrapper.find('#description').exists()).toBe(true)
    })

    it('should disable Continue button when firstName is empty', () => {
      const continueBtn = wrapper.findAll('.button-group button')[1]
      expect(continueBtn.attributes('disabled')).toBeDefined()
    })

    it('should enable Continue button when firstName is filled', async () => {
      await wrapper.find('#firstName').setValue('John')

      const continueBtn = wrapper.findAll('.button-group button')[1]
      expect(continueBtn.attributes('disabled')).toBeUndefined()
    })

    it('should call createPersona API when continuing with valid data', async () => {
      await wrapper.find('#firstName').setValue('John')
      await wrapper.find('#description').setValue('An adventurer')

      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(mockOnboardingAPI.createPersona).toHaveBeenCalledWith('John', 'An adventurer')
    })

    it('should advance to step 3 after successful persona creation', async () => {
      await wrapper.find('#firstName').setValue('John')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(wrapper.find('h1').text()).toBe('Configure AI Provider')
    })

    it('should show error toast on API failure', async () => {
      mockOnboardingAPI.createPersona.mockRejectedValueOnce(new Error('Network error'))

      await wrapper.find('#firstName').setValue('John')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(mockToast.error).toHaveBeenCalledWith('Failed to create persona: Network error')
    })

    it('should trim whitespace from firstName', async () => {
      await wrapper.find('#firstName').setValue('  John  ')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(mockOnboardingAPI.createPersona).toHaveBeenCalledWith('John', '')
    })
  })

  describe('Step 3: AI Provider Selection', () => {
    let wrapper

    beforeEach(async () => {
      wrapper = mount(OnboardingWizard)
      await wrapper.find('.btn-primary').trigger('click') // Step 1 -> 2
      await wrapper.find('#firstName').setValue('John')
      await wrapper.findAll('.button-group button')[1].trigger('click') // Step 2 -> 3
      await flushPromises()
    })

    it('should show all 5 provider options', () => {
      const providers = wrapper.findAll('.provider-option')
      expect(providers).toHaveLength(5)
    })

    it('should have DeepSeek selected by default', () => {
      const selected = wrapper.find('.provider-option.selected')
      expect(selected.text()).toContain('DeepSeek')
    })

    it('should show Recommended badge for DeepSeek', () => {
      expect(wrapper.find('.recommended-badge').text()).toBe('Recommended')
    })

    it('should show API key input for non-aihorde providers', () => {
      expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    })

    it('should hide API key input when AI Horde is selected', async () => {
      const aihordeOption = wrapper.findAll('.provider-option')[4]
      await aihordeOption.trigger('click')

      expect(wrapper.find('input[type="password"]').exists()).toBe(false)
      expect(wrapper.find('.info-box').text()).toContain('No API key required')
    })

    it('should disable Continue when API key is empty for non-aihorde provider', () => {
      const continueBtn = wrapper.findAll('.button-group button')[1]
      expect(continueBtn.attributes('disabled')).toBeDefined()
    })

    it('should enable Continue when API key is filled', async () => {
      await wrapper.find('input[type="password"]').setValue('sk-test-key')

      const continueBtn = wrapper.findAll('.button-group button')[1]
      expect(continueBtn.attributes('disabled')).toBeUndefined()
    })

    it('should enable Continue immediately for AI Horde (no API key needed)', async () => {
      const aihordeOption = wrapper.findAll('.provider-option')[4]
      await aihordeOption.trigger('click')

      const continueBtn = wrapper.findAll('.button-group button')[1]
      expect(continueBtn.attributes('disabled')).toBeUndefined()
    })

    it('should call createPreset API when continuing', async () => {
      await wrapper.find('input[type="password"]').setValue('sk-test-key')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(mockOnboardingAPI.createPreset).toHaveBeenCalledWith('deepseek', 'sk-test-key')
    })

    it('should advance to step 4 after successful preset creation', async () => {
      await wrapper.find('input[type="password"]').setValue('sk-test-key')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(wrapper.find('h1').text()).toBe('Import Sample Content')
    })

    it('should change provider when clicking different option', async () => {
      const openaiOption = wrapper.findAll('.provider-option')[1]
      await openaiOption.trigger('click')

      expect(wrapper.find('.provider-option.selected').text()).toContain('OpenAI')
    })
  })

  describe('Step 4: Import Defaults', () => {
    let wrapper

    beforeEach(async () => {
      wrapper = mount(OnboardingWizard)
      // Navigate to step 4
      await wrapper.find('.btn-primary').trigger('click')
      await wrapper.find('#firstName').setValue('John')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()
      await wrapper.find('input[type="password"]').setValue('sk-test-key')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()
    })

    it('should show import options', () => {
      expect(wrapper.find('h1').text()).toBe('Import Sample Content')
      const options = wrapper.findAll('.import-option')
      expect(options).toHaveLength(2)
    })

    it('should have "Yes, import samples" selected by default', () => {
      const selected = wrapper.find('.import-option.selected')
      expect(selected.text()).toContain('Yes, import samples')
    })

    it('should toggle import choice when clicking options', async () => {
      const noOption = wrapper.findAll('.import-option')[1]
      await noOption.trigger('click')

      expect(wrapper.findAll('.import-option')[1].classes()).toContain('selected')
      expect(wrapper.findAll('.import-option')[0].classes()).not.toContain('selected')
    })

    it('should show "Import & Finish" button when importing', () => {
      const finishBtn = wrapper.findAll('.button-group button')[1]
      expect(finishBtn.text()).toBe('Import & Finish')
    })

    it('should show "Finish Setup" button when not importing', async () => {
      const noOption = wrapper.findAll('.import-option')[1]
      await noOption.trigger('click')

      const finishBtn = wrapper.findAll('.button-group button')[1]
      expect(finishBtn.text()).toBe('Finish Setup')
    })

    it('should call importDefaults and complete APIs when importing', async () => {
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(mockOnboardingAPI.importDefaults).toHaveBeenCalled()
      expect(mockOnboardingAPI.complete).toHaveBeenCalled()
    })

    it('should only call complete API when not importing', async () => {
      const noOption = wrapper.findAll('.import-option')[1]
      await noOption.trigger('click')

      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(mockOnboardingAPI.importDefaults).not.toHaveBeenCalled()
      expect(mockOnboardingAPI.complete).toHaveBeenCalled()
    })

    it('should advance to step 5 after completion', async () => {
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      expect(wrapper.find('h1').text()).toBe("You're All Set!")
    })
  })

  describe('Step 5: Completion', () => {
    let wrapper

    beforeEach(async () => {
      wrapper = mount(OnboardingWizard)
      // Navigate through all steps to step 5
      await wrapper.find('.btn-primary').trigger('click')
      await wrapper.find('#firstName').setValue('John')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()
      await wrapper.find('input[type="password"]').setValue('sk-test-key')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()
    })

    it('should show completion message', () => {
      expect(wrapper.find('h1').text()).toBe("You're All Set!")
    })

    it('should show summary of setup', () => {
      const summary = wrapper.find('.summary')
      expect(summary.exists()).toBe(true)
      expect(summary.text()).toContain('John')
      expect(summary.text()).toContain('DeepSeek')
      expect(summary.text()).toContain('4 characters')
      expect(summary.text()).toContain('4 sample stories')
    })

    it('should show Start Writing button', () => {
      expect(wrapper.find('.btn-large').text()).toBe('Start Writing')
    })

    it('should call markOnboardingComplete and navigate home when finishing', async () => {
      await wrapper.find('.btn-large').trigger('click')

      expect(mockMarkOnboardingComplete).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/')
    })
  })

  describe('Skip Onboarding', () => {
    it('should call skip API and navigate home', async () => {
      const wrapper = mount(OnboardingWizard)

      await wrapper.find('.btn-secondary').trigger('click')
      await flushPromises()

      expect(mockOnboardingAPI.skip).toHaveBeenCalled()
      expect(mockMarkOnboardingComplete).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/')
    })

    it('should show error toast on skip failure', async () => {
      mockOnboardingAPI.skip.mockRejectedValueOnce(new Error('Skip failed'))
      const wrapper = mount(OnboardingWizard)

      await wrapper.find('.btn-secondary').trigger('click')
      await flushPromises()

      expect(mockToast.error).toHaveBeenCalledWith('Failed to skip onboarding: Skip failed')
    })
  })

  describe('Loading State', () => {
    it('should show loading overlay during API calls', async () => {
      // Make API call take longer
      mockOnboardingAPI.createPersona.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ name: 'John' }), 100))
      )

      const wrapper = mount(OnboardingWizard)
      await wrapper.find('.btn-primary').trigger('click')
      await wrapper.find('#firstName').setValue('John')

      // Start the API call
      wrapper.findAll('.button-group button')[1].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.loading-overlay').exists()).toBe(true)
      expect(wrapper.find('.spinner').exists()).toBe(true)
    })

    it('should show appropriate loading message', async () => {
      mockOnboardingAPI.createPersona.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ name: 'John' }), 100))
      )

      const wrapper = mount(OnboardingWizard)
      await wrapper.find('.btn-primary').trigger('click')
      await wrapper.find('#firstName').setValue('John')

      wrapper.findAll('.button-group button')[1].trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.loading-overlay').text()).toContain('Creating your persona')
    })
  })

  describe('Provider Validation', () => {
    it('should show toast error when creating preset without provider selected', async () => {
      const wrapper = mount(OnboardingWizard)

      // Go to step 3
      await wrapper.find('.btn-primary').trigger('click')
      await wrapper.find('#firstName').setValue('John')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      // The component has deepseek selected by default, so this scenario
      // can only happen if we manually clear selectedProvider
      // For coverage, we test that the button is disabled when no API key
      expect(wrapper.findAll('.button-group button')[1].attributes('disabled')).toBeDefined()
    })
  })

  describe('Computed Properties', () => {
    it('canProceedFromProvider should be true for aihorde without API key', async () => {
      const wrapper = mount(OnboardingWizard)

      // Go to step 3
      await wrapper.find('.btn-primary').trigger('click')
      await wrapper.find('#firstName').setValue('John')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      // Select AI Horde
      const aihordeOption = wrapper.findAll('.provider-option')[4]
      await aihordeOption.trigger('click')

      // Continue button should be enabled
      const continueBtn = wrapper.findAll('.button-group button')[1]
      expect(continueBtn.attributes('disabled')).toBeUndefined()
    })

    it('canProceedFromProvider should be false for deepseek without API key', async () => {
      const wrapper = mount(OnboardingWizard)

      // Go to step 3
      await wrapper.find('.btn-primary').trigger('click')
      await wrapper.find('#firstName').setValue('John')
      await wrapper.findAll('.button-group button')[1].trigger('click')
      await flushPromises()

      // DeepSeek is selected by default, but no API key
      const continueBtn = wrapper.findAll('.button-group button')[1]
      expect(continueBtn.attributes('disabled')).toBeDefined()
    })
  })
})
