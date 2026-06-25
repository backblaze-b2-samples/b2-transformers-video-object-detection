import express from 'express';
import cors from 'cors';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupCORS } from './setup-cors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

const REQUIRED_B2_ENV_VARS = ['B2_ENDPOINT', 'B2_KEY_ID', 'B2_APP_KEY', 'B2_BUCKET'];

function readRequiredB2Config() {
  const missing = REQUIRED_B2_ENV_VARS.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    console.error(
      `Missing required Backblaze B2 environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
    );
    console.error('Copy backend/.env.example to backend/.env and fill in your B2 credentials.');
    process.exit(1);
  }

  return {
    endpoint: process.env.B2_ENDPOINT.trim(),
    region: process.env.B2_REGION?.trim() || 'us-west-002',
    keyId: process.env.B2_KEY_ID.trim(),
    appKey: process.env.B2_APP_KEY.trim(),
    bucket: process.env.B2_BUCKET.trim(),
  };
}

const b2Config = readRequiredB2Config();

const s3Client = new S3Client({
  endpoint: b2Config.endpoint,
  region: b2Config.region,
  credentials: {
    accessKeyId: b2Config.keyId,
    secretAccessKey: b2Config.appKey,
  },
  forcePathStyle: true,
  customUserAgent: "b2ai-transformersjs",
});

const BUCKET = b2Config.bucket;
const URL_EXPIRY = 3600; // 1 hour
const AUTO_SETUP_CORS = process.env.AUTO_SETUP_CORS !== 'false';

// Generate pre-signed PUT URL for snapshot upload
app.post('/api/presign-snapshot', async (req, res) => {
  try {
    const { contentType } = req.body;
    const fileId = randomUUID();
    const key = `snapshots/${fileId}.png`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType || 'image/png',
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: URL_EXPIRY });

    // Generate pre-signed GET URL for reading
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });
    const publicUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: URL_EXPIRY });

    res.json({
      uploadUrl,
      publicUrl,
      key,
      fileId
    });
  } catch (error) {
    console.error('Error generating snapshot presigned URL:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate pre-signed PUT URL for detection results upload
app.post('/api/presign-detections', async (req, res) => {
  try {
    const { fileId } = req.body;
    const key = `detections/${fileId}.json`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: 'application/json',
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: URL_EXPIRY });

    // Generate pre-signed GET URL for reading
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });
    const publicUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: URL_EXPIRY });

    res.json({
      uploadUrl,
      publicUrl,
      key
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

const PORT = process.env.PORT || 3000;

// Auto-setup CORS on startup
async function startServer() {
  if (AUTO_SETUP_CORS) {
    console.log('Checking B2 CORS configuration...');
    try {
      await setupCORS(true);
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

  app.listen(PORT, () => {
    console.log(`\nServer running!`);
    console.log(`\n   Open: http://localhost:${PORT}`);
    console.log(`   API:  http://localhost:${PORT}/api`);
    console.log('\nNext steps:');
    console.log('   1. Visit http://localhost:' + PORT);
    console.log('   2. Allow camera access');
    console.log('   3. Start detecting objects!\n');
    console.log('IMPORTANT: Do NOT open index.html directly!');
    console.log('Use the URL above to avoid CORS issues.\n');
  });
}

startServer();
