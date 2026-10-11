FROM node:20-slim

# Install Python 3, pip, and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first for layer caching
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Install Node production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Default environment configuration
ENV PORT=3001
ENV PYTHON_PATH=python3

EXPOSE 3001

CMD ["node", "server.js"]
