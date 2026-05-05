# syntax=docker/dockerfile:1.7

# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Install deps with the lockfile for reproducible builds
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ---- Runtime stage ----
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled app
COPY --from=build /app/dist ./dist

# Run as non-root
RUN addgroup -S app && adduser -S app -G app
USER app

# Fly injects PORT=8080 by default; the app reads process.env.PORT
EXPOSE 8080

CMD ["node", "dist/index.js"]
