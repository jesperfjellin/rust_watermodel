FROM rust:1.72 as builder

# Install GDAL dependencies
RUN apt-get update && apt-get install -y \
    libgdal-dev \
    gdal-bin \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Create a new empty project
WORKDIR /app

# Copy over manifests
COPY Cargo.toml ./

# Copy source code
COPY src ./src

# Build the application
RUN cargo build --release

# Runtime image
FROM debian:bullseye-slim

# Install runtime dependencies only
RUN apt-get update && apt-get install -y \
    libgdal30 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/target/release/rust_watermodel .

# Create a volume for data
VOLUME /data

# Set the command to run the application
CMD ["./rust_watermodel"]