import asyncio
import json
import time
import urllib.request
import redis.asyncio as redis

REDIS_URL = "redis://127.0.0.1:6379"

# Bounding box / Radius for India as an example
# lat, lon, dist in nautical miles
API_URL = "https://opendata.adsb.fi/api/v3/lat/20/lon/78/dist/250"

async def fetch_adsbfi_data(redis_client):
    print(f"Polling ADSB.fi OpenData API: {API_URL}")
    req = urllib.request.Request(API_URL, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    
    while True:
        try:
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode())
                ac_list = data.get("ac", [])
                
                states_for_redis = []
                now = int(time.time())
                
                for ac in ac_list:
                    lat = ac.get("lat")
                    lon = ac.get("lon")
                    if lat is None or lon is None:
                        continue
                        
                    # Map to OpenSky format for state-service compatibility
                    # [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate]
                    state = [
                        ac.get("hex", ""),
                        ac.get("flight", ""),
                        "Unknown",
                        now,
                        now,
                        lon,
                        lat,
                        ac.get("alt_baro", 0),
                        False, # on_ground
                        ac.get("gs", 0),
                        ac.get("track", 0),
                        ac.get("baro_rate", 0)
                    ]
                    states_for_redis.append(state)
                
                if states_for_redis:
                    payload = {"data": json.dumps(states_for_redis)}
                    await redis_client.xadd("feed:raw", payload)
                    print(f"Published {len(states_for_redis)} live aircraft to Redis from ADSB.fi.")
                else:
                    print("No aircraft found in the current radius.")
            
            # Rate limit is 1 request per second, but 5s is good for smooth flight
            await asyncio.sleep(5)
            
        except Exception as e:
            print(f"Connection error: {e}")
            await asyncio.sleep(10)

async def main():
    redis_client = redis.from_url(REDIS_URL)
    print("Starting LIVE ADSB.fi ingestion service...")
    await fetch_adsbfi_data(redis_client)

if __name__ == "__main__":
    asyncio.run(main())
