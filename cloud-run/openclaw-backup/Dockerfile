FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tar \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
RUN npx tsc

CMD ["node", "dist/index.js"]
