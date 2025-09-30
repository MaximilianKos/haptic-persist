# --- deps stage: fresh prod install with npm (no lockfile) ---
FROM node:20-alpine AS deps
WORKDIR /app

# Only copy manifest for better caching
COPY package.json ./

# Fresh install, prod deps only
RUN npm install --omit=dev

# --- runtime stage ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV VOLUME_PATH=/data/Haptic
ENV ROOT_NAME=Haptic

# Prepare default data dir for the non-root user
RUN mkdir -p /data && chown -R node:node /data

# Bring in deps and your source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Drop root
USER node

EXPOSE 3000
# Your listing shows "index.js"; change if different
CMD ["node", "index.js"]
