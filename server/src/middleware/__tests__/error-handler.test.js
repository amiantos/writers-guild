import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError, errorHandler, asyncHandler } from '../error-handler.js';

describe('Error Handler Middleware', () => {
  describe('AppError', () => {
    it('should create error with message and status code', () => {
      const error = new AppError('Not found', 404);

      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('AppError');
    });

    it('should default to 500 status code', () => {
      const error = new AppError('Server error');

      expect(error.statusCode).toBe(500);
    });

    it('should have stack trace', () => {
      const error = new AppError('Test error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('AppError');
    });

    it('should be instance of Error', () => {
      const error = new AppError('Test');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('errorHandler', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      mockReq = {};
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      mockNext = vi.fn();

      // Suppress console.error during tests
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should handle AppError with custom status code', () => {
      const error = new AppError('Not found', 404);

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not found'
      });
    });

    it('should handle AppError with default status code', () => {
      const error = new AppError('Server error');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Server error'
      });
    });

    it('should handle regular Error', () => {
      const error = new Error('Regular error');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Regular error'
      });
    });

    it('should handle error without message', () => {
      const error = new Error();

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal server error'
      });
    });

    it('should include stack trace in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Dev error');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Dev error',
          stack: expect.any(String)
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include stack trace in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Prod error');

      errorHandler(error, mockReq, mockRes, mockNext);

      const jsonCall = mockRes.json.mock.calls[0][0];
      expect(jsonCall).not.toHaveProperty('stack');

      process.env.NODE_ENV = originalEnv;
    });

    it('should log error to console', () => {
      const error = new Error('Logged error');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(console.error).toHaveBeenCalledWith('Error:', error);
    });
  });

  describe('asyncHandler', () => {
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
      mockReq = {};
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      };
      mockNext = vi.fn();
    });

    it('should execute async function successfully', async () => {
      const asyncFn = vi.fn().mockResolvedValue('success');
      const wrapped = asyncHandler(asyncFn);

      await wrapped(mockReq, mockRes, mockNext);

      expect(asyncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should catch async errors and pass to next', async () => {
      const error = new Error('Async error');
      const asyncFn = vi.fn().mockRejectedValue(error);
      const wrapped = asyncHandler(asyncFn);

      await wrapped(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should catch errors thrown inside async function', async () => {
      const error = new Error('Thrown error');
      // asyncHandler works with async functions - errors thrown in async
      // context are caught by Promise.resolve().catch()
      const asyncFn = vi.fn().mockImplementation(async () => {
        throw error;
      });
      const wrapped = asyncHandler(asyncFn);

      await wrapped(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should handle AppError correctly', async () => {
      const error = new AppError('Custom error', 400);
      const asyncFn = vi.fn().mockRejectedValue(error);
      const wrapped = asyncHandler(asyncFn);

      await wrapped(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(error.statusCode).toBe(400);
    });

    it('should return a function', () => {
      const asyncFn = async () => {};
      const wrapped = asyncHandler(asyncFn);

      expect(typeof wrapped).toBe('function');
    });

    it('should pass through return value from res.json', async () => {
      mockRes.json.mockReturnValue('response');
      const asyncFn = vi.fn().mockImplementation((req, res) => {
        return res.json({ data: 'test' });
      });
      const wrapped = asyncHandler(asyncFn);

      await wrapped(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({ data: 'test' });
    });
  });
});
