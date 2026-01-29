FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm i --omit=dev
COPY src ./src
COPY devices.json ./
EXPOSE 8787
CMD ["npm","start"]
