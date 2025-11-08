# Úrscéal Docker Image
FROM node:lts-alpine

# Set working directory
WORKDIR /app

# Install dependencies for Node.js
RUN apk add --no-cache tini

# Copy package files
COPY server/package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy server code
COPY server/ ./

# Copy client files
COPY client/ ./public/

# Copy shared files
COPY shared/ ./shared/

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 8000

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start server
CMD ["node", "server.js"]
