import json
import psycopg2

import urllib.request

with open("config.json", "r") as f:
    config = json.load(f)

common_api_url = config["common_api_url"]
try:
    with urllib.request.urlopen(f"{common_api_url}/config") as response:
        remote_config = json.loads(response.read().decode())
        DB_URL = remote_config.get("db_url")
except Exception as e:
    print(f"Failed to load remote config: {e}")
    raise e

def bootstrap():
    try:
        conn = psycopg2.connect(DB_URL)
        conn.autocommit = True
        cur = conn.cursor()
        print("Connected to PostgreSQL for Enrichment Service.")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS aircraft (
                icao24 VARCHAR(6) PRIMARY KEY,
                registration VARCHAR(16),
                type_code VARCHAR(8),
                manufacturer TEXT,
                model TEXT,
                operator TEXT,
                owner TEXT,
                category SMALLINT
            );
        """)
        print("Verified 'aircraft' table exists.")
        
        cur.execute("SELECT COUNT(*) FROM aircraft;")
        count = cur.fetchone()[0]
        if count == 0:
            print("Aircraft table is empty. Seed data needs to be populated.")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Database bootstrap failed: {e}")

def main():
    bootstrap()
    print("Enrichment service starting.")

if __name__ == "__main__":
    main()
