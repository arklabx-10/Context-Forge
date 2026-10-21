pub struct MetricSample {
    pub name: String,
    pub value: i64,
}

pub fn collect_metric(name: &str, value: i64) -> MetricSample {
    MetricSample {
        name: name.to_string(),
        value,
    }
}
