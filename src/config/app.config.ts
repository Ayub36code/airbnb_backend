import { registerAs } from '@nestjs/config';

const port = process.env.PORT;
export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: port ? parseInt(port, 10) : 3000,
  name: process.env.APP_NAME || 'RentalPlatform',
  url: process.env.APP_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },
  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
  },
}));
