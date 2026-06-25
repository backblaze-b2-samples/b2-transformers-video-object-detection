import { S3Client } from '@aws-sdk/client-s3';
import { writeSync } from 'node:fs';

export const B2_USER_AGENT = 'b2ai-transformersjs (backblaze-b2-samples)';
export const REQUIRED_B2_ENV_VARS = [
  'B2_APPLICATION_KEY_ID',
  'B2_APPLICATION_KEY',
  'B2_BUCKET_NAME',
  'B2_REGION',
];

const DEPRECATED_B2_ENV_FALLBACKS = {
  B2_APPLICATION_KEY_ID: 'B2_KEY_ID',
  B2_APPLICATION_KEY: 'B2_APP_KEY',
  B2_BUCKET_NAME: 'B2_BUCKET',
};

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

function getEnvValueWithDeprecatedFallback(env, name) {
  return getEnvValue(env, name) || getEnvValue(env, DEPRECATED_B2_ENV_FALLBACKS[name]);
}

function getRegionFromDeprecatedEndpoint(env) {
  const endpoint = getEnvValue(env, 'B2_ENDPOINT');
  const match = endpoint.match(/^https?:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com\/?$/i);

  return match?.[1] || '';
}

function getB2Endpoint(region) {
  return `https://s3.${region}.backblazeb2.com`;
}

export function getRequiredB2Config(env = process.env) {
  const keyId = getEnvValueWithDeprecatedFallback(env, 'B2_APPLICATION_KEY_ID');
  const appKey = getEnvValueWithDeprecatedFallback(env, 'B2_APPLICATION_KEY');
  const bucket = getEnvValueWithDeprecatedFallback(env, 'B2_BUCKET_NAME');
  const region = getEnvValue(env, 'B2_REGION') || getRegionFromDeprecatedEndpoint(env);
  const publicUrlBase = getEnvValue(env, 'B2_PUBLIC_URL_BASE');
  const missing = [
    keyId ? null : 'B2_APPLICATION_KEY_ID',
    appKey ? null : 'B2_APPLICATION_KEY',
    bucket ? null : 'B2_BUCKET_NAME',
    region ? null : 'B2_REGION',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new B2ConfigError(missing);
  }

  return {
    endpoint: getB2Endpoint(region),
    region,
    keyId,
    appKey,
    bucket,
    ...(publicUrlBase ? { publicUrlBase } : {}),
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
    customUserAgent: B2_USER_AGENT,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.appKey,
    },
    forcePathStyle: true,
    ...options,
  });
}
