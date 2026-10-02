FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
ENV PORT=8787
EXPOSE 8787
CMD ["sh", "-c", "npm run db:migrate && npm run server"]
