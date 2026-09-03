import assert from 'assert/strict';
import { createServer } from 'http';
import { once } from 'events';
import test from 'node:test';
import { createApp, resolveTrustProxy } from '../server.js';
import {
  DETECTIONS_CONTENT_TYPE,
  MAX_SNAPSHOT_BYTES,
  SIGNING_SESSION_HEADER,
  SNAPSHOT_CONTENT_TYPE,
  createSigningState,
  createSigningSession,
  registerCapture,
} from '../signing-security.js';

function createTestApp(options = {}) {
  const signedPuts = [];
  const signingState = createSigningState({
    maxSigningRequests: options.maxSigningRequests || 30,
  });

  const app = createApp({
    b2Config: { bucketName: 'test-bucket' },
    s3Client: {},
    signingState,
    signPutUrl: async (command) => {
      signedPuts.push(command.input);
      return `https://upload.example/${command.input.Key}`;
    },
    signReadUrl: async ({ key }) => `https://read.example/${key}`,
    trustProxy: options.trustProxy,
  });

  return { app, signedPuts, signingState };
}

async function withServer(app, callback) {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function createSession(baseUrl) {
  const response = await fetch(`${baseUrl}/api/session`, { method: 'POST' });
  assert.equal(response.status, 200);
  return response.json();
}

function postJson(baseUrl, path, body, session, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };

  if (session) {
    headers[SIGNING_SESSION_HEADER] = session.token;
  }

  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('snapshot signing rejects unauthenticated requests', async () => {
  const { app } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    });

    assert.equal(response.status, 401);
  });
});

test('snapshot signing rejects disallowed content types', async () => {
  const { app } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const session = await createSession(baseUrl);
    const response = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: 'text/html',
    }, session);

    assert.equal(response.status, 400);
  });
});

test('snapshot signing rejects oversized uploads and signs valid sizes', async () => {
  const { app, signedPuts } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const session = await createSession(baseUrl);
    const oversized = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: MAX_SNAPSHOT_BYTES + 1,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, session);

    assert.equal(oversized.status, 413);

    const valid = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 2048,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, session);
    const body = await valid.json();

    assert.equal(valid.status, 200);
    assert.match(body.fileId, /^[0-9a-f-]{36}$/i);
    assert.equal(signedPuts[0].ContentLength, 2048);
    assert.equal(signedPuts[0].ContentType, SNAPSHOT_CONTENT_TYPE);
  });
});

test('signing requests are rate limited per session', async () => {
  const { app } = createTestApp({ maxSigningRequests: 1 });

  await withServer(app, async (baseUrl) => {
    const session = await createSession(baseUrl);
    const first = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, session);
    const second = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, session);

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  });
});

test('snapshot presign requests are rate limited by client address', async () => {
  const { app, signingState } = createTestApp({ maxSigningRequests: 1 });
  const sessionA = createSigningSession(signingState);
  const sessionB = createSigningSession(signingState);

  await withServer(app, async (baseUrl) => {
    const first = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, sessionA);

    const second = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, sessionB);

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  });
});

test('snapshot presign can rate limit forwarded client addresses', async () => {
  const { app, signingState } = createTestApp({ maxSigningRequests: 1, trustProxy: 1 });
  const sessionA = createSigningSession(signingState);
  const sessionB = createSigningSession(signingState);

  await withServer(app, async (baseUrl) => {
    const first = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, sessionA, { 'X-Forwarded-For': '203.0.113.10' });

    const second = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, sessionB, { 'X-Forwarded-For': '203.0.113.11' });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
  });
});

test('session creation is rate limited by client address', async () => {
  const { app } = createTestApp({ maxSigningRequests: 1 });

  await withServer(app, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/session`, { method: 'POST' });
    const second = await fetch(`${baseUrl}/api/session`, { method: 'POST' });

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  });
});

test('detection presign requests are rate limited by client address', async () => {
  const fileIdA = '123e4567-e89b-42d3-a456-426614174000';
  const fileIdB = '123e4567-e89b-42d3-a456-426614174001';
  const { app, signingState } = createTestApp({ maxSigningRequests: 1 });
  const sessionA = createSigningSession(signingState);
  const sessionB = createSigningSession(signingState);

  registerCapture(signingState, sessionA.token, fileIdA);
  registerCapture(signingState, sessionB.token, fileIdB);

  await withServer(app, async (baseUrl) => {
    const first = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId: fileIdA,
    }, sessionA);
    const second = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId: fileIdB,
    }, sessionB);

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  });
});

test('detection presign can rate limit forwarded client addresses', async () => {
  const fileIdA = '123e4567-e89b-42d3-a456-426614174002';
  const fileIdB = '123e4567-e89b-42d3-a456-426614174003';
  const { app, signingState } = createTestApp({ maxSigningRequests: 1, trustProxy: 1 });
  const sessionA = createSigningSession(signingState);
  const sessionB = createSigningSession(signingState);

  registerCapture(signingState, sessionA.token, fileIdA);
  registerCapture(signingState, sessionB.token, fileIdB);

  await withServer(app, async (baseUrl) => {
    const first = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId: fileIdA,
    }, sessionA, { 'X-Forwarded-For': '203.0.113.10' });
    const second = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId: fileIdB,
    }, sessionB, { 'X-Forwarded-For': '203.0.113.11' });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
  });
});

test('resolveTrustProxy preserves Express trust proxy values', () => {
  assert.equal(resolveTrustProxy(undefined), false);
  assert.equal(resolveTrustProxy(''), false);
  assert.equal(resolveTrustProxy('true'), true);
  assert.equal(resolveTrustProxy('false'), false);
  assert.equal(resolveTrustProxy('1'), 1);
  assert.equal(resolveTrustProxy('loopback'), 'loopback');
});

test('detection signing rejects malformed and cross-session file IDs', async () => {
  const { app } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const sessionA = await createSession(baseUrl);
    const sessionB = await createSession(baseUrl);
    const malformed = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId: '../bad',
    }, sessionA);

    assert.equal(malformed.status, 400);

    const snapshot = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, sessionA);
    const { fileId } = await snapshot.json();

    const crossSession = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId,
    }, sessionB);

    assert.equal(crossSession.status, 403);
  });
});

test('detection signing rejects unknown and already-used file IDs', async () => {
  const { app, signedPuts } = createTestApp();

  await withServer(app, async (baseUrl) => {
    const session = await createSession(baseUrl);
    const unknown = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId: '123e4567-e89b-12d3-a456-426614174000',
    }, session);

    assert.equal(unknown.status, 404);

    const snapshot = await postJson(baseUrl, '/api/presign-snapshot', {
      contentLength: 1024,
      contentType: SNAPSHOT_CONTENT_TYPE,
    }, session);
    const { fileId } = await snapshot.json();

    const first = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId,
    }, session);
    const second = await postJson(baseUrl, '/api/presign-detections', {
      contentLength: 512,
      fileId,
    }, session);

    assert.equal(first.status, 200);
    assert.equal(second.status, 409);
    assert.equal(signedPuts[1].ContentLength, 512);
    assert.equal(signedPuts[1].ContentType, DETECTIONS_CONTENT_TYPE);
  });
});
