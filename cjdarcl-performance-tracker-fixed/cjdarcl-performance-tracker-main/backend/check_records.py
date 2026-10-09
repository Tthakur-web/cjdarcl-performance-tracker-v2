
import asyncio
import os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(".env")

async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    total = await db.daily_records.count_documents({})
    with_email = await db.daily_records.count_documents({
        "salesperson_email": {"$exists": True, "$ne": ""}
    })

    print("Total saved daily records:", total)
    print("Records with salesperson email:", with_email)

    sample = await db.daily_records.find_one({}, {"_id": 0})
    print("Sample record:", sample)

    client.close()

asyncio.run(main())