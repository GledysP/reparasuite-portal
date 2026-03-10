# ===== BUILD =====
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Normaliza la salida a /app/out, detectando dónde quedó index.html
RUN set -eux; \
    rm -rf /app/out && mkdir -p /app/out; \
    if [ -f /app/dist/index.html ]; then \
      cp -a /app/dist/. /app/out/; \
    else \
      SRC="$(dirname "$(find /app/dist -maxdepth 4 -type f -name index.html -print -quit)")"; \
      if [ -z "$SRC" ]; then \
        echo "ERROR: No se encontró index.html en /app/dist"; \
        find /app/dist -maxdepth 4 -type f | sed -n '1,200p'; \
        exit 1; \
      fi; \
      cp -a "$SRC"/. /app/out/; \
    fi

# ===== RUN (Nginx) =====
FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/out/. /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
EOF