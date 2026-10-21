from calculator import compute_discounted_total

class PricingServer:
    def __init__(self, region: str) -> None:
        self.region = region

@app.get("/api/v1/quote")
async def get_price_quote(sku: str, quantity: int) -> dict:
    total = compute_discounted_total(1500, quantity, 500)
    return {"sku": sku, "total_cents": total}

@app.post("/api/v1/recalculate")
async def recalculate_tier(account_id: str) -> dict:
    return {"account_id": account_id, "status": "ok"}

if __name__ == "__main__":
    print("Starting pricing service")
