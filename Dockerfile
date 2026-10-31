FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY lib ./lib
COPY public ./public
COPY server.js ./
ENV NODE_ENV=production
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-8080}/healthz || exit 1
CMD ["node", "server.js"]
