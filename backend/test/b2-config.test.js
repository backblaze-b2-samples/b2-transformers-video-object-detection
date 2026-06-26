import assert from 'assert/strict';
import test from 'node:test';
import { B2_USER_AGENT, resolveB2Config } from '../b2-config.js';

test('new B2 env names take precedence over legacy aliases', () => {
  const config = resolveB2Config({
    B2_APPLICATION_KEY_ID: 'new-key-id',
    B2_APPLICATION_KEY: 'new-application-key',
    B2_BUCKET_NAME: 'new-bucket',
    B2_REGION: 'us-east-005',
    B2_KEY_ID: 'legacy-key-id',
    B2_APP_KEY: 'legacy-application-key',
    B2_BUCKET: 'legacy-bucket',
    B2_ENDPOINT: 'https://s3.us-west-002.backblazeb2.com',
  });

  assert.equal(config.bucketName, 'new-bucket');
  assert.equal(config.s3ClientConfig.endpoint, 'https://s3.us-east-005.backblazeb2.com');
  assert.equal(config.s3ClientConfig.credentials.accessKeyId, 'new-key-id');
  assert.equal(config.s3ClientConfig.credentials.secretAccessKey, 'new-application-key');
});

test('legacy B2 env names are accepted during rolling deploys', () => {
  const config = resolveB2Config({
    B2_KEY_ID: 'legacy-key-id',
    B2_APP_KEY: 'legacy-application-key',
    B2_BUCKET: 'legacy-bucket',
    B2_ENDPOINT: 'https://s3.us-west-002.backblazeb2.com',
  });

  assert.equal(config.bucketName, 'legacy-bucket');
  assert.equal(config.s3ClientConfig.endpoint, 'https://s3.us-west-002.backblazeb2.com');
  assert.equal(config.s3ClientConfig.region, 'us-west-002');
  assert.equal(config.s3ClientConfig.credentials.accessKeyId, 'legacy-key-id');
  assert.equal(config.s3ClientConfig.credentials.secretAccessKey, 'legacy-application-key');
});

test('shared B2 S3 config owns the Backblaze samples user agent', () => {
  const config = resolveB2Config({
    B2_APPLICATION_KEY_ID: 'key-id',
    B2_APPLICATION_KEY: 'application-key',
    B2_BUCKET_NAME: 'bucket',
    B2_REGION: 'eu-central-003',
  });

  assert.equal(config.s3ClientConfig.customUserAgent, B2_USER_AGENT);
  assert.equal(config.s3ClientConfig.customUserAgent, 'b2ai-b2-transformers-video-object-detection');
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
