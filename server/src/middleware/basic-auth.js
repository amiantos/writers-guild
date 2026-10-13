import crypto from 'crypto';

/**
 * Optional HTTP Basic Authentication middleware.
 * Enabled only when both BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD
 * environment variables are set. Otherwise, returns a no-op middleware.
 *
 * @param {Object} [options]
 * @param {() => boolean} [options.signInEnabled] - Whether Writers Guild's own signing in is on,
 *   in which case basic auth stands aside rather than asking for a second password.
 */
export default function basicAuth({ signInEnabled = () => false } = {}) {
  const username = process.env.BASIC_AUTH_USERNAME;
  const password = process.env.BASIC_AUTH_PASSWORD;

  if (!username || !password) {
    return (req, res, next) => next();
  }

  const expectedCredentials = `${username}:${password}`;
  const expectedBuffer = Buffer.from(expectedCredentials);

  return (req, res, next) => {
    if (signInEnabled()) return next();

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return deny(res);
    }

    let decoded;
    try {
      decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    } catch {
      return deny(res);
    }

    const actualBuffer = Buffer.from(decoded);

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      return deny(res);
    }

    next();
  };
}

function deny(res) {
  res.set('WWW-Authenticate', 'Basic realm="Writers Guild"');
  res.status(401).send('Unauthorized');
}
