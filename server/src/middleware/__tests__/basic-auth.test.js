import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import basicAuth from '../basic-auth.js';

function createMockRes() {
  const res = {
    set: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res;
}

function encode(str) {
  return Buffer.from(str).toString('base64');
}

describe('Basic Auth Middleware', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env.BASIC_AUTH_USERNAME = originalEnv.BASIC_AUTH_USERNAME;
    process.env.BASIC_AUTH_PASSWORD = originalEnv.BASIC_AUTH_PASSWORD;
    if (!originalEnv.BASIC_AUTH_USERNAME) delete process.env.BASIC_AUTH_USERNAME;
    if (!originalEnv.BASIC_AUTH_PASSWORD) delete process.env.BASIC_AUTH_PASSWORD;
  });

  describe('when env vars are not set', () => {
    beforeEach(() => {
      delete process.env.BASIC_AUTH_USERNAME;
      delete process.env.BASIC_AUTH_PASSWORD;
    });

    it('should return a no-op middleware that calls next()', () => {
      const middleware = basicAuth();
      const next = vi.fn();
      middleware({}, createMockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('should pass through when only username is set', () => {
      process.env.BASIC_AUTH_USERNAME = 'admin';
      const middleware = basicAuth();
      const next = vi.fn();
      middleware({}, createMockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('should pass through when only password is set', () => {
      process.env.BASIC_AUTH_PASSWORD = 'secret';
      const middleware = basicAuth();
      const next = vi.fn();
      middleware({}, createMockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('should pass through when env vars are empty strings', () => {
      process.env.BASIC_AUTH_USERNAME = '';
      process.env.BASIC_AUTH_PASSWORD = '';
      const middleware = basicAuth();
      const next = vi.fn();
      middleware({}, createMockRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('when env vars are set', () => {
    let middleware;

    beforeEach(() => {
      process.env.BASIC_AUTH_USERNAME = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';
      middleware = basicAuth();
    });

    it('should return 401 when no Authorization header is present', () => {
      const req = { headers: {} };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.send).toHaveBeenCalledWith('Unauthorized');
      expect(res.set).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Writers Guild"');
    });

    it('should return 401 when Authorization header is not Basic', () => {
      const req = { headers: { authorization: 'Bearer token123' } };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 with wrong credentials', () => {
      const req = {
        headers: { authorization: `Basic ${encode('admin:wrong')}` },
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 with wrong username', () => {
      const req = {
        headers: { authorization: `Basic ${encode('wrong:secret')}` },
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should call next() with correct credentials', () => {
      const req = {
        headers: { authorization: `Basic ${encode('admin:secret')}` },
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should handle passwords containing colons', () => {
      process.env.BASIC_AUTH_PASSWORD = 'pass:with:colons';
      const mw = basicAuth();

      const req = {
        headers: {
          authorization: `Basic ${encode('admin:pass:with:colons')}`,
        },
      };
      const res = createMockRes();
      const next = vi.fn();

      mw(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 401 for malformed base64', () => {
      const req = {
        headers: { authorization: 'Basic !!!not-base64!!!' },
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 for empty Basic value', () => {
      const req = {
        headers: { authorization: 'Basic ' },
      };
      const res = createMockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('once signing in is on', () => {
    beforeEach(() => {
      process.env.BASIC_AUTH_USERNAME = 'admin';
      process.env.BASIC_AUTH_PASSWORD = 'secret';
    });

    it('stands aside, so there is only the one prompt', () => {
      let signInEnabled = false;
      const middleware = basicAuth({ signInEnabled: () => signInEnabled });
      const next = vi.fn();

      const res = createMockRes();
      middleware({ headers: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);

      signInEnabled = true;
      middleware({ headers: {} }, createMockRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
