# syntax=docker/dockerfile:1.7

# Node 24 LTS (supported until 2028-04-30), pinned by digest so a rebuild can't silently change the
# runtime (this digest is node 24.22.1 on alpine 3.24.3). The tag is the moving `24-alpine` on
# purpose: .github/dependabot.yml bumps the digest when a new 24.x or Alpine build is published,
# whereas a tag naming the Alpine release would stop getting updates once that release does.

# ---- Build stage ----
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build

WORKDIR /app

# Install deps with the lockfile for reproducible builds
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ---- Runtime stage ----
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime

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
