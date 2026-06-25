import { S3Client } from '@aws-sdk/client-s3';
import { writeSync } from 'node:fs';

export const REQUIRED_B2_ENV_VARS = ['B2_ENDPOINT', 'B2_KEY_ID', 'B2_APP_KEY', 'B2_BUCKET'];

export class B2ConfigError extends Error {
  constructor(missing) {
    super(
      `Missing required Backblaze B2 environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
    );
    this.name = 'B2ConfigError';
    this.missing = missing;
  }
}

export function getRequiredB2Config(env = process.env) {
  const missing = REQUIRED_B2_ENV_VARS.filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    throw new B2ConfigError(missing);
  }

  return {
    endpoint: env.B2_ENDPOINT.trim(),
    region: env.B2_REGION?.trim() || 'us-west-002',
    keyId: env.B2_KEY_ID.trim(),
    appKey: env.B2_APP_KEY.trim(),
    bucket: env.B2_BUCKET.trim(),
  };
}

export function getRequiredB2ConfigOrExit(env = process.env) {
  try {
    return getRequiredB2Config(env);
  } catch (error) {
    if (!(error instanceof B2ConfigError)) {
      throw error;
    }

    writeSync(
      2,
      `${error.message}\nCopy backend/.env.example to backend/.env and fill in your B2 credentials.\n`
    );
    process.exit(1);
  }
}

export function createB2S3Client(config, options = {}) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.appKey,
    },
    forcePathStyle: true,
    ...options,
  });
}
