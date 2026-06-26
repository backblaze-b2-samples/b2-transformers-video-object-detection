import express from 'express';
import cors from 'cors';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { setupCORS } from './setup-cors.js';
import { createB2S3Client, getB2Config } from './b2-config.js';
import { getPresignedReadUrl } from './storage-urls.js';
import {
  DETECTIONS_CONTENT_TYPE,
  MAX_DETECTIONS_BYTES,
  MAX_SNAPSHOT_BYTES,
  SIGNING_SESSION_HEADER,
  SNAPSHOT_CONTENT_TYPE,
  checkSigningRateLimit,
  createSigningSession,
  createSigningState,
  getSigningSession,
  markDetectionsSigned,
  registerCapture,
  validateDetectionSigningRequest,
  validateSnapshotSigningRequest,
} from './signing-security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const URL_EXPIRY = 3600; // 1 hour

function reject(res, result) {
  if (result.retryAfterSeconds) {
    res.set('Retry-After', String(result.retryAfterSeconds));
  }

  return res.status(result.status).json({ error: result.error });
}

function authorizeSigningRequest(req, res, signingState) {
  const token = req.get(SIGNING_SESSION_HEADER);
  const sessionResult = getSigningSession(signingState, token);

  if (!sessionResult.ok) {
    reject(res, sessionResult);
    return undefined;
  }

  const rateLimitResult = checkSigningRateLimit(signingState, token);

  if (!rateLimitResult.ok) {
    reject(res, rateLimitResult);
    return undefined;
  }

  return token;
}

export function createApp({
  b2Config = getB2Config(),
  s3Client = createB2S3Client(b2Config),
  signingState = createSigningState(),
  signPutUrl = (command) => getSignedUrl(s3Client, command, { expiresIn: URL_EXPIRY }),
  signReadUrl = ({ key }) => getPresignedReadUrl({
    s3Client,
    bucket: b2Config.bucketName,
    key,
    expiresIn: URL_EXPIRY,
  }),
} = {}) {
  const app = express();
  const BUCKET = b2Config.bucketName;

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Serve frontend files
  app.use(express.static(path.join(__dirname, '../frontend')));

  app.post('/api/session', (req, res) => {
    const rateLimitResult = checkSigningRateLimit(signingState, `session:${req.ip}`);
    if (!rateLimitResult.ok) {
      reject(res, rateLimitResult);
      return;
    }

    const session = createSigningSession(signingState);
    res.json({
      expiresAt: new Date(session.expiresAt).toISOString(),
      header: SIGNING_SESSION_HEADER,
      maxDetectionsBytes: MAX_DETECTIONS_BYTES,
      maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
      token: session.token,
    });
  });

  // Generate pre-signed PUT URL for snapshot upload
  app.post('/api/presign-snapshot', async (req, res) => {
    const sessionToken = authorizeSigningRequest(req, res, signingState);
    if (!sessionToken) {
      return;
    }

    const validation = validateSnapshotSigningRequest(req.body);
    if (!validation.ok) {
      reject(res, validation);
      return;
    }

    try {
      const fileId = randomUUID();
      const key = `snapshots/${fileId}.png`;

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        ContentLength: validation.contentLength,
        ContentType: SNAPSHOT_CONTENT_TYPE,
        Key: key,
      });

      const uploadUrl = await signPutUrl(command);
      const readUrl = await signReadUrl({ key });

      registerCapture(signingState, sessionToken, fileId);

      res.json({
        uploadUrl,
        publicUrl: readUrl,
        key,
        fileId,
      });
    } catch (error) {
      console.error('Error generating snapshot presigned URL:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Generate pre-signed PUT URL for detection results upload
  app.post('/api/presign-detections', async (req, res) => {
    const sessionToken = authorizeSigningRequest(req, res, signingState);
    if (!sessionToken) {
      return;
    }

    const validation = validateDetectionSigningRequest(signingState, sessionToken, req.body);
    if (!validation.ok) {
      reject(res, validation);
      return;
    }

    try {
      const key = `detections/${validation.fileId}.json`;

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        ContentLength: validation.contentLength,
        ContentType: DETECTIONS_CONTENT_TYPE,
        Key: key,
      });

      const uploadUrl = await signPutUrl(command);
      const readUrl = await signReadUrl({ key });

      markDetectionsSigned(signingState, validation.fileId);

      res.json({
        uploadUrl,
        publicUrl: readUrl,
        key,
      });
    } catch (error) {
      console.error('Error generating detections presigned URL:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

export async function startServer({
  app = createApp(),
  autoSetupCors = process.env.AUTO_SETUP_CORS !== 'false',
  port = process.env.PORT || 3000,
  setupCors = setupCORS,
} = {}) {
  if (autoSetupCors) {
    console.log('Checking B2 CORS configuration...');
    try {
      await setupCors(true);
      console.log('B2 CORS is configured');
    } catch (error) {
      if (error.Code === 'InvalidRequest' && error.message.includes('B2 Native CORS rules')) {
        console.warn('\nYour bucket has B2 Native CORS rules (not S3 API rules)');
        console.warn('You need to manually update CORS in B2 Web Console:\n');
        console.warn('1. Go to: https://secure.backblaze.com/b2_buckets.htm');
        console.warn('2. Click on your bucket > Bucket Settings');
        console.warn('3. Find CORS Rules section');
        console.warn('4. DELETE the existing B2 Native rule');
        console.warn('5. Add NEW rule for "S3 Compatible API":');
        console.warn('   - Allowed Origins: *');
        console.warn('   - Allowed Operations: s3_get, s3_head, s3_put');
        console.warn('   - Allowed Headers: *');
        console.warn('   - Max Age: 3600');
        console.warn('6. Save and restart this server\n');
      } else {
        console.warn('Could not verify/setup CORS automatically');
        console.warn('Error:', error.message);
      }
    }
  }

  app.listen(port, () => {
    console.log(`\nServer running!`);
    console.log(`\n   Open: http://localhost:${port}`);
    console.log(`   API:  http://localhost:${port}/api`);
    console.log('\nNext steps:');
    console.log('   1. Visit http://localhost:' + port);
    console.log('   2. Allow camera access');
    console.log('   3. Start detecting objects!\n');
    console.log('IMPORTANT: Do NOT open index.html directly!');
    console.log('Use the URL above to avoid CORS issues.\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer();
}
