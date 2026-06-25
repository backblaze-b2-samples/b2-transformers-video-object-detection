import assert from 'assert/strict';
import test from 'node:test';
import { createB2S3Client, resolveB2Config } from '../b2-config.js';
import { getPresignedReadUrl } from '../storage-urls.js';

function createTestClient() {
  const config = resolveB2Config({
    B2_APPLICATION_KEY_ID: 'sample-key-id',
    B2_APPLICATION_KEY: 'sample-application-key',
    B2_BUCKET_NAME: 'sample-bucket',
    B2_REGION: 'us-west-002',
    B2_PUBLIC_URL_BASE: 'https://example.com/file/sample-bucket',
  });

  return {
    bucket: config.bucketName,
    publicUrlBase: config.publicUrlBase,
    s3Client: createB2S3Client(config),
  };
}

test('snapshot read URL is presigned and expiring by default', async () => {
  const { bucket, publicUrlBase, s3Client } = createTestClient();
  const url = await getPresignedReadUrl({
    s3Client,
    bucket,
    key: 'snapshots/test.png',
    expiresIn: 3600,
  });

  assert.match(url, /X-Amz-Expires=3600/);
  assert.match(url, /X-Amz-Signature=/);
  assert.ok(!url.startsWith(publicUrlBase));
});

test('detection read URL is presigned instead of a public object URL', async () => {
  const { bucket, publicUrlBase, s3Client } = createTestClient();
  const url = await getPresignedReadUrl({
    s3Client,
    bucket,
    key: 'detections/test.json',
    expiresIn: 3600,
  });

  assert.match(url, /X-Amz-Expires=3600/);
  assert.match(url, /X-Amz-Signature=/);
  assert.ok(!url.startsWith(publicUrlBase));
});
