/**
 * Úrscéal Server
 * Express server for multi-story novel writing application
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import yaml from 'yaml';

// Middleware
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import bodyParser from 'body-parser';

// Import route handlers
import storiesRouter from './src/routes/stories.js';
import charactersRouter from './src/routes/characters.js';
import settingsRouter from './src/routes/settings.js';
import generateRouter from './src/routes/generate.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
const configPath = path.join(__dirname, 'config.yaml');
const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));

// Initialize Express app
const app = express();
const PORT = process.env.PORT || config.server.port || 8000;
const HOST = config.server.host || '0.0.0.0';

// Resolve data directory path
const DATA_ROOT = path.resolve(__dirname, config.data.root);

// Make config and data root available to routes
app.locals.config = config;
app.locals.dataRoot = DATA_ROOT;

// Ensure data directory exists
if (!fs.existsSync(DATA_ROOT)) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  console.log(`Created data directory: ${DATA_ROOT}`);
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for now (can enable later)
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: config.security.cors.origins,
  credentials: true
}));

// Body parsing middleware
// Disable compression for SSE (text/event-stream)
app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type') === 'text/event-stream') {
      return false;
    }
    return compression.filter(req, res);
  }
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// API routes
app.use('/api/stories', storiesRouter);
app.use('/api/characters', charactersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/generate', generateRouter);

// Serve static client files
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// Serve shared files
const sharedPath = path.join(__dirname, '../shared');
app.use('/shared', express.static(sharedPath));

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════╗
║          Úrscéal Server v2.0           ║
╚════════════════════════════════════════╝

Server running at: http://${HOST}:${PORT}
Data directory: ${DATA_ROOT}
Environment: ${process.env.NODE_ENV || 'development'}
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
