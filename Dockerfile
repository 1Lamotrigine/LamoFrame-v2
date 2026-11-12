FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV STORAGE_DIR=/app/storage
EXPOSE 3000
CMD ["npm", "start"]
