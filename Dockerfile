# CourseCopilot Streamable HTTP image for Render / Fly / Cloudflare Containers.
# Native modules (better-sqlite3, sqlite-vec, onnxruntime-node) need a full Node image.
FROM node:20-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY extension ./extension
ENV NODE_ENV=production
ENV COURSECOPILOT_HOME=/data
ENV HF_HOME=/data/hf
ENV PORT=8787
ENV COURSECOPILOT_HOSTED=1
ENV COURSECOPILOT_BIND=0.0.0.0
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/cli.js", "serve", "--http", "--bind", "0.0.0.0"]
