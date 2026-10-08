# Tilbudsradar – én container med API, cron-jobs og den byggede frontend.
# Byg:   docker build -t tilbudsradar .
# Kør:   docker run -p 4000:4000 --env-file .env tilbudsradar
#
# Debian (bookworm) frem for Alpine: sharp har færdigbyggede binærer til glibc,
# og tekstgenkendelsen (tesseract.js) kører som WebAssembly uden systempakker.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY scrapers/package.json scrapers/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY scrapers scrapers
COPY backend backend
COPY frontend frontend
# Frontenden har ingen hemmeligheder og ingen miljøafhængige værdier i buildet:
# firmaoplysninger, Plausible og Sentry indsættes af serveren ved hver sidevisning.
RUN npm run build

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY scrapers/package.json scrapers/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Pakker i andre versioner end roden (fx nodemailer 8 i backend) ligger i
# workspace-mappernes egne node_modules – mapperne oprettes, så COPY altid virker.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force  && mkdir -p backend/node_modules scrapers/node_modules

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    OCR_CACHE_DIR=/app/.data/tessdata
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules node_modules
COPY --from=deps --chown=node:node /app/backend/node_modules backend/node_modules
COPY --from=deps --chown=node:node /app/scrapers/node_modules scrapers/node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/backend/package.json backend/package.json
COPY --from=build --chown=node:node /app/backend/dist backend/dist
COPY --from=build --chown=node:node /app/frontend/dist frontend/dist
RUN mkdir -p /app/.data/tessdata && chown -R node:node /app/.data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/dist/server.js"]
