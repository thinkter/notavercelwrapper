FROM node:22-bookworm

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    docker.io \
    git \
    tar \
    unzip \
    util-linux \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./package.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/worker/tsconfig.json ./apps/worker/tsconfig.json

RUN npm install --workspace @clircel/worker

COPY apps/worker/src ./apps/worker/src

CMD ["npm", "run", "--workspace", "@clircel/worker", "start"]
