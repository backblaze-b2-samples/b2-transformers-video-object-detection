import assert from 'assert/strict';
import test from 'node:test';
import {
  checkSigningRateLimit,
  createSigningSession,
  createSigningState,
} from '../signing-security.js';

test('cleanup removes expired rate limits for session creation keys', () => {
  let now = 1000;
  const state = createSigningState({
    now: () => now,
    rateLimitWindowMs: 10,
  });

  checkSigningRateLimit(state, 'session:127.0.0.1');
  assert.equal(state.rateLimits.size, 1);

  now += 11;
  createSigningSession(state);

  assert.equal(state.rateLimits.size, 0);
});
