FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Release archives are extracted under a private host umask; static assets
# must remain readable by the unprivileged application user.
RUN chmod -R a+rX /app/public
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.js"]
