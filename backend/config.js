const REQUIRED_B2_ENV_VARS = [
  'B2_ENDPOINT',
  'B2_KEY_ID',
  'B2_APP_KEY',
  'B2_BUCKET',
];

function readRequiredEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function validateB2Env(env = process.env) {
  const missing = REQUIRED_B2_ENV_VARS.filter((name) => !readRequiredEnv(env, name));

  if (missing.length > 0) {
    const noun = missing.length === 1 ? 'variable' : 'variables';
    throw new Error(
      `Missing required B2 environment ${noun}: ${missing.join(', ')}. ` +
      'Copy backend/.env.example to backend/.env and set your B2 credentials.'
    );
  }

  return {
    endpoint: readRequiredEnv(env, 'B2_ENDPOINT'),
    region: readRequiredEnv(env, 'B2_REGION') || 'us-west-002',
    keyId: readRequiredEnv(env, 'B2_KEY_ID'),
    appKey: readRequiredEnv(env, 'B2_APP_KEY'),
    bucket: readRequiredEnv(env, 'B2_BUCKET'),
  };
}
