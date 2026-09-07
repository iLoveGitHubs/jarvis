FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev || true
COPY src ./src
COPY docs ./docs
COPY skills ./skills
COPY README.md ./
RUN mkdir -p data docs/urd docs/usage
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/server.js"]
