FROM node:20-alpine
RUN apk add --no-cache vips-dev build-base python3
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/db /data/uploads/avatars /data/uploads/mastertag_headers /data/uploads/media/images /data/uploads/media/sound /data/uploads/media/video
EXPOSE 8080
CMD ["node","server.js"]
