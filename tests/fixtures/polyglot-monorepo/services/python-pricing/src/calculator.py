def compute_discounted_total(unit_price_cents: int, quantity: int, discount_bps: int) -> int:
    gross = unit_price_cents * quantity
    discount = (gross * discount_bps) // 10000
    return max(0, gross - discount)
