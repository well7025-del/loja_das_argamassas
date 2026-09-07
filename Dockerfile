# Imagem do ERP da Loja das Argamassas.
# Node 22 traz o SQLite embutido, entao nao ha nada para instalar.
FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=America/Recife

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

# data/ guarda o banco e uploads/ guarda os comprovantes: monte um volume nesses caminhos
RUN mkdir -p data uploads && addgroup -S erp && adduser -S erp -G erp && chown -R erp:erp /app
USER erp

VOLUME ["/app/data", "/app/uploads"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/catalogo/lojas > /dev/null || exit 1

CMD ["node", "server/index.js"]
