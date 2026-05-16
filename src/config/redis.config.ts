import { registerAs } from '@nestjs/config';

const port = process.env.PORT;
const db = process.env.DATABASE;
const ttl = process.env.TTL;
export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: port ? parseFloat(port) : 6379,
  password: process.env.REDIS_PASSWORD,
  db: db ? parseInt(db, 10) : 0,
  ttl: ttl ? parseInt(ttl, 10) : 3600,
}));
