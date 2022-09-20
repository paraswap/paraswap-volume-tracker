# compile typescript to ./dist
FROM node:16-alpine AS tsc
WORKDIR /app
COPY ["package*.json", "tsconfig.json", "yarn.lock", "./"]
RUN yarn install
COPY . ./
RUN yarn build

# install production only dependencies
FROM node:16-alpine as yarn-prod
WORKDIR /app
COPY --from=tsc /app/package*.json ./
COPY --from=tsc /app/yarn.lock ./
COPY --from=tsc /app/dist ./
RUN yarn install --production

# copy only production artifacts (get rid of yarn cache)
FROM node:16-alpine as image
RUN apk --no-cache add dumb-init curl && rm -rf /var/cache/apk/*
WORKDIR /app
COPY --from=yarn-prod /app ./
EXPOSE 80
CMD ["dumb-init", "node", "index.js"]
