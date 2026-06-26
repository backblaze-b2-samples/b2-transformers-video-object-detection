import { randomUUID } from 'crypto';

export const SIGNING_SESSION_HEADER = 'x-b2-sample-session';
export const SNAPSHOT_CONTENT_TYPE = 'image/png';
export const DETECTIONS_CONTENT_TYPE = 'application/json';
export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
export const MAX_DETECTIONS_BYTES = 256 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseContentLength(value, maxBytes, label) {
  if (!Number.isInteger(value) || value <= 0) {
    return {
      ok: false,
      status: 400,
      error: `${label} contentLength must be a positive integer`,
    };
  }

  if (value > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `${label} exceeds the ${maxBytes} byte limit`,
    };
  }

  return { ok: true, contentLength: value };
}

function cleanupSigningState(state) {
  const now = state.now();

  for (const [token, session] of state.sessions) {
    if (session.expiresAt <= now) {
      state.sessions.delete(token);
      state.rateLimits.delete(token);
    }
  }

  for (const [fileId, capture] of state.captures) {
    if (capture.expiresAt <= now) {
      state.captures.delete(fileId);
    }
  }
}

export function createSigningState({
  now = () => Date.now(),
  sessionTtlMs = 2 * 60 * 60 * 1000,
  captureTtlMs = 60 * 60 * 1000,
  rateLimitWindowMs = 60 * 1000,
  maxSigningRequests = 30,
} = {}) {
  return {
    captures: new Map(),
    captureTtlMs,
    maxSigningRequests,
    now,
    rateLimitWindowMs,
    rateLimits: new Map(),
    sessions: new Map(),
    sessionTtlMs,
  };
}

export function createSigningSession(state) {
  cleanupSigningState(state);

  const token = randomUUID();
  const expiresAt = state.now() + state.sessionTtlMs;

  state.sessions.set(token, { token, expiresAt });

  return { token, expiresAt };
}

export function getSigningSession(state, token) {
  cleanupSigningState(state);

  if (!token) {
    return { ok: false, status: 401, error: 'Signing session required' };
  }

  const session = state.sessions.get(token);
  if (!session) {
    return { ok: false, status: 401, error: 'Invalid signing session' };
  }

  return { ok: true, session };
}

export function checkSigningRateLimit(state, token) {
  const now = state.now();
  const current = state.rateLimits.get(token);

  if (!current || current.windowExpiresAt <= now) {
    state.rateLimits.set(token, {
      count: 1,
      windowExpiresAt: now + state.rateLimitWindowMs,
    });
    return { ok: true };
  }

  if (current.count >= state.maxSigningRequests) {
    return {
      ok: false,
      status: 429,
      error: 'Too many signing requests',
      retryAfterSeconds: Math.ceil((current.windowExpiresAt - now) / 1000),
    };
  }

  current.count += 1;
  return { ok: true };
}

export function validateSnapshotSigningRequest(body) {
  if (body?.contentType !== SNAPSHOT_CONTENT_TYPE) {
    return {
      ok: false,
      status: 400,
      error: 'Snapshots must use image/png',
    };
  }

  return parseContentLength(body?.contentLength, MAX_SNAPSHOT_BYTES, 'Snapshot');
}

export function registerCapture(state, sessionToken, fileId) {
  cleanupSigningState(state);

  state.captures.set(fileId, {
    detectionsSigned: false,
    expiresAt: state.now() + state.captureTtlMs,
    sessionToken,
  });
}

export function validateDetectionSigningRequest(state, sessionToken, body) {
  if (!UUID_PATTERN.test(body?.fileId || '')) {
    return {
      ok: false,
      status: 400,
      error: 'fileId must be a valid UUID',
    };
  }

  cleanupSigningState(state);

  const capture = state.captures.get(body.fileId);
  if (!capture) {
    return {
      ok: false,
      status: 404,
      error: 'Unknown capture fileId',
    };
  }

  if (capture.sessionToken !== sessionToken) {
    return {
      ok: false,
      status: 403,
      error: 'fileId does not belong to this session',
    };
  }

  if (capture.detectionsSigned) {
    return {
      ok: false,
      status: 409,
      error: 'Detection upload URL was already issued for this fileId',
    };
  }

  const contentLengthResult = parseContentLength(
    body?.contentLength,
    MAX_DETECTIONS_BYTES,
    'Detection metadata',
  );

  if (!contentLengthResult.ok) {
    return contentLengthResult;
  }

  return {
    ok: true,
    contentLength: contentLengthResult.contentLength,
    fileId: body.fileId,
  };
}

export function markDetectionsSigned(state, fileId) {
  const capture = state.captures.get(fileId);

  if (capture) {
    capture.detectionsSigned = true;
  }
}
