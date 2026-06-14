const { Client } = require('pg');
const config = require('../config.json');

let remoteConfig = {};

async function loadRemoteConfig() {
    try {
        const res = await fetch(config.common_api_url + '/config');
        remoteConfig = await res.json();
    } catch (err) {
        console.error("Failed to load common config:", err);
    }
}

async function bootstrap() {
    const client = new Client({ connectionString: remoteConfig.db_url });
    try {
        await client.connect();
        console.log("Connected to PostgreSQL for Auth Service.");

        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            );
        `);
        console.log("Verified 'users' table exists.");

        // Create saved_filters table
        await client.query(`
            CREATE TABLE IF NOT EXISTS saved_filters (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id),
                name TEXT,
                config JSONB
            );
        `);
        console.log("Verified 'saved_filters' table exists.");

    } catch (err) {
        console.error("Database connection or bootstrap failed:", err);
    } finally {
        await client.end();
    }
}

async function start() {
    await loadRemoteConfig();
    await bootstrap();
    console.log("Auth service starting on port", config.port);
}

start();
