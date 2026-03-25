# Use Ubuntu 24.04 to ensure GLIBC >= 2.39 is available for onchainos
FROM ubuntu:24.04

# Install Node.js 20 and system dependencies in one layer
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install onchainos (OKX Onchain OS CLI) — still used for non-send operations
RUN curl -sSL "https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh" | sh

# Add onchainos to path (default install location is ~/.local/bin)
ENV PATH="/root/.local/bin:${PATH}"

# Verify onchainos installed correctly
RUN onchainos --version || echo "WARNING: onchainos not available"

# Set working directory
WORKDIR /app

# Install root dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy backend source
COPY src ./src

# Copy frontend source and build it
COPY frontend ./frontend
WORKDIR /app/frontend
RUN npm install
RUN npm run build

# Go back to root
WORKDIR /app

# Expose the API port
EXPOSE 3001

# Start the application directly with node (avoids npm wrapper SIGTERM issues)
CMD ["node", "src/index.js"]
