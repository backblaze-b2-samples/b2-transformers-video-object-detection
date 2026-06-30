import dotenv from 'dotenv';
import { S3Client } from '@aws-sdk/client-s3';
import { writeSync } from 'node:fs';

dotenv.config();

export const B2_USER_AGENT = 'b2ai-b2-transformers-video-object-detection (backblaze-b2-samples)';
export const REQUIRED_B2_ENV_VARS = [
  'B2_APPLICATION_KEY_ID',
  'B2_APPLICATION_KEY',
  'B2_BUCKET_NAME',
  'B2_REGION',
];

export class B2ConfigError extends Error {
  constructor(missing) {
    super(
      `Missing required Backblaze B2 environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
    );
    this.name = 'B2ConfigError';
    this.missing = missing;
  }
}

function getEnvValue(env, name) {
  return env[name]?.trim() || '';
}

function getB2Endpoint(region) {
  return `https://s3.${region}.backblazeb2.com`;
}

export function resolveB2Config(env = process.env) {
  const applicationKeyId = getEnvValue(env, 'B2_APPLICATION_KEY_ID');
  const applicationKey = getEnvValue(env, 'B2_APPLICATION_KEY');
  const bucketName = getEnvValue(env, 'B2_BUCKET_NAME');
  const region = getEnvValue(env, 'B2_REGION');
  const missingEnvVars = [
    applicationKeyId ? null : 'B2_APPLICATION_KEY_ID',
    applicationKey ? null : 'B2_APPLICATION_KEY',
    bucketName ? null : 'B2_BUCKET_NAME',
    region ? null : 'B2_REGION',
  ].filter(Boolean);

  if (missingEnvVars.length > 0) {
    throw new B2ConfigError(missingEnvVars);
  }

  return {
    bucketName,
    s3ClientConfig: {
      endpoint: getB2Endpoint(region),
      region,
      credentials: {
        accessKeyId: applicationKeyId,
        secretAccessKey: applicationKey,
      },
      forcePathStyle: true,
      customUserAgent: B2_USER_AGENT,
    },
  };
}

export function getB2Config() {
  return resolveB2Config();
}

export function getRequiredB2Config(env = process.env) {
  const config = resolveB2Config(env);

  return {
    endpoint: config.s3ClientConfig.endpoint,
    region: config.s3ClientConfig.region,
    keyId: config.s3ClientConfig.credentials.accessKeyId,
    appKey: config.s3ClientConfig.credentials.secretAccessKey,
    bucket: config.bucketName,
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

export function createB2S3Client(config = getB2Config(), options = {}) {
  if (config.s3ClientConfig) {
    return new S3Client({
      ...config.s3ClientConfig,
      ...options,
    });
  }

  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    customUserAgent: B2_USER_AGENT,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.appKey,
    },
    forcePathStyle: true,
    ...options,
  });
}
