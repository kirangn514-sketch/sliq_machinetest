# One image, two roles: the API (npm start) and the SLA worker (npm run worker).
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# Directory for the persisted RS256 key pair (mounted as a named volume by compose).
RUN mkdir -p /app/keys && chown -R node:node /app/keys

USER node
EXPOSE 5000

CMD ["npm", "start"]
