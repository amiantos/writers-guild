import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import storiesRouter from '../stories.js';

describe('Avatar Windows API Routes', () => {
  let app;
  let tempDir;
  let storyId;

  beforeEach(async () => {
    // Create temp directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-windows-test-'));

    // Create Express app with the router
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/stories', storiesRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });

    // Create a test story
    const response = await request(app)
      .post('/api/stories')
      .send({ title: 'Test Story', description: 'A test story' })
      .expect(201);

    storyId = response.body.story.id;
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('PUT /:id/avatar-windows', () => {
    const validWindow = {
      id: 'avatar-123',
      characterId: 'char-456',
      x: 100,
      y: 200,
      width: 300,
      height: 400
    };

    it('should save valid avatar windows', async () => {
      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows: [validWindow] })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should save empty array', async () => {
      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows: [] })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should save multiple windows', async () => {
      const windows = [
        validWindow,
        { ...validWindow, id: 'avatar-789', x: 150, y: 250 }
      ];

      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows: windows })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should persist windows across requests', async () => {
      // Save windows
      await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows: [validWindow] })
        .expect(200);

      // Get story and verify windows are saved
      const response = await request(app)
        .get(`/api/stories/${storyId}`)
        .expect(200);

      expect(response.body.story.avatarWindows).toHaveLength(1);
      expect(response.body.story.avatarWindows[0].id).toBe('avatar-123');
    });

    describe('Validation', () => {
      it('should reject non-array avatarWindows', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: 'not an array' })
          .expect(400);

        expect(response.body.error).toContain('must be an array');
      });

      it('should reject null avatarWindows', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: null })
          .expect(400);

        expect(response.body.error).toContain('must be an array');
      });

      it('should reject non-object window elements', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: ['not an object'] })
          .expect(400);

        expect(response.body.error).toContain('must be an object');
      });

      it('should reject window missing id', async () => {
        const { id, ...windowWithoutId } = validWindow;
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [windowWithoutId] })
          .expect(400);

        expect(response.body.error).toContain("missing required property 'id'");
      });

      it('should reject window missing characterId', async () => {
        const { characterId, ...windowWithoutCharId } = validWindow;
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [windowWithoutCharId] })
          .expect(400);

        expect(response.body.error).toContain("missing required property 'characterId'");
      });

      it('should reject window missing x', async () => {
        const { x, ...windowWithoutX } = validWindow;
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [windowWithoutX] })
          .expect(400);

        expect(response.body.error).toContain("missing required property 'x'");
      });

      it('should reject non-string id', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, id: 123 }] })
          .expect(400);

        expect(response.body.error).toContain('id must be a string');
      });

      it('should reject non-string characterId', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, characterId: 456 }] })
          .expect(400);

        expect(response.body.error).toContain('characterId must be a string');
      });

      it('should reject non-number x', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, x: '100' }] })
          .expect(400);

        expect(response.body.error).toContain('x must be a finite number');
      });

      it('should reject NaN values', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, width: NaN }] })
          .expect(400);

        expect(response.body.error).toContain('width must be a finite number');
      });

      it('should reject Infinity values', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, height: Infinity }] })
          .expect(400);

        expect(response.body.error).toContain('height must be a finite number');
      });

      it('should reject negative width', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, width: -100 }] })
          .expect(400);

        expect(response.body.error).toContain('width must be a positive number');
      });

      it('should reject zero width', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, width: 0 }] })
          .expect(400);

        expect(response.body.error).toContain('width must be a positive number');
      });

      it('should reject negative height', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, height: -50 }] })
          .expect(400);

        expect(response.body.error).toContain('height must be a positive number');
      });

      it('should reject x coordinate out of range', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, x: 15000 }] })
          .expect(400);

        expect(response.body.error).toContain('x must be between');
      });

      it('should reject y coordinate out of range', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, y: -15000 }] })
          .expect(400);

        expect(response.body.error).toContain('y must be between');
      });

      it('should accept boundary x values', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, x: -10000, y: 10000 }] })
          .expect(200);

        expect(response.body.success).toBe(true);
      });

      it('should report correct index for invalid window in array', async () => {
        const windows = [
          validWindow,
          { ...validWindow, id: 'second', width: -100 }
        ];

        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: windows })
          .expect(400);

        expect(response.body.error).toContain('avatarWindows[1]');
      });

      it('should reject width exceeding maximum', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, width: 6000 }] })
          .expect(400);

        expect(response.body.error).toContain('width must not exceed 5000');
      });

      it('should reject height exceeding maximum', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, height: 10000 }] })
          .expect(400);

        expect(response.body.error).toContain('height must not exceed 5000');
      });

      it('should accept maximum valid dimensions', async () => {
        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: [{ ...validWindow, width: 5000, height: 5000 }] })
          .expect(200);

        expect(response.body.success).toBe(true);
      });

      it('should reject too many avatar windows', async () => {
        const windows = Array.from({ length: 21 }, (_, i) => ({
          ...validWindow,
          id: `avatar-${i}`
        }));

        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: windows })
          .expect(400);

        expect(response.body.error).toContain('maximum of 20 avatar windows');
      });

      it('should accept exactly 20 avatar windows', async () => {
        const windows = Array.from({ length: 20 }, (_, i) => ({
          ...validWindow,
          id: `avatar-${i}`
        }));

        const response = await request(app)
          .put(`/api/stories/${storyId}/avatar-windows`)
          .send({ avatarWindows: windows })
          .expect(200);

        expect(response.body.success).toBe(true);
      });
    });

    it('should return error for non-existent story', async () => {
      const response = await request(app)
        .put('/api/stories/non-existent-id/avatar-windows')
        .send({ avatarWindows: [validWindow] })
        .expect(500);

      expect(response.body.error).toContain('Story not found');
    });
  });
});
