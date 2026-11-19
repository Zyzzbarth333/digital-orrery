FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm

# Install additional OS packages if needed
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    # Add SPICE toolkit dependencies if needed
    # libx11-dev \
    # libxext-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install global node packages
RUN npm install -g npm@latest

# If you need Python packages for SPICE processing
# RUN pip3 install spiceypy numpy

# Set up git defaults
RUN git config --global init.defaultBranch main