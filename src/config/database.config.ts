import { registerAs } from '@nestjs/config';

const poolMin = process.env.DATABASE_POOL_MIN
const poolMax = process.env.DATABASE_POOL_MAX
export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  poolMin: poolMin ? parseInt(poolMin, 10) : 2,
  poolMax: poolMax ? parseInt(poolMax, 10) : 20,
}));
