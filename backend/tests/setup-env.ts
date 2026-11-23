// Tests always run against the separate test database branch, never the dev data.
import 'dotenv/config'
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.NODE_ENV = 'test'
