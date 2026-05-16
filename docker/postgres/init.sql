-- PostgreSQL initialization script
-- Runs once when the container is first created

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- Fuzzy text search
CREATE EXTENSION IF NOT EXISTS "btree_gin";       -- GIN indexes for composite
CREATE EXTENSION IF NOT EXISTS "unaccent";        -- Accent-insensitive search

-- Create application database if it doesn't exist
SELECT 'CREATE DATABASE rental_platform'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rental_platform');

-- Performance tuning (applied at session level here; set in postgresql.conf for persistence)
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = '100';
ALTER SYSTEM SET random_page_cost = '1.1';
ALTER SYSTEM SET effective_io_concurrency = '200';

SELECT pg_reload_conf();
