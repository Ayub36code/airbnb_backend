import { Injectable, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // ── Basic Cache Operations
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (err) {
      this.logger.error(`Redis GET error for key ${key}:`, err);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (err) {
      this.logger.error(`Redis SET error for key ${key}:`, err);
    }
  }

  async del(key: string | string[]): Promise<void> {
    try {
      if (Array.isArray(key)) {
        await this.redis.del(...key);
      } else {
        await this.redis.del(key);
      }
    } catch (err) {
      this.logger.error(`Redis DEL error:`, err);
    }
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  // ── Pattern Deletion ──────────────────────────────
  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (err) {
      this.logger.error(`Redis DEL pattern error for ${pattern}:`, err);
    }
  }

  // ── Distributed Lock
  async acquireLock(
    lockKey: string,
    ttlSeconds: number = 30,
    retries: number = 3,
    retryDelayMs: number = 100,
  ): Promise<string | null> {
    const lockValue = `${Date.now()}-${Math.random()}`;
    const key = `lock:${lockKey}`;

    for (let i = 0; i < retries; i++) {
      const result = await this.redis.set(key, lockValue, 'EX', ttlSeconds, 'NX');
      if (result === 'OK') return lockValue;
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (i + 1)));
      }
    }
    return null;
  }

  async releaseLock(lockKey: string, lockValue: string): Promise<boolean> {
    const key = `lock:${lockKey}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await (this.redis as any).eval(script, 1, key, lockValue);
    return result === 1;
  }

  // ── Rate Limiting
  async rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const redisKey = `rate:${key}`;
    const pipeline = this.redis.pipeline();
    pipeline.incr(redisKey);
    pipeline.ttl(redisKey);
    const results = await pipeline.exec();
    if (!results) {throw new Error('no results found');}
    const count = results[0][1] as number;
    let ttl = results[1][1] as number;

    if (count === 1) {
      await this.redis.expire(redisKey, windowSeconds);
      ttl = windowSeconds;
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetIn: ttl,
    };
  }

  // ── Counters
  async increment(key: string, by: number = 1): Promise<number> {
    return this.redis.incrby(key, by);
  }

  async decrement(key: string, by: number = 1): Promise<number> {
    return this.redis.decrby(key, by);
  }

  // ── Pub/Sub
  async publish(channel: string, message: any): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(message));
  }

  // ── Hash Operations
  async hset(key: string, field: string, value: any): Promise<void> {
    await this.redis.hset(key, field, JSON.stringify(value));
  }

  async hget<T>(key: string, field: string): Promise<T | null> {
    const value = await this.redis.hget(key, field);
    return value ? JSON.parse(value) : null;
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.redis.hdel(key, field);
  }

  async hgetall<T>(key: string): Promise<Record<string, T>> {
    const data = await this.redis.hgetall(key);
    const result: Record<string, T> = {};
    for (const [k, v] of Object.entries(data)) {
      result[k] = JSON.parse(v);
    }
    return result;
  }

  // ── Set Operations (e.g. online users)
  async sadd(key: string, ...members: string[]): Promise<void> {
    await this.redis.sadd(key, ...members);
  }

  async srem(key: string, member: string): Promise<void> {
    await this.redis.srem(key, member);
  }

  async smembers(key: string): Promise<string[]> {
    return this.redis.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.redis.sismember(key, member);
    return result === 1;
  }

  // ── Session Management
  async setSession(userId: string, sessionData: any, ttlSeconds: number = 604800): Promise<void> {
    await this.set(`session:${userId}`, sessionData, ttlSeconds);
  }

  async getSession<T>(userId: string): Promise<T | null> {
    return this.get<T>(`session:${userId}`);
  }

  async deleteSession(userId: string): Promise<void> {
    await this.del(`session:${userId}`);
  }

  // ── Cache Aside Helper
  async cacheAside<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = 3600,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const data = await fetchFn();
    await this.set(key, data, ttlSeconds);
    return data;
  }

  // ── Health Check
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
