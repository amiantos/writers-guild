import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import charactersRouter from '../characters.js';

describe('character versions routes', () => {
  let app;
  let tempDir;

  // The router keeps the storage it opens first, so every case shares one data directory.
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'character-versions-routes-'));
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/characters', charactersRouter);
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || 500).json({ error: err.message });
    });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function createCharacter() {
    const response = await request(app)
      .post('/api/characters')
      .send({ name: 'Ada', description: 'An inventor.' })
      .expect(201);
    return response.body.id;
  }

  it('lists no versions for an untouched character', async () => {
    const id = await createCharacter();
    const response = await request(app).get(`/api/characters/${id}/versions`).expect(200);
    expect(response.body).toEqual({ versions: [], editedSinceImport: false });
  });

  it('lists each edit and restores an earlier version', async () => {
    const id = await createCharacter();
    await request(app)
      .put(`/api/characters/${id}`)
      .send({ description: 'A famous inventor.' })
      .expect(200);

    let response = await request(app).get(`/api/characters/${id}/versions`).expect(200);
    expect(response.body.editedSinceImport).toBe(true);
    const [original, edit] = response.body.versions;
    expect(original.source).toBe('original');
    expect(edit).toMatchObject({ source: 'edit', changed: ['description'] });

    response = await request(app)
      .post(`/api/characters/${id}/versions/${original.id}/restore`)
      .expect(200);
    expect(response.body.character.data.description).toBe('An inventor.');

    response = await request(app).get(`/api/characters/${id}/versions`).expect(200);
    expect(response.body.editedSinceImport).toBe(false);
    expect(response.body.versions.map((v) => v.source)).toEqual(['original', 'edit', 'restore']);
  });

  it('404s for a missing character or version', async () => {
    await request(app).get('/api/characters/nope/versions').expect(404);
    const id = await createCharacter();
    await request(app).post(`/api/characters/${id}/versions/999/restore`).expect(404);
    await request(app).post(`/api/characters/${id}/versions/abc/restore`).expect(404);
  });
});
