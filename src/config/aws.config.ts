import { registerAs } from '@nestjs/config';

export default registerAs('aws', () => ({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  s3: {
    bucket: process.env.AWS_S3_BUCKET,
    bucketUrl: process.env.AWS_S3_BUCKET_URL,
    cloudfrontUrl: process.env.AWS_CLOUDFRONT_URL,
  },
}));
