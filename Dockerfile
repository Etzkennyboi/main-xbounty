# Use a lightweight Node.js image
FROM node:20-slim

# Install basic system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

# Start the application
CMD ["node", "src/index.js"]
