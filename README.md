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

### Sincronizar Stocks

#### Sincronizar un producto específico:
```bash
node syncStocks.js ABC123
```

#### Sincronizar múltiples productos:
```bash
node syncStocks.js ABC123 DEF456 GHI789
```

#### Sincronizar todos los productos:
```bash
npm run sync:all
```

#### Simular sincronización (sin hacer cambios):
```bash
npm run sync:dry-run
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

