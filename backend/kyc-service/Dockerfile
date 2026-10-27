FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
COPY prisma.config.mjs .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate

COPY src ./src
COPY server.js .

RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node

EXPOSE 5003
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
