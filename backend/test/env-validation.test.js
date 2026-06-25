import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getRequiredB2Config, B2ConfigError } from '../b2-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'server.js');
const CHILD_ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR'];

function buildServerTestEnv(overrides, ambientEnv = process.env) {
  const env = {};

  for (const name of CHILD_ENV_ALLOWLIST) {
    if (ambientEnv[name]) {
      env[name] = ambientEnv[name];
    }
  }

  return {
    ...env,
    ...overrides,
  };
}

test('getRequiredB2Config trims values and defaults region', () => {
  const config = getRequiredB2Config({
    B2_ENDPOINT: ' https://s3.us-west-002.backblazeb2.com ',
    B2_KEY_ID: ' test-key-id ',
    B2_APP_KEY: ' test-app-key ',
    B2_BUCKET: ' test-bucket ',
  });

  assert.deepEqual(config, {
    endpoint: 'https://s3.us-west-002.backblazeb2.com',
    region: 'us-west-002',
    keyId: 'test-key-id',
    appKey: 'test-app-key',
    bucket: 'test-bucket',
  });
});

test('getRequiredB2Config reports missing required B2 values', () => {
  assert.throws(
    () => getRequiredB2Config({
      B2_ENDPOINT: 'https://s3.us-west-002.backblazeb2.com',
      B2_KEY_ID: 'test-key-id',
      B2_APP_KEY: 'test-app-key',
    }),
    (error) => error instanceof B2ConfigError && error.missing.includes('B2_BUCKET')
  );
});

test('buildServerTestEnv excludes ambient secrets', () => {
  const env = buildServerTestEnv(
    {
      AUTO_SETUP_CORS: 'false',
      B2_ENDPOINT: 'https://s3.us-west-002.backblazeb2.com',
      B2_KEY_ID: 'test-key-id',
      B2_APP_KEY: 'test-app-key',
    },
    {
      PATH: '/usr/bin',
      B2_BUCKET: 'ambient-bucket',
      GITHUB_TOKEN: 'ambient-github-token',
      NPM_TOKEN: 'ambient-npm-token',
      AWS_SECRET_ACCESS_KEY: 'ambient-aws-secret',
    }
  );

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.B2_BUCKET, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
});

test('server exits with a clear error when B2_BUCKET is missing', () => {
  const env = buildServerTestEnv({
    AUTO_SETUP_CORS: 'false',
    B2_ENDPOINT: 'https://s3.us-west-002.backblazeb2.com',
    B2_KEY_ID: 'test-key-id',
    B2_APP_KEY: 'test-app-key',
  });

  const result = spawnSync(process.execPath, [serverPath], {
    cwd: __dirname,
    encoding: 'utf8',
    env,
    timeout: 5000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required Backblaze B2 environment variable: B2_BUCKET/);
  assert.match(result.stderr, /backend\/\.env\.example/);
});
