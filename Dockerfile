FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build-only placeholders are not copied as runtime environment or secrets.
RUN OPENAI_API_KEY=build-placeholder APP_PASSWORD=build-placeholder npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 IMAGE_STORAGE_DIR=/app/generated-images
RUN groupadd --gid 10001 gptimage && useradd --uid 10001 --gid 10001 --no-create-home gptimage \
    && mkdir /app/generated-images && chown 10001:10001 /app/generated-images && chmod 0700 /app/generated-images
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=build --chown=10001:10001 /app/public ./public
COPY --chown=10001:10001 deploy-entrypoint.cjs ./deploy-entrypoint.cjs
USER 10001:10001
CMD ["node", "deploy-entrypoint.cjs"]
