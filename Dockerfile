# Writers Guild Docker Image
FROM node:lts-alpine AS builder

# Build Vue client
WORKDIR /app/vue_client
COPY vue_client/package*.json ./
RUN npm ci
COPY vue_client/ ./
RUN npm run build

# Production image
FROM node:lts-alpine

# Set working directory
WORKDIR /app

# Install dependencies for Node.js
RUN apk add --no-cache tini

# Copy server package files
COPY server/package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy server code
COPY server/ ./

# Copy built Vue client from builder
COPY --from=builder /app/vue_client/dist ./public/

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 8000

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start server
CMD ["node", "server.js"]
