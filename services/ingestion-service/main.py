import asyncio
import json
import httpx
import redis.asyncio as redis

with open("config.json", "r") as f:
    config = json.load(f)

REDIS_URL = "redis://127.0.0.1:6379"
INTERVAL = config.get("interval_ms", 5000) / 1000.0

# OpenSky API endpoint for all states
OPENSKY_URL = "https://opensky-network.org/api/states/all"

# Bounding box for Central Europe to avoid downloading the whole world
# lamin, lomin, lamax, lomax
BBOX = {
    "lamin": 45.0,
    "lomin": 5.0,
    "lamax": 55.0,
    "lomax": 15.0
}

async def fetch_and_publish(redis_client, http_client):
    try:
        response = await http_client.get(OPENSKY_URL, params=BBOX)
        if response.status_code == 200:
            data = response.json()
            states = data.get("states")
            if states:
                # Add to Redis stream
                payload = {"data": json.dumps(states)}
                await redis_client.xadd("feed:raw", payload)
                print(f"Published {len(states)} aircraft to feed:raw")
            else:
                print("No aircraft in the current bounding box.")
        elif response.status_code == 429:
            print("Rate limited by OpenSky API. Waiting for next cycle.")
        else:
            print(f"OpenSky API error: {response.status_code}")
    except Exception as e:
        print(f"Error fetching data: {e}")

async def main():
    print(f"Ingestion service starting. Polling every {INTERVAL} seconds.")
    
    redis_client = redis.from_url(REDIS_URL)
    
    async with httpx.AsyncClient() as http_client:
        while True:
            await fetch_and_publish(redis_client, http_client)
            await asyncio.sleep(INTERVAL)

if __name__ == "__main__":
    asyncio.run(main())
