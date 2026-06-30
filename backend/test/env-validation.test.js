import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { B2_USER_AGENT, getRequiredB2Config, B2ConfigError } from '../b2-config.js';

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

test('getRequiredB2Config reads standard env names and derives endpoint', () => {
  const config = getRequiredB2Config({
    B2_APPLICATION_KEY_ID: ' test-key-id ',
    B2_APPLICATION_KEY: ' test-app-key ',
    B2_BUCKET_NAME: ' test-bucket ',
    B2_REGION: ' us-west-002 ',
    B2_PUBLIC_URL_BASE: ' https://f000.backblazeb2.com/file/test-bucket ',
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
      B2_APPLICATION_KEY_ID: 'test-key-id',
      B2_APPLICATION_KEY: 'test-app-key',
      B2_REGION: 'us-west-002',
    }),
    (error) => error instanceof B2ConfigError && error.missing.includes('B2_BUCKET_NAME')
  );
});

test('B2 user agent includes the required samples marker', () => {
  assert.equal(B2_USER_AGENT, 'b2ai-b2-transformers-video-object-detection (backblaze-b2-samples)');
});

test('buildServerTestEnv excludes ambient secrets', () => {
  const env = buildServerTestEnv(
    {
      AUTO_SETUP_CORS: 'false',
      B2_APPLICATION_KEY_ID: 'test-key-id',
      B2_APPLICATION_KEY: 'test-app-key',
      B2_REGION: 'us-west-002',
    },
    {
      PATH: '/usr/bin',
      B2_BUCKET_NAME: 'ambient-bucket',
      GITHUB_TOKEN: 'ambient-github-token',
      NPM_TOKEN: 'ambient-npm-token',
      AWS_SECRET_ACCESS_KEY: 'ambient-aws-secret',
    }
  );

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.B2_BUCKET_NAME, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
});

test('server exits with a clear error when B2_BUCKET_NAME is missing', () => {
  const env = buildServerTestEnv({
    AUTO_SETUP_CORS: 'false',
    B2_APPLICATION_KEY_ID: 'test-key-id',
    B2_APPLICATION_KEY: 'test-app-key',
    B2_REGION: 'us-west-002',
  });

  const result = spawnSync(process.execPath, [serverPath], {
    cwd: __dirname,
    encoding: 'utf8',
    env,
    timeout: 5000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required Backblaze B2 environment variable: B2_BUCKET_NAME/);
  assert.match(result.stderr, /backend\/\.env\.example/);
});
