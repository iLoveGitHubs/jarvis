FROM node:18-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev || true
COPY src ./src
COPY docs ./docs
COPY skills ./skills
COPY projects ./projects
COPY README.md ./
RUN mkdir -p data docs/urd docs/usage
COPY deploy-data/projects.json ./data/projects.json
ENV PORT=8080
ENV PROJECTS_DIR=/app/projects
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/server.js"]
