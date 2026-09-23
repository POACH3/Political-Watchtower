# Local-dev image. Stage 7/14 will add a separate production build stage
# (standalone output, no dev dependencies) when deployment docs land —
# this Dockerfile only needs to support `docker compose up` for now.

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
