# Use Node.js Alpine as base image (Bun compatible)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install Bun (for package management and runtime)
RUN apk add --no-cache curl bash \
    && curl -fsSL https://bun.sh/install | bash \
    && mv ~/.bun/bin/bun /usr/local/bin/ \
    && mv ~/.bun /usr/local/lib/bun

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies using Bun
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY images/ ./images/

# Expose port
EXPOSE 4000

# Set environment variables
ENV PORT=4000
ENV NODE_ENV=production

# Run the application
CMD ["bun", "run", "src/server.ts"]
