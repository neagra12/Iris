# ── Stage 1: Build React frontend ─────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production server ─────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./

# Copy built frontend into backend's sibling directory (server.js uses ../frontend/dist)
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "server.js"]
