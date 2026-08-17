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

# Test target: the SAME production build, but with an nginx config that also
# proxies /api to the test API container, so the stack is self-contained.
# A separate target rather than a bind-mounted config file — single-file bind
# mounts are pinned to the inode on this host and silently ignore edits.
FROM nginx:alpine AS test
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx-frontend-test.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
