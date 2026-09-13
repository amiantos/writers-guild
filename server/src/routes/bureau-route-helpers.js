/**
 * Helpers shared by the Bureau routers.
 */

import { AppError } from '../middleware/error-handler.js';
import { DeepSeekClient } from '../services/bureau/deepseek-client.js';
import { getBureauStores } from '../services/bureau/stores.js';

/** Middleware: puts this data root's Bureau stores on res.locals.stores. */
export function attachBureauStores(req, res, next) {
  res.locals.stores = getBureauStores(req.app.locals.dataRoot);
  next();
}

export function requireBureau(bureaus, bureauId) {
  const bureau = bureaus.getBureau(bureauId);
  if (!bureau) {
    throw new AppError('Bureau not found', 404);
  }
  return bureau;
}

export function requireStory(stories, bureauId, storyId) {
  const story = stories.getStory(bureauId, storyId);
  if (!story) {
    throw new AppError('Chapter not found', 404);
  }
  return story;
}

export function requireApiKey(bureau) {
  if (!bureau.hasApiKey) {
    throw new AppError('This Bureau has no API key. Add one in its settings.', 400);
  }
}

/** A trimmed string field from the body, or undefined when it's absent. */
export function optionalString(body, field) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(`${field} must be a string`, 400);
  }
  return value.trim();
}

/**
 * A DeepSeek client for a Bureau's credentials. Tests swap in a fake by setting
 * app.locals.createBureauClient.
 * @param {import('express').Request} req
 * @param {{ apiKey: string, model: string }} credentials
 */
export function createBureauClient(req, credentials) {
  const factory = req.app.locals.createBureauClient ?? ((config) => new DeepSeekClient(config));
  return factory(credentials);
}
