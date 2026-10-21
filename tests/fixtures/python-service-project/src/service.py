from dataclasses import dataclass

@dataclass
class HealthReport:
    service_name: str
    score: int

def compute_health_score(multiplier: int) -> int:
    return 20 * multiplier
