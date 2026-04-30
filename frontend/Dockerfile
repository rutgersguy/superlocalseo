FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM base AS build
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
