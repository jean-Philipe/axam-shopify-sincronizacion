# Dockerfile para Scheduler de Sincronización Shopify
FROM node:18-alpine

# Instalar tzdata para manejo de zonas horarias
RUN apk add --no-cache tzdata

# Establecer zona horaria
ENV TZ=America/Santiago

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias (solo producción)
RUN npm install --omit=dev

# Copiar código de la aplicación
COPY . .

# No exponer puertos (solo ejecución interna)
# El scheduler no necesita servidor HTTP

# Ejecutar el scheduler
CMD ["node", "syncScheduler.js"]

