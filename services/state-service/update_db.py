import asyncio
import asyncpg

async def run():
    try:
        conn = await asyncpg.connect("postgres://admin:Admin%40123@127.0.0.1:5432/appdb")
        await conn.execute("ALTER TABLE track_points ADD COLUMN IF NOT EXISTS icao24 VARCHAR(6);")
        print("Column added successfully.")
        await conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(run())
