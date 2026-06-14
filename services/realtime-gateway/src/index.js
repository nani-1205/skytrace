const WebSocket = require('ws');
const Redis = require('ioredis');
const config = require('../config.json');

const port = config.port || 8080;
const wss = new WebSocket.Server({ port });
let redis = null;
// In-memory global state
const worldState = new Map();

// Client connection tracking
const clients = new Map();

wss.on('connection', (ws) => {
    // Initialize client state
    clients.set(ws, {
        bbox: null,
        knownAircraft: new Set()
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'subscribe' || data.type === 'viewport') {
                const clientState = clients.get(ws);
                if (clientState) {
                    clientState.bbox = data.bbox; // [w, s, e, n]
                }
            }
        } catch (e) {
            console.error('Invalid message from client', e);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

// Read from feed:state
async function consumeFeed() {
    let lastId = '$';
    while (true) {
        try {
            const messages = await redis.xread('BLOCK', 1000, 'STREAMS', 'feed:state', lastId);
            if (messages) {
                const stream = messages[0];
                const msgs = stream[1];
                for (let i = 0; i < msgs.length; i++) {
                    const msgId = msgs[i][0];
                    const msgData = msgs[i][1];
                    lastId = msgId;

                    // Parse data
                    let rawDataIndex = msgData.indexOf('data');
                    if (rawDataIndex !== -1 && rawDataIndex + 1 < msgData.length) {
                        const payload = JSON.parse(msgData[rawDataIndex + 1]);
                        
                        // Handle removal
                        if (payload.rm) {
                            payload.rm.forEach(id => worldState.delete(id));
                        } else if (Array.isArray(payload)) {
                            // Update global state
                            payload.forEach(ac => {
                                // ac = [icao24, lat, lon, trk, alt, gs, vr]
                                worldState.set(ac[0], ac);
                            });
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Redis Stream error:', err);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

// 1Hz Broadcast loop
async function start() {
    try {
        const res = await fetch(config.common_api_url + '/config');
        const remoteConfig = await res.json();
        redis = new Redis(remoteConfig.redis_url);
        console.log(`Realtime gateway starting on port ${port}`);

        consumeFeed();

        setInterval(() => {
            const now = Date.now();
            
            for (const [ws, state] of clients.entries()) {
                if (!state.bbox) continue;

                const [w, s, e, n] = state.bbox;
                const add = [];
                const upd = [];
                const rm = [];
                
                const currentVisible = new Set();

                for (const [id, ac] of worldState.entries()) {
                    const lat = ac[1];
                    const lon = ac[2];
                    
                    const inView = lon >= w && lon <= e && lat >= s && lat <= n;

                    if (inView) {
                        currentVisible.add(id);
                        if (state.knownAircraft.has(id)) {
                            upd.push(ac);
                        } else {
                            add.push(ac);
                        }
                    }
                }

                for (const id of state.knownAircraft) {
                    if (!currentVisible.has(id)) {
                        rm.push(id);
                    }
                }

                state.knownAircraft = currentVisible;

                if (add.length > 0 || upd.length > 0 || rm.length > 0) {
                    console.log(`Sending to client: ${add.length} add, ${upd.length} upd, ${rm.length} rm. BBOX:`, state.bbox);
                    ws.send(JSON.stringify({
                        type: 'update',
                        t: now,
                        add,
                        upd,
                        rm
                    }));
                }
            }
        }, 1000);
    } catch (err) {
        console.error("Failed to init realtime gateway:", err);
    }
}

start();
