import assert from 'node:assert/strict';
import test from 'node:test';
import { validateB2Env } from './config.js';

const completeEnv = {
  B2_ENDPOINT: ' https://s3.us-west-002.backblazeb2.com ',
  B2_KEY_ID: ' key-id ',
  B2_APP_KEY: ' app-key ',
  B2_BUCKET: ' sample-bucket ',
};

test('validateB2Env reports missing B2_BUCKET clearly', () => {
  assert.throws(
    () => validateB2Env({
      B2_ENDPOINT: completeEnv.B2_ENDPOINT,
      B2_KEY_ID: completeEnv.B2_KEY_ID,
      B2_APP_KEY: completeEnv.B2_APP_KEY,
    }),
    /Missing required B2 environment variable: B2_BUCKET/
  );
});

test('validateB2Env returns trimmed values and default region', () => {
  assert.deepEqual(validateB2Env(completeEnv), {
    endpoint: 'https://s3.us-west-002.backblazeb2.com',
    region: 'us-west-002',
    keyId: 'key-id',
    appKey: 'app-key',
    bucket: 'sample-bucket',
  });
});

test('validateB2Env uses the configured region when provided', () => {
  const config = validateB2Env({
    ...completeEnv,
    B2_REGION: ' eu-central-003 ',
  });

  assert.equal(config.region, 'eu-central-003');
});
