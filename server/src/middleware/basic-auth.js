import crypto from 'crypto';

/**
 * Optional HTTP Basic Authentication middleware.
 * Enabled only when both BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD
 * environment variables are set. Otherwise, returns a no-op middleware.
 */
export default function basicAuth() {
  const username = process.env.BASIC_AUTH_USERNAME;
  const password = process.env.BASIC_AUTH_PASSWORD;

  if (!username || !password) {
    return (req, res, next) => next();
  }

  const expectedCredentials = `${username}:${password}`;
  const expectedBuffer = Buffer.from(expectedCredentials);

  const MAX_ATTEMPTS = 5;
  const WINDOW_MS = 15 * 60 * 1000;
  const attemptsByIp = new Map();

  return (req, res, next) => {
    const ip = req.ip;
    const record = attemptsByIp.get(ip);
    const now = Date.now();

    if (record && now - record.firstAttempt > WINDOW_MS) {
      attemptsByIp.delete(ip);
    } else if (record && record.count >= MAX_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil((WINDOW_MS - (now - record.firstAttempt)) / 1000)));
      return res.status(429).send('Too Many Requests');
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return deny(res, ip, attemptsByIp);
    }

    let decoded;
    try {
      decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    } catch {
      return deny(res, ip, attemptsByIp);
    }

    const actualBuffer = Buffer.from(decoded);

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      return deny(res, ip, attemptsByIp);
    }

    attemptsByIp.delete(ip);
    next();
  };
}

function deny(res, ip, attemptsByIp) {
  const record = attemptsByIp.get(ip);
  if (record) {
    record.count += 1;
  } else {
    attemptsByIp.set(ip, { count: 1, firstAttempt: Date.now() });
  }

  res.set('WWW-Authenticate', 'Basic realm="Writers Guild"');
  res.status(401).send('Unauthorized');
}
