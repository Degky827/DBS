FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY server.js .
COPY docs ./docs
COPY prisma.config.mjs .

EXPOSE 5002

CMD ["node", "server.js"]
