// Host-only research bridge to the official ron-rs parser, not a parser implementation.
use std::io::{self, Read};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode == "encode" {
        let value: serde_json::Value = serde_json::from_str(&input)?;
        println!("{}", ron::ser::to_string_pretty(&value, ron::ser::PrettyConfig::default())?);
    } else {
        let value: serde_json::Value = ron::from_str(&input)?;
        println!("{}", serde_json::to_string(&value)?);
    }
    Ok(())
}
