from src.service import compute_health_score

def test_compute_health_score() -> None:
    assert compute_health_score(3) == 60
