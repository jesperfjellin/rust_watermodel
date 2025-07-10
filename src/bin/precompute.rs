use std::path::Path;
use std::env;
use rust_watermodel::precompute;

fn main() {
    println!("Rust Water Model - Pre-computation Tool");
    
    let args: Vec<String> = env::args().collect();
    
    if args.len() != 3 {
        println!("Usage: {} <input_directory> <output_directory>", args[0]);
        println!("  input_directory:  Directory containing GeoTIFF DEM files");
        println!("  output_directory: Directory to save pre-computed data");
        return;
    }
    
    let input_dir = Path::new(&args[1]);
    let output_dir = Path::new(&args[2]);
    
    if !input_dir.exists() {
        println!("Error: Input directory does not exist: {}", input_dir.display());
        return;
    }
    
    if !input_dir.is_dir() {
        println!("Error: Input path is not a directory: {}", input_dir.display());
        return;
    }
    
    println!("Input directory: {}", input_dir.display());
    println!("Output directory: {}", output_dir.display());
    
    // Process all catchments
    match precompute::process_all_catchments(input_dir, output_dir) {
        Ok(()) => {
            println!("Pre-computation completed successfully!");
            println!("Pre-computed data saved to: {}", output_dir.display());
        },
        Err(e) => {
            println!("Error during pre-computation: {}", e);
        }
    }
} 