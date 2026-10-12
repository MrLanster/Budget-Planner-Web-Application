# Budget Planner - the web app and its server, in one image.
#
# There is nothing to build and no packages to install: the server runs on
# Node's own http, crypto and sqlite modules. The image is just Node plus the
# two folders that matter.
FROM node:24-alpine

WORKDIR /app

COPY web ./web
COPY server ./server

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

# Where the accounts and the per-user databases live. Mount a volume here, or
# every account is lost when the container is replaced.
ENV BP_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8080

CMD ["node", "server/src/server.js"]
