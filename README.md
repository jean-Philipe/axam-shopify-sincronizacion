# API Manager Express - Axam Middleware

API REST intermedia (Middleware) para interactuar con el ERP Manager+ de Axam y sincronizar stocks con Shopify.

## 🚀 Instalación

1. Instala las dependencias:
```bash
npm install
```

2. Configura las variables de entorno:
   - Crea un archivo `.env` en la raíz del proyecto
   - Copia las variables del archivo `.env.example` y completa con tus credenciales

## ⚙️ Variables de Entorno

### ERP Manager+
- `ERP_BASE_URL` - URL base del ERP (ej: https://axam.managermas.cl/api)
- `ERP_USERNAME` - Usuario para autenticación en el ERP
- `ERP_PASSWORD` - Contraseña para autenticación en el ERP
- `RUT_EMPRESA` - RUT de la empresa en el ERP

### Shopify
- `SHOPIFY_SHOP_DOMAIN` - Dominio de tu tienda Shopify (ej: tu-tienda.myshopify.com)
- `SHOPIFY_ACCESS_TOKEN` - Token de acceso de la API de Shopify

## 📋 Uso

### Servidor Principal
Inicia el servidor:
```bash
npm start
```

El servidor se iniciará en `http://localhost:3000`

### Probar Conexión con Shopify
Para probar la autenticación y conexión con Shopify:
```bash
npm run test:shopify
```

Este script verificará:
- ✅ Autenticación con Shopify
- ✅ Obtención de productos
- ✅ Información de inventario

### Sincronizar Stocks (CLI)

- Sincronizar un SKU (real):
```bash
node syncStocks.js ABC123
```

- Sincronizar un SKU en simulación (sin actualizar Shopify):
```bash
node syncStocks.js ABC123 --dry-run
```

- Sincronizar varios SKUs:
```bash
node syncStocks.js ABC123 DEF456 GHI789
```

- Sincronizar todos los SKUs (real):
```bash
node syncStocks.js --all --concurrency=5
```

- Simular todos los SKUs (recomendado para probar):
```bash
node syncStocks.js --all --dry-run --concurrency=5
```

#### Opciones útiles
- `--concurrency=N`          Concurrencia hacia Shopify (default 5, recomendado 3-10)
- `--dry-run`                No actualiza Shopify, solo muestra qué haría
- `--force`                  Actualiza aunque los stocks coincidan
- `--max-retries=N`          Reintentos automáticos (default 3)
- `--retry-delay=MS`         Pausa entre reintentos (default 2000)
- `--no-retry`               Desactiva reintentos
- `--manager-page-size=N`    Tamaño de página para precarga masiva desde Manager+ (default 200)
- `--no-manager-bulk`        Desactiva la precarga masiva y consulta SKU a SKU (más lento, más 429)

#### Notas de inventario
- El stock de Manager+ se carga en bloque con `con_stock=S` y se filtra solo “Bodega General”; las bodegas con “temporal” se descartan.
- Si el ERP no respeta `offset/limit`, la precarga se corta al detectar páginas repetidas; puedes bajar `--manager-page-size` o usar `--no-manager-bulk` como fallback.

### 🤖 Sincronización Automática (Scheduler)

El scheduler ejecuta la sincronización automáticamente todos los días a las **12:00 PM** y **6:00 PM** (hora de Santiago de Chile).

#### Iniciar el Scheduler:
```bash
npm run scheduler
```

O directamente:
```bash
node syncScheduler.js
```

#### Configuración del Scheduler:

El scheduler se puede configurar mediante variables de entorno en el archivo `.env`:

```env
# Concurrencia para sincronización automática (default: 5)
SYNC_CONCURRENCY=5

# Número máximo de reintentos (default: 3)
SYNC_MAX_RETRIES=3
```

#### Características:

- ⏰ **Ejecución programada**: Automática a las 12:00 PM y 6:00 PM
- 🌎 **Zona horaria**: Santiago de Chile (America/Santiago)
- 🔄 **Reintentos automáticos**: Si algún producto falla, se reintenta automáticamente
- 📝 **Logs detallados**: Muestra fecha, hora y resultados de cada sincronización
- 🛡️ **Manejo de errores**: Si una sincronización falla, el scheduler continúa funcionando
- 🔒 **Solo sincronización real**: No ejecuta dry-run, siempre actualiza los stocks

#### Mantener el Scheduler ejecutándose:

Para mantener el scheduler ejecutándose en un servidor, puedes usar:

**Con PM2** (recomendado):
```bash
npm install -g pm2
pm2 start syncScheduler.js --name sync-scheduler
pm2 save
pm2 startup
```

**Con systemd** (Linux):
Crear un servicio systemd que ejecute el scheduler como servicio del sistema.

**Con nohup**:
```bash
nohup node syncScheduler.js > scheduler.log 2>&1 &
```

#### Optimizaciones de rendimiento:

El sistema ahora está optimizado para ser **hasta 10x más rápido** con las siguientes mejoras:

- ⚡ **Procesamiento paralelo**: Procesa múltiples productos simultáneamente
- 🗂️ **Caché en memoria**: Pre-carga todos los productos de Shopify una sola vez
- 🎯 **Búsquedas rápidas**: Usa estructuras Map para acceso O(1) en lugar de búsquedas secuenciales
- 🔄 **Sin pausas innecesarias**: Elimina las pausas de 500ms entre productos

**Controlar concurrencia** (número de productos procesados en paralelo):
```bash
# Procesar 10 productos en paralelo (recomendado: 5-10)
node syncStocks.js --all --concurrency=10

# Simulación con alta concurrencia
npm run sync:dry-run -- --concurrency=10
```

**Nota**: Ajusta la concurrencia según la capacidad de tus APIs. Valores muy altos pueden causar rate limiting.

#### El proceso de sincronización optimizado:

1. 📦 **Pre-carga**: Obtiene todos los productos de Shopify en memoria (una sola vez)
2. 🔐 **Autenticación**: Obtiene tokens y ubicaciones una sola vez
3. ⚡ **Procesamiento paralelo**: Procesa productos en lotes simultáneos
4. 📥 **Comparación**: Obtiene stock de Manager+ y compara con caché de Shopify
5. 📤 **Actualización**: Actualiza solo los productos que necesitan cambios

## 🔌 Endpoints Disponibles

### GET `/health`
Verifica el estado del servidor.

### GET `/api/local/productos/:sku?`
Consulta productos del ERP.

**Parámetros:**
- `sku` (opcional): Código del producto específico

**Ejemplos:**
- `GET /api/local/productos` - Consulta todos los productos
- `GET /api/local/productos/ABC123` - Consulta un producto específico

### GET `/api/sync/stocks`
Sincroniza stocks desde Manager+ hacia Shopify.

**Parámetros:**
- `sku` (query): SKU específico a sincronizar
- `all` (query): Sincronizar todos los productos (`all=true`)
- `dryRun` (query): Simular sin hacer cambios reales (`dryRun=true`)

**Ejemplos:**
- `GET /api/sync/stocks?sku=ABC123` - Sincronizar un producto específico
- `GET /api/sync/stocks?all=true` - Sincronizar todos los productos
- `GET /api/sync/stocks?all=true&dryRun=true` - Simular sincronización de todos

### POST `/api/sync/stocks`
Sincroniza stocks de múltiples productos.

**Body:**
```json
{
  "skus": ["ABC123", "DEF456", "GHI789"],
  "dryRun": false
}
```

## 🔐 Autenticación

### ERP Manager+
El servidor maneja automáticamente la autenticación con el ERP Manager+:
- Se autentica al iniciar el servidor
- Renueva el token automáticamente cuando expira
- Almacena el token en memoria

### Shopify
La autenticación con Shopify se realiza mediante un Access Token que debes obtener desde tu panel de administración de Shopify:
1. Ve a Configuración > Apps y canales de venta > Desarrollar apps
2. Crea una app privada o usa una app existente
3. Genera un Access Token con los permisos necesarios:
   - `read_products` - Para leer productos
   - `write_products` - Para actualizar productos
   - `read_inventory` - Para leer inventario
   - `write_inventory` - Para actualizar inventario

## 📦 Tecnologías

- Node.js
- Express.js
- Axios
- Dotenv
- CORS

