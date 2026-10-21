from calculator import compute_discounted_total

def test_compute_discounted_total() -> None:
    assert compute_discounted_total(1000, 2, 1000) == 1800
