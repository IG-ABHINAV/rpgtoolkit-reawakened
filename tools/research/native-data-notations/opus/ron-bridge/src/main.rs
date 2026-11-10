//! #1778 research helper (Opus). A thin CLI around the reference `ron` crate so
//! the Node experiments can exercise real RON parsing and pretty printing. It
//! is not a parser: every syntax decision is the `ron` crate's.
//!
//!   ron-bridge to-json   < doc.ron   > doc.json   (RON -> serde_json::Value)
//!   ron-bridge from-json < doc.json  > doc.ron    (serde_json::Value -> pretty RON)
//!
//! Errors are printed as JSON `{ "error": ..., "line": .., "col": .. }` on
//! stdout with exit code 2 so callers can record source positions.
use std::io::Read;

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_default();
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("stdin");
    match mode.as_str() {
        "to-json" => match ron::from_str::<serde_json::Value>(&input) {
            Ok(v) => println!("{}", serde_json::to_string(&v).unwrap()),
            Err(e) => {
                let out = serde_json::json!({
                    "error": e.code.to_string(),
                    "line": e.span.start.line,
                    "col": e.span.start.col,
                });
                println!("{out}");
                std::process::exit(2);
            }
        },
        "from-json" | "from-json-compact" => {
            let v: serde_json::Value = serde_json::from_str(&input).expect("json");
            let cfg = ron::ser::PrettyConfig::new()
                .indentor("  ".to_string())
                .separate_tuple_members(false)
                .compact_arrays(mode == "from-json-compact");
            print!("{}", ron::ser::to_string_pretty(&v, cfg).unwrap());
            println!();
        }
        _ => {
            eprintln!("usage: ron-bridge to-json|from-json|from-json-compact");
            std::process::exit(64);
        }
    }
}
