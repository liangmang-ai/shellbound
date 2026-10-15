FROM node:22-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN npm ci --prefix server --omit=dev
COPY package.json ./
COPY server/server.mjs ./server/
COPY src/game.js src/coop-game.js ./src/
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server/server.mjs"]
