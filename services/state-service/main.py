import asyncio
import json
import time
import asyncpg
import redis.asyncio as redis

import urllib.request

with open("config.json", "r") as f:
    config = json.load(f)

common_api_url = config["common_api_url"]
try:
    with urllib.request.urlopen(f"{common_api_url}/config") as response:
        remote_config = json.loads(response.read().decode())
        DB_URL = remote_config.get("db_url")
        REDIS_URL = remote_config.get("redis_url")
except Exception as e:
    print(f"Failed to load remote config: {e}")
    raise e
STALE_SWEEP_MS = config.get("stale_sweep_ms", 60000)

async def bootstrap():
    try:
        conn = await asyncpg.connect(DB_URL)
        print("Connected to PostgreSQL for State Service.")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS flights (
                id BIGSERIAL PRIMARY KEY,
                icao24 VARCHAR(6),
                callsign VARCHAR(12),
                first_seen TIMESTAMPTZ NOT NULL,
                last_seen TIMESTAMPTZ NOT NULL,
                origin_icao VARCHAR(4),
                dest_icao VARCHAR(4)
            );
            CREATE INDEX IF NOT EXISTS idx_flights_icao_time ON flights (icao24, first_seen DESC);
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS track_points (
                icao24 VARCHAR(6),
                flight_id BIGINT,
                ts TIMESTAMPTZ NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                altitude_ft INTEGER,
                ground_speed REAL,
                track_deg REAL,
                vertical_rate REAL,
                on_ground BOOLEAN
            );
            CREATE INDEX IF NOT EXISTS idx_track_latlon ON track_points (lat, lon);
            CREATE INDEX IF NOT EXISTS idx_track_icao_ts ON track_points (icao24, ts);
            CREATE INDEX IF NOT EXISTS idx_track_flight_ts ON track_points (flight_id, ts);
        """)
        print("Verified Postgres tables exist.")
        return await asyncpg.create_pool(DB_URL)
    except Exception as e:
        print(f"Database bootstrap failed: {e}")
        return None

async def flush_postgres_batch(pool, batch):
    if not pool or not batch:
        return
    try:
        async with pool.acquire() as conn:
            # Simple bulk insert (ignoring flight_id linkage for this MVP to keep it fast)
            # A real implementation would lookup or create the flight_id first
            query = """
                INSERT INTO track_points (icao24, ts, lon, lat, altitude_ft, ground_speed, track_deg, vertical_rate, on_ground)
                VALUES ($1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9)
            """
            data = [
                (icao, t, lon, lat, alt, gs, trk, vr, gnd)
                for (icao, lat, lon, trk, alt, gs, vr, cs, gnd, t) in batch
                if lat is not None and lon is not None
            ]
            if data:
                await conn.executemany(query, data)
                print(f"Flushed {len(data)} track points to PostgreSQL.")
    except Exception as e:
        print(f"Error flushing to PostgreSQL: {e}")

async def stream_processor(redis_client, pool):
    # Process from the end of the stream
    last_id = '$'
    batch = []
    last_flush = time.time()
    
    while True:
        try:
            messages = await redis_client.xread({'feed:raw': last_id}, count=100, block=2000)
            now = time.time()
            
            for stream, msgs in messages:
                for msg_id, msg_data in msgs:
                    last_id = msg_id
                    raw_str = msg_data.get(b'data', b'[]').decode('utf-8')
                    states = json.loads(raw_str)
                    
                    pipeline = redis_client.pipeline()
                    deltas = []
                    
                    for state in states:
                        # OpenSky API format
                        icao24 = state[0]
                        cs = str(state[1]).strip() if state[1] else ""
                        lon = state[5]
                        lat = state[6]
                        alt = state[7] if state[7] is not None else 0
                        gnd = state[8]
                        gs = state[9] if state[9] is not None else 0
                        trk = state[10] if state[10] is not None else 0
                        vr = state[11] if state[11] is not None else 0
                        ts = state[3] if state[3] else int(now)
                        orig = state[12] if len(state) > 12 else ""
                        dest = state[13] if len(state) > 13 else ""
                        
                        if lat is None or lon is None:
                            continue
                            
                        # Redis Updates
                        state_hash = {
                            "icao24": icao24, "lat": lat, "lon": lon, "trk": trk,
                            "alt": alt, "gs": gs, "vr": vr, "cs": cs,
                            "gnd": str(gnd).lower(), "last_contact": ts,
                            "orig": orig, "dest": dest
                        }
                        pipeline.hset(f"aircraft:state:{icao24}", mapping=state_hash)
                        pipeline.geoadd("aircraft:geo", (lon, lat, icao24))
                        pipeline.sadd("aircraft:active", icao24)
                        
                        # Pack delta for realtime gateway
                        deltas.append([icao24, lat, lon, trk, alt, gs, vr, cs, orig, dest])
                        batch.append((icao24, lat, lon, trk, alt, gs, vr, cs, gnd, ts))
                    
                    if deltas:
                        pipeline.xadd("feed:state", {"data": json.dumps(deltas)})
                        await pipeline.execute()
                        print(f"Processed batch of {len(deltas)} aircraft.")

            # Flush batch to Postgres every 5 seconds
            if now - last_flush > 5:
                await flush_postgres_batch(pool, batch)
                batch = []
                last_flush = now
                
        except Exception as e:
            print(f"Stream processing error: {e}")
            await asyncio.sleep(1)

async def stale_sweep_loop(redis_client):
    sweep_interval = STALE_SWEEP_MS / 1000.0
    while True:
        await asyncio.sleep(sweep_interval)
        try:
            now = time.time()
            active_list = await redis_client.smembers("aircraft:active")
            stale_count = 0
            
            for icao_b in active_list:
                icao = icao_b.decode('utf-8')
                last_contact_str = await redis_client.hget(f"aircraft:state:{icao}", "last_contact")
                
                if not last_contact_str:
                    continue
                    
                last_contact = float(last_contact_str)
                # If older than 60s
                if now - last_contact > 60:
                    pipeline = redis_client.pipeline()
                    pipeline.zrem("aircraft:geo", icao)
                    pipeline.srem("aircraft:active", icao)
                    pipeline.delete(f"aircraft:state:{icao}")
                    # Notify gateways to remove
                    pipeline.xadd("feed:state", {"data": json.dumps({"rm": [icao]})})
                    await pipeline.execute()
                    stale_count += 1
                    
            if stale_count > 0:
                print(f"Swept {stale_count} stale aircraft.")
                
        except Exception as e:
            print(f"Stale sweep error: {e}")

async def main():
    pool = await bootstrap()
    redis_client = redis.from_url(REDIS_URL)
    
    print(f"State service starting. Sweeping stale every {STALE_SWEEP_MS} ms")
    
    # Run tasks concurrently
    await asyncio.gather(
        stream_processor(redis_client, pool),
        stale_sweep_loop(redis_client)
    )

if __name__ == "__main__":
    asyncio.run(main())
