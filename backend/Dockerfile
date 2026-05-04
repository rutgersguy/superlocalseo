FROM node:20-alpine AS base
WORKDIR /app

# Chromium and its deps for Puppeteer PDF generation
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm ci

FROM base AS dev
COPY . .
CMD ["npm", "run", "dev"]

FROM base AS build
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data/reports
EXPOSE 3000
CMD ["node", "dist/index.js"]
