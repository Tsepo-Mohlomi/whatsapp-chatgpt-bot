FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV AUTH_DIR=/data/auth

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY bot.js README.md .env.example ./
RUN mkdir -p /data/auth && chown -R node:node /app /data

USER node
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "bot.js"]
