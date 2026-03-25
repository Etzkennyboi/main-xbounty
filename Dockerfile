# Use Ubuntu 24.04 to ensure GLIBC >= 2.39 is available for onchainos
FROM ubuntu:24.04

# Install Node.js 20 and system dependencies in one layer
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    libsecret-1-0 \
    libsecret-1-dev \
    dbus-x11 \
    gnome-keyring \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install onchainos (OKX Onchain OS CLI)
RUN curl -sSL "https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh" | sh

# Add onchainos to path (default install location is ~/.local/bin)
ENV PATH="/root/.local/bin:${PATH}"

# Verify onchainos installed correctly
RUN onchainos --version || echo "WARNING: onchainos not available"

# Create a proper XDG_RUNTIME_DIR with correct permissions (mode 0700)
# This is REQUIRED by dbus/gnome-keyring — /tmp won't work (mode 0777 is rejected)
RUN mkdir -p /run/user/0 && chmod 0700 /run/user/0
ENV XDG_RUNTIME_DIR=/run/user/0

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

# Create entrypoint script that initializes dbus + gnome-keyring before starting node
# This provides the Secret Service API that onchainos requires for its keyring
RUN printf '#!/bin/bash\n\
set -e\n\
\n\
# Ensure runtime dir exists with correct permissions on every boot\n\
mkdir -p /run/user/0\n\
chmod 0700 /run/user/0\n\
export XDG_RUNTIME_DIR=/run/user/0\n\
\n\
# Start a private dbus session and export its address\n\
eval $(dbus-launch --sh-syntax)\n\
export DBUS_SESSION_BUS_ADDRESS\n\
\n\
# Unlock gnome-keyring with an empty password so onchainos can store session data\n\
echo -n "" | gnome-keyring-daemon --unlock --components=secrets 2>/dev/null || true\n\
\n\
# Run the actual command\n\
exec "$@"\n' > /entrypoint.sh && chmod +x /entrypoint.sh

# Expose the API port
EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "src/index.js"]
