const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Client } = require('pg');
const config = require('../config.json');

const app = express();
app.use(cors());

let pgClient;

async function bootstrap() {
    pgClient = new Client({ connectionString: config.db_url });
    try {
        await pgClient.connect();
        console.log("Connected to PostgreSQL for API Gateway.");

        // Create airports table without PostGIS
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS airports (
                icao VARCHAR(4) PRIMARY KEY,
                iata VARCHAR(3),
                name TEXT,
                lat REAL,
                lon REAL,
                country TEXT,
                elevation_ft INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_airports_latlon ON airports (lat, lon);
        `);
        console.log("Verified 'airports' table exists.");

    } catch (err) {
        console.error("Database connection or bootstrap failed:", err);
    }
}

// Reverse Proxies for all Microservices
app.use('/auth', createProxyMiddleware({ 
    target: config.auth_service_url, 
    changeOrigin: true 
}));

app.use('/realtime', createProxyMiddleware({ 
    target: config.realtime_gateway_url, 
    changeOrigin: true,
    ws: true // Enable WebSocket proxying
}));

app.use('/state', createProxyMiddleware({ 
    target: config.state_service_url, 
    changeOrigin: true 
}));

app.use('/enrichment', createProxyMiddleware({ 
    target: config.enrichment_service_url, 
    changeOrigin: true 
}));

app.use('/ingestion', createProxyMiddleware({ 
    target: config.ingestion_service_url, 
    changeOrigin: true 
}));

// Native Endpoints
app.get('/airports', async (req, res) => {
    try {
        const result = await pgClient.query(`
            SELECT icao, iata, name, country, elevation_ft, lon, lat 
            FROM airports
            LIMIT 1000
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/track/:icao24', async (req, res) => {
    try {
        const { icao24 } = req.params;
        const result = await pgClient.query(`
            SELECT lon, lat, altitude_ft 
            FROM track_points 
            WHERE icao24 = $1 
            ORDER BY ts ASC 
            LIMIT 500
        `, [icao24]);
        
        // Return array of [lon, lat, alt]
        const path = result.rows.map(row => [row.lon, row.lat, row.altitude_ft || 0]);
        res.json(path);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/replay', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            return res.status(400).json({ error: "Missing 'from' or 'to' query params" });
        }
        
        // Fetch points between timestamps
        const result = await pgClient.query(`
            SELECT icao24, lat, lon, altitude_ft, ground_speed, track_deg, vertical_rate, EXTRACT(EPOCH FROM ts) as ts_epoch
            FROM track_points 
            WHERE ts >= to_timestamp($1) AND ts <= to_timestamp($2)
            ORDER BY ts ASC
        `, [from, to]);
        
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function start() {
    await bootstrap();
    app.listen(config.port, () => {
        console.log(`API gateway running on port ${config.port}`);
    });
}

start();
