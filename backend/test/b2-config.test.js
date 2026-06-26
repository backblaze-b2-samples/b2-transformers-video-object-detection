import assert from 'assert/strict';
import test from 'node:test';
import { B2ConfigError, B2_USER_AGENT, resolveB2Config } from '../b2-config.js';

test('resolveB2Config reads standard B2 env names', () => {
  const config = resolveB2Config({
    B2_APPLICATION_KEY_ID: 'new-key-id',
    B2_APPLICATION_KEY: 'new-application-key',
    B2_BUCKET_NAME: 'new-bucket',
    B2_REGION: 'us-east-005',
  });

  assert.equal(config.bucketName, 'new-bucket');
  assert.equal(config.s3ClientConfig.endpoint, 'https://s3.us-east-005.backblazeb2.com');
  assert.equal(config.s3ClientConfig.credentials.accessKeyId, 'new-key-id');
  assert.equal(config.s3ClientConfig.credentials.secretAccessKey, 'new-application-key');
});

test('resolveB2Config reports missing standard B2 env names', () => {
  assert.throws(
    () => resolveB2Config({}),
    (error) => error instanceof B2ConfigError
      && error.missing.includes('B2_APPLICATION_KEY_ID')
      && error.missing.includes('B2_APPLICATION_KEY')
      && error.missing.includes('B2_BUCKET_NAME')
      && error.missing.includes('B2_REGION')
  );
});

test('shared B2 S3 config owns the Backblaze samples user agent', () => {
  const config = resolveB2Config({
    B2_APPLICATION_KEY_ID: 'key-id',
    B2_APPLICATION_KEY: 'application-key',
    B2_BUCKET_NAME: 'bucket',
    B2_REGION: 'eu-central-003',
  });

  assert.equal(config.s3ClientConfig.customUserAgent, B2_USER_AGENT);
  assert.equal(
    config.s3ClientConfig.customUserAgent,
    'b2ai-b2-transformers-video-object-detection (backblaze-b2-samples)'
  );
});

test('public URL base is not part of runtime config when reads are presigned', () => {
  const config = resolveB2Config({
    B2_APPLICATION_KEY_ID: 'key-id',
    B2_APPLICATION_KEY: 'application-key',
    B2_BUCKET_NAME: 'bucket',
    B2_REGION: 'eu-central-003',
    B2_PUBLIC_URL_BASE: 'https://example.com/file/bucket',
  });

  assert.equal('publicUrlBase' in config, false);
});
