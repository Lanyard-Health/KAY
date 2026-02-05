// Safe environment defaults for test runs
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test_db';
process.env['ENCRYPTION_KEY'] = 'a'.repeat(64); // 32-byte hex key for tests
process.env['JWT_SECRET'] = 'test-jwt-secret';
process.env['DEV_AUTH_BYPASS'] = 'false';
process.env['LOG_LEVEL'] = 'silent';
