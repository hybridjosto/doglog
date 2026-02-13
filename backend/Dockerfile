FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json /app/package.json
RUN npm install --omit=dev

COPY src /app/src
COPY public /app/public
COPY config /app/config

EXPOSE 8080

CMD ["npm", "start"]
