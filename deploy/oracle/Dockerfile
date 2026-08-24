# Oracle Always Free ARM(A1) · x86 모두 동작 (multi-arch Node 이미지)
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY backend ./backend

ENV NODE_ENV=production
ENV PORT=4015
EXPOSE 4015

CMD ["node", "backend/server.clean.js"]
