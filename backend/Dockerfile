FROM node:20-alpine AS base
WORKDIR /app
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
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data/reports
EXPOSE 3000
CMD ["node", "dist/index.js"]
