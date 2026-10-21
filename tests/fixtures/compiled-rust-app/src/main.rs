pub mod telemetry;

pub fn main() {
    let sample = telemetry::collect_metric("cpu_load", 42);
    println!("{}", sample.name);
}
