import asyncio
import asyncpg

async def run():
    print("Truncating database...")
    try:
        conn = await asyncpg.connect('postgres://admin:Admin%40123@127.0.0.1:5432/appdb')
        await conn.execute('TRUNCATE TABLE track_points;')
        await conn.close()
        print("Done!")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(run())
