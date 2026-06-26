import assert from 'assert/strict';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import test from 'node:test';
import { createB2S3Client, resolveB2Config } from '../b2-config.js';
import { SNAPSHOT_CONTENT_TYPE } from '../signing-security.js';
import { getPresignedReadUrl } from '../storage-urls.js';

function createTestClient() {
  const config = resolveB2Config({
    B2_APPLICATION_KEY_ID: 'sample-key-id',
    B2_APPLICATION_KEY: 'sample-application-key',
    B2_BUCKET_NAME: 'sample-bucket',
    B2_REGION: 'us-west-002',
  });

  return {
    bucket: config.bucketName,
    s3Client: createB2S3Client(config),
  };
}

test('snapshot read URL is presigned and expiring by default', async () => {
  const { bucket, s3Client } = createTestClient();
  const url = await getPresignedReadUrl({
    s3Client,
    bucket,
    key: 'snapshots/test.png',
    expiresIn: 3600,
  });

  assert.match(url, /X-Amz-Expires=3600/);
  assert.match(url, /X-Amz-Signature=/);
  assert.ok(!url.startsWith('https://example.com/file/sample-bucket'));
});

test('detection read URL is presigned instead of a public object URL', async () => {
  const { bucket, s3Client } = createTestClient();
  const url = await getPresignedReadUrl({
    s3Client,
    bucket,
    key: 'detections/test.json',
    expiresIn: 3600,
  });

  assert.match(url, /X-Amz-Expires=3600/);
  assert.match(url, /X-Amz-Signature=/);
  assert.ok(!url.startsWith('https://example.com/file/sample-bucket'));
});

test('snapshot upload URL signs content length for size enforcement', async () => {
  const { bucket, s3Client } = createTestClient();
  const command = new PutObjectCommand({
    Bucket: bucket,
    ContentLength: 1234,
    ContentType: SNAPSHOT_CONTENT_TYPE,
    Key: 'snapshots/test.png',
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  const signedHeaders = new URL(url).searchParams.get('X-Amz-SignedHeaders');

  assert.match(signedHeaders, /content-length/);
});
