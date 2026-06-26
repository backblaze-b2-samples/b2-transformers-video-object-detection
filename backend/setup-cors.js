import { PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import path from 'path';
import { pathToFileURL } from 'url';
import { createB2S3Client, getB2Config } from './b2-config.js';

const corsRules = {
  CORSRules: [
    {
      AllowedOrigins: ['*'],
      AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag', 'x-amz-request-id', 'x-amz-id-2'],
      MaxAgeSeconds: 3600,
    },
  ],
};

export async function setupCORS(silent = false) {
  let b2Config;

  try {
    b2Config = getB2Config();
  } catch (error) {
    console.error(error.message);
    console.error('Copy .env.example to .env and fill in your B2 credentials.');

    if (silent) {
      throw error;
    }

    process.exit(1);
  }

  const s3Client = createB2S3Client(b2Config);
  const BUCKET = b2Config.bucketName;

  try {
    if (!silent) {
      console.log('Setting up CORS for bucket:', BUCKET);
    }

    // Check existing CORS first
    try {
      const getCommand = new GetBucketCorsCommand({ Bucket: BUCKET });
      const existing = await s3Client.send(getCommand);

      if (existing.CORSRules && existing.CORSRules.length > 0) {
        const hasPUT = existing.CORSRules.some(rule =>
          rule.AllowedMethods && rule.AllowedMethods.includes('PUT')
        );

        if (hasPUT) {
          if (!silent) {
            console.log('CORS already configured correctly!');
            console.log('\nCurrent CORS Configuration:');
            console.log(JSON.stringify(existing.CORSRules, null, 2));
          }
          return true;
        } else {
          if (!silent) {
            console.log('CORS found but missing PUT method, updating...');
            console.log('\nExisting (incomplete) CORS:');
            console.log(JSON.stringify(existing.CORSRules, null, 2));
          }
        }
      }
    } catch (e) {
      if (!silent && e.name !== 'AccessDenied') {
        console.log('No CORS rules found, setting them up...');
      }
    }

    // Apply CORS rules
    const command = new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: corsRules,
    });

    await s3Client.send(command);

    if (!silent) {
      console.log('CORS rules applied successfully!');

      const getCommand = new GetBucketCorsCommand({ Bucket: BUCKET });
      const result = await s3Client.send(getCommand);
      console.log('\nApplied CORS Configuration:');
      console.log(JSON.stringify(result.CORSRules, null, 2));
      console.log('\nSetup complete! You can now upload files from the browser.');
    }

    return true;

  } catch (error) {
    console.error('Error setting CORS:', error.message);

    if (error.Code === 'InvalidRequest' && error.message.includes('B2 Native CORS rules')) {
      console.error('\nYour bucket has B2 Native CORS rules (not S3 Compatible API rules)');
      console.error('\nYou must manually update CORS in B2 Web Console:');
      console.error('1. Go to: https://secure.backblaze.com/b2_buckets.htm');
      console.error('2. Click your bucket > Bucket Settings > CORS Rules');
      console.error('3. DELETE the existing B2 Native rule');
      console.error('4. Add NEW rule for "S3 Compatible API":');
      console.error('   - API: S3 Compatible API');
      console.error('   - Allowed Origins: *');
      console.error('   - Allowed Operations: s3_get, s3_head, s3_put');
      console.error('   - Allowed Headers: *');
      console.error('   - Max Age: 3600');
      console.error('5. Save and try again\n');
    } else if (error.name === 'AccessDenied' || error.Code === 'AccessDenied') {
      console.error('\nYour B2 application key needs additional permissions!');
      console.error('\nRequired permissions:');
      console.error('  - readFiles');
      console.error('  - writeFiles');
      console.error('  - writeBuckets  <- Need this for CORS setup');
      console.error('\nTo fix:');
      console.error('1. Go to https://secure.backblaze.com/app_keys.htm');
      console.error('2. Create a new application key with all permissions above');
      console.error('3. Update B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY in your .env file');
    } else if (error.name === 'NoSuchBucket') {
      console.error(`\nBucket "${BUCKET}" not found!`);
      console.error('Check that B2_BUCKET_NAME in .env matches your bucket name.');
    } else {
      console.error('\nFull error:', error);
    }

    if (!silent) {
      process.exit(1);
    }

    throw error;
  }
}

// Run if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  setupCORS();
}
