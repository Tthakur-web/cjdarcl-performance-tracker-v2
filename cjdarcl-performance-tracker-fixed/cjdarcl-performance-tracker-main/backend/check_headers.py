
import asyncio
from dotenv import load_dotenv
import server
from services import sheets

async def main():
    load_dotenv(".env")

    for name, url in server.SHEET_URLS.items():
        csv_text = await sheets.fetch_csv(url)
        print(f"\n--- {name} ---")
        print(csv_text.splitlines()[0] if csv_text else "EMPTY CSV")

asyncio.run(main())