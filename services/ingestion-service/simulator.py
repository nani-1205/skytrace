import time
import math
import random
import redis
import json

import urllib.request

try:
    with open("config.json", "r") as f:
        config = json.load(f)
except Exception:
    config = {}

common_api_url = config["common_api_url"]
try:
    with urllib.request.urlopen(f"{common_api_url}/config") as response:
        remote_config = json.loads(response.read().decode())
        REDIS_URL = remote_config["redis_url"]
except Exception as e:
    print(f"Failed to load remote config: {e}")
    raise e

redis_client = redis.from_url(REDIS_URL, decode_responses=True)

AIRPORTS = [
  { 'iata': 'BOM', 'name': 'Chhatrapati Shivaji', 'city': 'Mumbai', 'lat': 19.0886, 'lon': 72.8679 },
  { 'iata': 'DEL', 'name': 'Indira Gandhi',       'city': 'Delhi',  'lat': 28.5562, 'lon': 77.1000 },
  { 'iata': 'BLR', 'name': 'Kempegowda',          'city': 'Bangalore', 'lat': 13.1986, 'lon': 77.7066 },
  { 'iata': 'HYD', 'name': 'Rajiv Gandhi',        'city': 'Hyderabad', 'lat': 17.2403, 'lon': 78.4294 },
  { 'iata': 'MAA', 'name': 'Chennai Intl',        'city': 'Chennai', 'lat': 12.9941, 'lon': 80.1709 },
  { 'iata': 'CCU', 'name': 'Netaji Subhas',       'city': 'Kolkata', 'lat': 22.6520, 'lon': 88.4467 },
  { 'iata': 'LHR', 'name': 'Heathrow',            'city': 'London', 'lat': 51.4700, 'lon': -0.4543 },
  { 'iata': 'DXB', 'name': 'Dubai Intl',          'city': 'Dubai', 'lat': 25.2532, 'lon': 55.3657 },
  { 'iata': 'SIN', 'name': 'Changi',              'city': 'Singapore', 'lat': 1.3644, 'lon': 103.9915 },
  { 'iata': 'JFK', 'name': 'John F. Kennedy',     'city': 'New York', 'lat': 40.6413, 'lon': -73.7781 },
  { 'iata': 'FRA', 'name': 'Frankfurt',           'city': 'Frankfurt', 'lat': 50.0379, 'lon': 8.5622 },
  { 'iata': 'CDG', 'name': 'Charles de Gaulle',   'city': 'Paris', 'lat': 49.0097, 'lon': 2.5479 },
  { 'iata': 'DOH', 'name': 'Hamad Intl',          'city': 'Doha', 'lat': 25.2730, 'lon': 51.6080 },
  { 'iata': 'SYD', 'name': 'Sydney Intl',         'city': 'Sydney', 'lat': -33.9399, 'lon': 151.1753 },
  { 'iata': 'NRT', 'name': 'Narita',              'city': 'Tokyo', 'lat': 35.7647, 'lon': 140.3863 }
]

AIRLINES = ['IGO', 'AIC', 'SEJ', 'VTI', 'IAD', 'AXB', 'QTR', 'UAE', 'SIA', 'BAW', 'AFR', 'DLH', 'THY', 'UAL']

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def great_circle_interpolate(lat1, lon1, lat2, lon2, fraction):
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    d = 2 * math.asin(math.sqrt(math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2))
    if d == 0:
        return math.degrees(lat1), math.degrees(lon1)
    a = math.sin((1 - fraction) * d) / math.sin(d)
    b = math.sin(fraction * d) / math.sin(d)
    x = a * math.cos(lat1) * math.cos(lon1) + b * math.cos(lat2) * math.cos(lon2)
    y = a * math.cos(lat1) * math.sin(lon1) + b * math.cos(lat2) * math.sin(lon2)
    z = a * math.sin(lat1) + b * math.sin(lat2)
    lat_interp = math.atan2(z, math.sqrt(x**2 + y**2))
    lon_interp = math.atan2(y, x)
    return math.degrees(lat_interp), math.degrees(lon_interp)

def initial_bearing(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dLon = lon2 - lon1
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dLon)
    y = math.sin(dLon) * math.cos(lat2)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

flights = []

# Generate exactly 20 flights per airline (14 * 20 = 280 flights)
for airline in AIRLINES:
    for i in range(20):
        origin = random.choice(AIRPORTS)
        dest = random.choice(AIRPORTS)
        while dest['iata'] == origin['iata']:
            dest = random.choice(AIRPORTS)
            
        icao24 = f"{airline.lower()}{random.randint(1000, 9999)}"
        distance = haversine(origin['lat'], origin['lon'], dest['lat'], dest['lon'])
        progress_km = random.uniform(0, distance)
        
        speed_kt = random.uniform(400, 520)
        callsign = f"{airline}{random.randint(100, 999)}"
        # icao24 must be exactly 6 characters for Postgres VARCHAR(6)
        icao24 = f"{random.randint(0x100000, 0xFFFFFF):06x}"
        
        speed_kmh = speed_kt * 1.852
        alt_ft = random.uniform(30000, 42000)
        
        flights.append({
            'icao24': icao24,
            'callsign': callsign,
            'origin': origin,
            'dest': dest,
            'total_dist': distance,
            'progress_km': progress_km,
            'speed_kmh': speed_kmh,
            'speed_kt': speed_kt,
            'alt_ft': alt_ft
        })

print(f"Generated {len(flights)} simulated flights. Starting loop...")

INTERVAL = 2
SPEED_MULTIPLIER = 10  # Speeds up visual progress

try:
    while True:
        payload = []
        for f in flights:
            dist_flown = f['progress_km'] + (f['speed_kmh'] / 3600) * INTERVAL * SPEED_MULTIPLIER
            
            # If plane lands, pick a new destination
            if dist_flown >= f['total_dist']:
                f['origin'] = f['dest']
                f['dest'] = random.choice(AIRPORTS)
                while f['dest']['iata'] == f['origin']['iata']:
                    f['dest'] = random.choice(AIRPORTS)
                f['total_dist'] = haversine(f['origin']['lat'], f['origin']['lon'], f['dest']['lat'], f['dest']['lon'])
                dist_flown = 0
                f['icao24'] = f"{random.randint(0x100000, 0xFFFFFF):06x}"
            
            f['progress_km'] = dist_flown
            
            # Math
            fraction = dist_flown / f['total_dist']
            current_lat, current_lon = great_circle_interpolate(f['origin']['lat'], f['origin']['lon'], f['dest']['lat'], f['dest']['lon'], fraction)
            current_bearing = initial_bearing(current_lat, current_lon, f['dest']['lat'], f['dest']['lon'])
            
            # Format matches OpenSky API structure expected by state-service
            # [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, baro_altitude, on_ground, velocity, true_track, vertical_rate]
            payload.append([
                f['icao24'],                     # 0
                f['callsign'],                   # 1
                "Simulated",                     # 2
                int(time.time()),                # 3
                int(time.time()),                # 4
                round(current_lon, 4),           # 5
                round(current_lat, 4),           # 6
                round(f['alt_ft']),              # 7
                False,                           # 8
                round(f['speed_kt']),            # 9
                round(current_bearing, 1),       # 10
                0,                               # 11
                f['origin']['iata'],             # 12
                f['dest']['iata']                # 13
            ])
            
        redis_client.xadd('feed:raw', {'data': json.dumps(payload)})
        time.sleep(INTERVAL)

except KeyboardInterrupt:
    print("Simulator stopped.")
