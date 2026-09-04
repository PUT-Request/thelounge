# syntax=docker/dockerfile:1
#
# Self-contained image for this fork (no separate packaging repo needed):
#   docker build -t thelounge .
#   docker run -d -p 9000:9000 -v thelounge-data:/home/lounge/data thelounge
#
# Published to ghcr.io/PUT-Request/thelounge by .github/workflows/docker.yml.

FROM node:24-slim AS build

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --non-interactive

COPY . .

RUN NODE_ENV=production yarn build

FROM node:24-slim

ENV NODE_ENV=production \
	THELOUNGE_HOME=/home/lounge/data

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production --non-interactive \
	&& yarn cache clean

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY index.js defaults .thelounge_home ./

RUN mkdir -p /home/lounge/data \
	&& chown -R node:node /app /home/lounge

USER node

EXPOSE 9000

VOLUME /home/lounge/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:9000/').then((r) => {if (!r.ok) {process.exit(1);}}).catch(() => process.exit(1))"

CMD ["node", "index.js", "start"]
