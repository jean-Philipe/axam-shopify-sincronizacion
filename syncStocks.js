/**
 * Módulo de sincronización de stocks entre Manager+ y Shopify
 * 
 * Este módulo obtiene los stocks de productos desde Manager+ y los sincroniza
 * con Shopify, actualizando los valores de inventario.
 */

require('dotenv').config();
const axios = require('axios');
const { verifyShopifyAuth, getShopifyProductBySKU, updateShopifyInventory, SHOPIFY_BASE_URL } = require('./shopifyAuth');

// Variables de entorno
const ERP_BASE_URL = process.env.ERP_BASE_URL;
const ERP_USERNAME = process.env.ERP_USERNAME;
const ERP_PASSWORD = process.env.ERP_PASSWORD;
const RUT_EMPRESA = process.env.RUT_EMPRESA;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Helper para esperar sin bloquear
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Variable para almacenar el token de autenticación del ERP
let erpAuthToken = null;
let erpTokenExpirationTime = null;

// Caché para productos de Shopify (Mapa SKU -> datos del producto)
let shopifyProductsCache = null;

// Caché para locationId de Shopify
let shopifyLocationIdCache = null;

// Caché opcional de productos Manager+ para evitar múltiples llamadas por SKU
let managerProductsCache = null;

/**
 * Autenticarse con el ERP Manager+
 */
async function authenticateWithERP() {
    try {
        const response = await axios.post(`${ERP_BASE_URL}/auth/`, {
            username: ERP_USERNAME,
            password: ERP_PASSWORD
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        erpAuthToken = response.data.auth_token;
        erpTokenExpirationTime = Date.now() + (60 * 60 * 1000); // 1 hora
        
        return erpAuthToken;
    } catch (error) {
        console.error('❌ Error en la autenticación con el ERP:', error.response?.data || error.message);
        throw new Error('Error al autenticarse con el ERP: ' + (error.response?.data?.message || error.message));
    }
}

/**
 * Obtener el token de autenticación del ERP (con caché)
 */
async function getERPAuthToken() {
    if (erpAuthToken && erpTokenExpirationTime && Date.now() < erpTokenExpirationTime) {
        return erpAuthToken;
    }
    return await authenticateWithERP();
}


/**
 * Determina si un registro de stock pertenece a "Bodega General" y excluye "Bodega temporal".
 */
function isGeneralWarehouse(stockItem = {}) {
    const name = (
        stockItem.bodega ||
        stockItem.almacen ||
        stockItem.descripcion_bodega ||
        stockItem.nombre_bodega ||
        stockItem.bod ||
        ''
    ).toString().toLowerCase().trim();

    // Si no hay nombre de bodega, asumimos bodega general (evita descartar todo por falta de campo)
    if (!name) return true;

    if (name.includes('temporal')) return false;
    if (name.includes('general')) return true;

    // Fallback: incluir otras bodegas solo si no son temporales
    return !name.includes('temporal');
}

/**
 * Extraer stock de un producto desde la respuesta del endpoint de productos,
 * considerando únicamente la Bodega General y descartando bodegas temporales.
 * 
 * @param {Object} product - Objeto del producto de Manager+
 * @returns {number} Stock total del producto (solo Bodega General)
 */
function extractStockFromProduct(product) {
    let stock = 0;

    // El campo stock puede venir como array de arrays o directamente array de objetos
    const stockEntries = product.stock;
    if (!Array.isArray(stockEntries)) {
        return 0;
    }

    const processItem = (item) => {
        if (!item || typeof item !== 'object') return;
        if (!isGeneralWarehouse(item)) return;
        const saldo = item.saldo || 0;
        stock += parseFloat(saldo) || 0;
    };

    stockEntries.forEach(entry => {
        if (Array.isArray(entry)) {
            entry.forEach(processItem);
        } else {
            processItem(entry);
        }
    });

    return stock;
}

/**
 * Obtener stock de un producto desde Manager+ por SKU
 * 
 * Usa el endpoint de productos con con_stock=S para obtener el stock en la misma respuesta
 * 
 * @param {string} sku - Código SKU del producto
 * @returns {Promise<Object>} Información del producto con stock
 */
async function getManagerProductBySKU(sku, attempt = 1) {
    try {
        const token = await getERPAuthToken();
        
        // Usar el endpoint de productos con con_stock=S para obtener el stock
        const url = `${ERP_BASE_URL}/products/${RUT_EMPRESA}/${sku}/`;
        
        const response = await axios.get(url, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${token}`
            },
            params: {
                con_stock: 'S'  // Incluir stock detallado por producto
            }
        });

        const productData = response.data.data || response.data;
        
        if (!productData || (Array.isArray(productData) && productData.length === 0)) {
            return null;
        }

        // Si es un array, tomar el primer elemento
        const product = Array.isArray(productData) ? productData[0] : productData;
        
        // Extraer el stock del campo "stock" (array de arrays con campo "saldo")
        const stock = extractStockFromProduct(product);
        
        return {
            sku: product.codigo_prod || product.cod_producto || product.codigo || sku,
            nombre: product.nombre || product.descripcion || product.descrip || '',
            stock: stock,
            unidad: product.unidadstock || product.unidad || '',
            precio: product.precio || product.precio_unit || 0,
            rawData: product
        };
        
    } catch (error) {
        if (error.response?.status === 404) {
            return null; // Producto no encontrado
        }
        
        // Detectar rate limiting con reintentos y backoff simple
        if (error.response?.status === 429) {
            const retryAfterHeader = error.response?.headers?.['retry-after'];
            const retryMs = retryAfterHeader ? (parseInt(retryAfterHeader, 10) * 1000) : Math.min(5000, 1500 * attempt);
            
            if (attempt < 3) {
                console.warn(`⚠️  Rate limit en Manager+ para ${sku}. Reintentando en ${retryMs}ms (intento ${attempt + 1}/3)...`);
                await sleep(retryMs);
                return await getManagerProductBySKU(sku, attempt + 1);
            }
            
            throw new Error(`Rate limit alcanzado en Manager+ (429). Reduce la concurrencia.`);
        }
        
        // Detectar errores de servidor (puede ser sobrecarga)
        if (error.response?.status >= 500) {
            throw new Error(`Error del servidor Manager+ (${error.response.status}). Puede estar sobrecargado.`);
        }
        
        console.error(`   ❌ Error al obtener stock de ${sku} de Manager+: ${error.response?.data?.message || error.message}`);
        throw error;
    }
}

/**
 * Cargar todos los productos con stock desde Manager+ en forma paginada.
 * Esto permite evitar una llamada por SKU y reduce el riesgo de rate limiting.
 *
 * @param {Object} options
 * @param {number} options.pageSize - Tamaño de página (recomendado 200-300, máx. 500 si el ERP lo permite)
 * @param {number} options.pauseMs - Pausa entre páginas para no gatillar 429 (ms)
 * @param {boolean} options.useCache - Reusar resultado previo en memoria (default: false)
 * @param {boolean} options.forceReload - Ignorar caché aunque exista
 * @returns {Promise<Map<string, Object>>} Mapa SKU -> info de producto
 */
async function loadAllManagerProductsWithStock(options = {}) {
    const {
        pageSize = 200,
        pauseMs = 150,
        useCache = false,
        forceReload = false,
        maxPages = 200
    } = options;

    if (useCache && managerProductsCache && !forceReload) {
        return managerProductsCache;
    }

    const limit = Math.min(Math.max(1, pageSize), 500); // asegurar rango razonable
    const productMap = new Map();
    let offset = 0;
    let page = 0;
    let hasMore = true;

    console.log(`📥 Cargando productos desde Manager+ en páginas de ${limit}...`);

    try {
        const token = await getERPAuthToken();

        while (hasMore) {
            if (page >= maxPages) {
                console.warn(`⚠️  Se alcanzó el máximo de páginas (${maxPages}). Deteniendo precarga para evitar bucles.`);
                break;
            }

            const prevSize = productMap.size;
            const url = `${ERP_BASE_URL}/products/${RUT_EMPRESA}/`;
            const response = await axios.get(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Token ${token}`
                },
                params: {
                    con_stock: 'S',
                    limit,
                    offset
                }
            });

            const data = response.data.data || response.data || [];
            if (!Array.isArray(data) || data.length === 0) {
                hasMore = false;
                break;
            }

            data.forEach(product => {
                const stock = extractStockFromProduct(product);
                const sku = product.codigo_prod || product.cod_producto || product.codigo;
                if (!sku) return;
                productMap.set(sku, {
                    sku,
                    nombre: product.nombre || product.descripcion || product.descrip || '',
                    stock,
                    unidad: product.unidadstock || product.unidad || '',
                    precio: product.precio || product.precio_unit || 0,
                    rawData: product
                });
            });

            offset += data.length;
            page += 1;

            process.stdout.write(`\r   Página ${page} | Productos acumulados: ${productMap.size}   `);

            // Si no se agregaron nuevos SKUs, detener para evitar bucles
            if (productMap.size === prevSize) {
                console.warn(`\n⚠️  No se agregaron nuevos SKUs en la página ${page}. Posible paginación ignorada por el ERP. Deteniendo precarga.`);
                hasMore = false;
            } else if (data.length < limit) {
                hasMore = false;
            } else if (pauseMs > 0) {
                await sleep(pauseMs);
            }
        }

        process.stdout.write('\n');
        console.log(`✅ Stock de Manager+ cargado en memoria: ${productMap.size} SKUs\n`);

        managerProductsCache = productMap;
        return productMap;
    } catch (error) {
        console.error('\n❌ Error al cargar productos de Manager+ en bloque:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Pre-cargar todos los productos de Shopify en un Map para acceso rápido O(1)
 * 
 * @returns {Promise<Map<string, Object>>} Mapa de SKU -> datos del producto
 */
async function loadAllShopifyProducts() {
    if (shopifyProductsCache) {
        return shopifyProductsCache;
    }

    try {
        console.log('📦 Pre-cargando productos de Shopify en memoria...');
        const productMap = new Map();
        
        let hasMore = true;
        let nextUrl = null;

        while (hasMore) {
            let url = `${SHOPIFY_BASE_URL}/products.json`;
            
            if (nextUrl) {
                url = nextUrl;
            } else {
                // Primera petición - incluir parámetros
                url += '?limit=250&fields=id,title,variants';
            }

            const response = await axios.get(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });

            const products = response.data.products;
            
            if (!products || products.length === 0) {
                hasMore = false;
                break;
            }
            
            // Procesar cada producto y sus variantes
            // Nota: Cada variante con SKU se cuenta como un item sincronizable
            // porque cada variante tiene su propio stock independiente
            products.forEach(product => {
                product.variants.forEach(variant => {
                    if (variant.sku) {
                        // Si el SKU ya existe, mantener el primero (puede haber duplicados)
                        if (!productMap.has(variant.sku)) {
                            productMap.set(variant.sku, {
                                sku: variant.sku,
                                productId: product.id,
                                variantId: variant.id,
                                inventoryItemId: variant.inventory_item_id,
                                currentStock: variant.inventory_quantity !== null ? variant.inventory_quantity : 0,
                                productTitle: product.title
                            });
                        }
                    }
                });
            });
            
            // Si recibimos menos productos que el límite, no hay más páginas
            if (products.length < 250) {
                hasMore = false;
                break;
            }
            
            // Verificar si hay más páginas usando el header Link
            const linkHeader = response.headers.link;
            if (linkHeader && typeof linkHeader === 'string') {
                // Buscar el link "next"
                const links = linkHeader.split(',').map(link => link.trim());
                const nextLink = links.find(link => link.includes('rel="next"'));
                
                if (nextLink) {
                    // Extraer la URL del link (entre < y >)
                    const urlMatch = nextLink.match(/<([^>]+)>/);
                    if (urlMatch) {
                        nextUrl = urlMatch[1];
                        hasMore = true;
                    } else {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        }

        shopifyProductsCache = productMap;
        
        // Contar productos reales vs variantes para estadísticas
        const totalProducts = Array.from(productMap.values())
            .reduce((acc, item) => {
                if (!acc.has(item.productId)) {
                    acc.set(item.productId, item.productTitle);
                }
                return acc;
            }, new Map()).size;
        
        console.log(`✅ ${productMap.size} SKUs únicos (variantes) cargados en memoria`);
        console.log(`   📦 Productos: ${totalProducts} | 🏷️  Variantes con SKU: ${productMap.size}`);
        
        return productMap;
        
    } catch (error) {
        console.error('❌ Error al pre-cargar productos de Shopify:', error.message);
        throw error;
    }
}

/**
 * Obtener información de un producto desde Shopify por SKU (usando caché)
 * 
 * @param {string} sku - Código SKU del producto
 * @param {Map} productsMap - Mapa de productos (opcional, se carga automáticamente)
 * @returns {Promise<Object>} Información del producto con stock
 */
async function getShopifyProductStockBySKU(sku, productsMap = null) {
    try {
        // Si no se proporciona el mapa, cargarlo
        if (!productsMap) {
            productsMap = await loadAllShopifyProducts();
        }

        const product = productsMap.get(sku);
        return product || null;
        
    } catch (error) {
        console.error(`❌ Error al obtener producto ${sku} de Shopify:`, error.message);
        throw error;
    }
}

/**
 * Obtener el location_id de inventario de Shopify (con caché)
 * 
 * @returns {Promise<number>} ID de la ubicación de inventario
 */
async function getShopifyLocationId() {
    // Retornar caché si existe
    if (shopifyLocationIdCache) {
        return shopifyLocationIdCache;
    }

    try {
        const response = await axios.get(`${SHOPIFY_BASE_URL}/locations.json`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        const locations = response.data.locations;
        if (!locations || locations.length === 0) {
            throw new Error('No se encontraron ubicaciones de inventario en Shopify');
        }

        // Retornar la primera ubicación (puedes ajustar la lógica según necesites)
        shopifyLocationIdCache = locations[0].id;
        return shopifyLocationIdCache;
        
    } catch (error) {
        if (error.response?.status === 403) {
            const errorMsg = error.response?.data?.error || error.response?.data?.message || '';
            if (errorMsg.includes('read_locations')) {
                throw new Error('Falta el permiso read_locations en tu app de Shopify. Ve a Configuration → Admin API integration y agrega el permiso read_locations, luego reinstala la app.');
            }
        }
        console.error('❌ Error al obtener ubicaciones de Shopify:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Actualizar el stock de un producto en Shopify
 * 
 * @param {number} inventoryItemId - ID del item de inventario
 * @param {number} locationId - ID de la ubicación
 * @param {number} quantity - Nueva cantidad de stock
 * @returns {Promise<Object>} Respuesta de la actualización
 */
async function updateShopifyStock(inventoryItemId, locationId, quantity) {
    try {
        const response = await axios.post(
            `${SHOPIFY_BASE_URL}/inventory_levels/set.json`,
            {
                location_id: locationId,
                inventory_item_id: inventoryItemId,
                available: quantity
            },
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
        
    } catch (error) {
        // Detectar rate limiting de Shopify
        if (error.response?.status === 429) {
            const retryAfter = error.response.headers['retry-after'];
            const message = retryAfter 
                ? `Rate limit de Shopify alcanzado. Espera ${retryAfter} segundos antes de continuar.`
                : `Rate limit de Shopify alcanzado (429). Reduce la concurrencia o espera un momento.`;
            throw new Error(message);
        }
        
        // Detectar errores de servidor
        if (error.response?.status >= 500) {
            throw new Error(`Error del servidor Shopify (${error.response.status}). Puede estar sobrecargado.`);
        }
        
        console.error('❌ Error al actualizar stock en Shopify:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Sincronizar el stock de un producto específico (optimizado con caché)
 * 
 * @param {string} sku - Código SKU del producto
 * @param {Object} options - Opciones de sincronización
 * @param {Map} shopifyProductsMap - Mapa de productos de Shopify (opcional)
 * @param {number} locationId - ID de ubicación (opcional, se obtiene si no se proporciona)
 * @returns {Promise<Object>} Resultado de la sincronización
 */
async function syncProductStock(sku, options = {}, shopifyProductsMap = null, locationId = null, managerProductsMap = null) {
    const { dryRun = false, forceUpdate = false } = options;
    
    try {
        // 1. Obtener stock de Manager+
        let managerProduct = null;
        try {
            if (managerProductsMap && managerProductsMap.has(sku)) {
                managerProduct = managerProductsMap.get(sku);
            } else {
                managerProduct = await getManagerProductBySKU(sku);
            }
        } catch (error) {
            return {
                sku,
                success: false,
                error: error.message,
                action: 'error'
            };
        }
        
        if (!managerProduct) {
            return {
                sku,
                success: false,
                error: 'Producto no encontrado en Manager+',
                action: 'skipped'
            };
        }
        
        // 2. Obtener stock de Shopify (usando caché si está disponible)
        const shopifyProduct = await getShopifyProductStockBySKU(sku, shopifyProductsMap);
        
        if (!shopifyProduct) {
            return {
                sku,
                success: false,
                error: 'Producto no encontrado en Shopify',
                action: 'skipped'
            };
        }
        
        // 3. Comparar stocks
        const managerStock = parseInt(managerProduct.stock) || 0;
        const shopifyStock = shopifyProduct.currentStock;
        
        if (managerStock === shopifyStock && !forceUpdate) {
            return {
                sku,
                success: true,
                action: 'no_change',
                managerStock,
                shopifyStock,
                message: 'Stocks ya están sincronizados'
            };
        }
        
        // 4. Actualizar stock en Shopify
        if (dryRun) {
            return {
                sku,
                success: true,
                action: 'would_update',
                managerStock,
                shopifyStock,
                newStock: managerStock,
                message: 'Dry run: no se realizaron cambios'
            };
        }
        
        // Obtener locationId si no se proporciona
        if (!locationId) {
            locationId = await getShopifyLocationId();
        }
        
        await updateShopifyStock(
            shopifyProduct.inventoryItemId,
            locationId,
            managerStock
        );
        
        return {
            sku,
            success: true,
            action: 'updated',
            managerStock,
            shopifyStock,
            newStock: managerStock,
            message: 'Stock actualizado exitosamente'
        };
        
    } catch (error) {
        return {
            sku,
            success: false,
            error: error.message,
            action: 'error'
        };
    }
}

/**
 * Procesar un array en chunks con límite de concurrencia
 * 
 * @param {Array} array - Array a procesar
 * @param {Function} processor - Función que procesa cada elemento
 * @param {number} concurrency - Número máximo de operaciones paralelas
 * @returns {Promise<Array>} Resultados del procesamiento
 */
async function processInParallel(array, processor, concurrency = 5) {
    const results = [];
    let rateLimitErrors = 0;
    const MAX_RATE_LIMIT_ERRORS = 5; // Máximo de errores de rate limit antes de reducir concurrencia
    
    for (let i = 0; i < array.length; i += concurrency) {
        const chunk = array.slice(i, i + concurrency);
        
        try {
            const chunkResults = await Promise.all(chunk.map(processor));
            results.push(...chunkResults);
            
            // Contar errores de rate limiting en este chunk
            const chunkRateLimitErrors = chunkResults.filter(r => 
                r?.error && (r.error.includes('Rate limit') || r.error.includes('429'))
            ).length;
            
            rateLimitErrors += chunkRateLimitErrors;
            
            // Ajuste automático de concurrencia ante rate limiting
            if (chunkRateLimitErrors > 0) {
                const newConcurrency = Math.max(1, Math.floor(concurrency / 2));
                const backoffMs = Math.min(10000, 1500 + (rateLimitErrors * 500));
                
                if (newConcurrency < concurrency) {
                    console.warn(`\n⚠️  Rate limit detectado en el último lote (${chunkRateLimitErrors} casos).`);
                    console.warn(`   Bajando concurrencia de ${concurrency} a ${newConcurrency} y esperando ${backoffMs}ms...\n`);
                    concurrency = newConcurrency;
                } else {
                    console.warn(`\n⚠️  Rate limit detectado en el último lote (${chunkRateLimitErrors} casos). Esperando ${backoffMs}ms...\n`);
                }
                
                await sleep(backoffMs);
            }
            
            // Si hay muchos errores de rate limiting acumulados, mantener aviso
            if (rateLimitErrors >= MAX_RATE_LIMIT_ERRORS) {
                console.warn(`\n⚠️  Se detectaron múltiples errores de rate limiting (${rateLimitErrors}).`);
                console.warn(`   La concurrencia actual es ${concurrency}. Considera reducirla manualmente si persiste.\n`);
            }
            
        } catch (error) {
            // Si es un error de rate limit global, esperar un poco y continuar
            if (error.message && error.message.includes('Rate limit')) {
                console.warn(`\n⚠️  Rate limit detectado. Esperando 2 segundos antes de continuar...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                // Continuar con el siguiente chunk (los errores individuales ya están en los resultados)
            } else {
                throw error;
            }
        }
        
        // Mostrar progreso
        const processed = Math.min(i + concurrency, array.length);
        process.stdout.write(`\r   Procesando: ${processed}/${array.length} productos... \n`);
    }
    
    process.stdout.write('\n');
    return results;
}

/**
 * Sincronizar stocks de múltiples productos (optimizado con procesamiento paralelo)
 * 
 * @param {Array<string>} skus - Array de códigos SKU
 * @param {Object} options - Opciones de sincronización
 * @returns {Promise<Object>} Resumen de la sincronización
 */
async function syncMultipleProducts(skus, options = {}) {
    const results = {
        total: skus.length,
        updated: 0,
        skipped: 0,
        errors: 0,
        noChange: 0,
        details: []
    };
    
    // Validar y limitar concurrencia
    let concurrency = options.concurrency || 5;
    const MAX_RECOMMENDED_CONCURRENCY = 20;
    const ABSOLUTE_MAX_CONCURRENCY = 50;
    
    if (concurrency > ABSOLUTE_MAX_CONCURRENCY) {
        console.warn(`⚠️  Advertencia: Concurrencia de ${concurrency} es muy alta. Limitando a ${ABSOLUTE_MAX_CONCURRENCY}`);
        concurrency = ABSOLUTE_MAX_CONCURRENCY;
    } else if (concurrency > MAX_RECOMMENDED_CONCURRENCY) {
        console.warn(`⚠️  Advertencia: Concurrencia de ${concurrency} es alta. Puede causar rate limiting.`);
        console.warn(`   Recomendado: 5-10 para evitar problemas con las APIs.\n`);
    }
    
    console.log(`\n🚀 Iniciando sincronización optimizada de ${skus.length} SKUs`);
    console.log(`⚡ Concurrencia: ${concurrency} SKUs en paralelo\n`);
    console.log('='.repeat(60));
    
    const startTime = Date.now();
    
    try {
        // Verificar autenticación con Shopify primero
        await verifyShopifyAuth();
        
        // Pre-cargar productos de Shopify en memoria (una sola vez)
        console.log('📦 Pre-cargando datos...');
        const shopifyProductsMap = await loadAllShopifyProducts();

        // Pre-cargar productos de Manager+ en bloque para evitar 1 llamada por SKU (si está habilitado)
        let managerProductsMap = null;
        const useManagerBulk = options.useManagerBulk !== false;
        if (useManagerBulk) {
            try {
                const pageSize = options.managerPageSize || 200;
                const pauseMs = options.managerPagePauseMs || 150;
                managerProductsMap = await loadAllManagerProductsWithStock({
                    pageSize,
                    pauseMs,
                    useCache: false
                });
            } catch (error) {
                console.warn('⚠️  No se pudo precargar Manager+ en bloque. Se usará fallback por SKU.');
                console.warn(`   Detalle: ${error.message}`);
            }
        }
        
        // Obtener locationId una sola vez (si no es dry-run)
        let locationId = null;
        if (!options.dryRun) {
            locationId = await getShopifyLocationId();
        }
        
        console.log('\n🔄 Iniciando sincronización paralela...\n');
        
        // Procesar productos en paralelo con límite de concurrencia
        const processedResults = await processInParallel(
            skus,
            async (sku) => {
                try {
                    const result = await syncProductStock(sku, options, shopifyProductsMap, locationId, managerProductsMap);
                    
                    // Mostrar resultado solo si hay algo relevante
                    if (result.action === 'updated' || result.action === 'would_update') {
                        console.log(`   ✅ ${sku}: ${result.shopifyStock} → ${result.managerStock}`);
                    } else if (result.action === 'error') {
                        console.log(`   ❌ ${sku}: ${result.error}`);
                    }
                    
                    return result;
                } catch (error) {
                    return {
                        sku,
                        success: false,
                        error: error.message,
                        action: 'error'
                    };
                }
            },
            concurrency
        );
        
        results.details = processedResults;
        
        // Procesar resultados
        results.details.forEach(result => {
            if (result.success) {
                if (result.action === 'updated' || result.action === 'would_update') {
                    results.updated++;
                } else if (result.action === 'no_change') {
                    results.noChange++;
                } else {
                    results.skipped++;
                }
            } else {
                results.errors++;
            }
        });
        
        // ========== REINTENTOS AUTOMÁTICOS ==========
        // Identificar productos que fallaron por errores recuperables
        const failedProducts = results.details.filter(r => 
            !r.success && 
            r.action === 'error' &&
            // Solo reintentar errores recuperables (no productos no encontrados)
            r.error && 
            !r.error.includes('no encontrado') &&
            !r.error.includes('skipped')
        );
        
        if (failedProducts.length > 0 && !options.dryRun) {
            const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
            const retryDelay = options.retryDelay !== undefined ? options.retryDelay : 2000; // 2 segundos
            
            console.log(`\n🔄 Reintentando ${failedProducts.length} productos que fallaron...`);
            console.log(`   Intentos máximos: ${maxRetries}`);
            console.log(`   Retraso entre intentos: ${retryDelay}ms\n`);
            
            // Esperar un poco antes de reintentar (para que las APIs se recuperen)
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
            let retryAttempt = 1;
            let remainingFailures = [...failedProducts];
            const retryResults = [];
            
            while (remainingFailures.length > 0 && retryAttempt <= maxRetries) {
                console.log(`\n🔄 Intento ${retryAttempt}/${maxRetries} de reintento...`);
                
                // Reintentar con menor concurrencia para evitar más rate limits
                const retryConcurrency = Math.max(2, Math.floor(concurrency / 2));
                const failedSkus = remainingFailures.map(r => r.sku);
                
                const retryProcessedResults = await processInParallel(
                    failedSkus,
                    async (sku) => {
                        try {
                            const result = await syncProductStock(sku, options, shopifyProductsMap, locationId, managerProductsMap);
                            
                            if (result.success) {
                                console.log(`   ✅ Reintento exitoso: ${sku}`);
                            }
                            
                            return result;
                        } catch (error) {
                            return {
                                sku,
                                success: false,
                                error: error.message,
                                action: 'error'
                            };
                        }
                    },
                    retryConcurrency
                );
                
                retryResults.push(...retryProcessedResults);
                
                // Actualizar resultados originales y contadores
                retryProcessedResults.forEach(retryResult => {
                    const originalIndex = results.details.findIndex(r => r.sku === retryResult.sku);
                    if (originalIndex !== -1) {
                        const originalResult = results.details[originalIndex];
                        const wasError = !originalResult.success && originalResult.action === 'error';
                        
                        // Actualizar el resultado
                        results.details[originalIndex] = retryResult;
                        
                        if (retryResult.success && wasError) {
                            // Cambiar de error a éxito - actualizar contadores
                            results.errors--;
                            if (retryResult.action === 'updated' || retryResult.action === 'would_update') {
                                results.updated++;
                            } else if (retryResult.action === 'no_change') {
                                results.noChange++;
                            } else if (retryResult.action === 'skipped') {
                                results.skipped++;
                            }
                        }
                        // Si sigue fallando, el error ya está contado, no hacer nada
                    }
                });
                
                // Identificar qué productos todavía fallaron
                remainingFailures = retryProcessedResults.filter(r => 
                    !r.success && 
                    r.action === 'error' &&
                    r.error && 
                    !r.error.includes('no encontrado') &&
                    !r.error.includes('skipped')
                );
                
                if (remainingFailures.length > 0 && retryAttempt < maxRetries) {
                    console.log(`   ⚠️  ${remainingFailures.length} productos aún fallan. Esperando ${retryDelay}ms antes del próximo intento...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
                
                retryAttempt++;
            }
            
            if (remainingFailures.length > 0) {
                console.log(`\n⚠️  Después de ${maxRetries} intentos, ${remainingFailures.length} productos aún fallan:`);
                remainingFailures.forEach(failure => {
                    console.log(`   ❌ ${failure.sku}: ${failure.error}`);
                });
            } else {
                console.log(`\n✅ Todos los productos fallidos fueron actualizados exitosamente después de los reintentos.`);
            }
        }
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 Resumen final de sincronización:');
        console.log(`   ✅ Actualizados: ${results.updated}`);
        console.log(`   ℹ️  Sin cambios: ${results.noChange}`);
        console.log(`   ⏭️  Omitidos: ${results.skipped}`);
        console.log(`   ❌ Errores finales: ${results.errors}`);
        console.log(`   ⏱️  Tiempo total: ${duration}s`);
        console.log(`   ⚡ Velocidad: ${(results.total / duration).toFixed(2)} productos/segundo`);
        console.log('='.repeat(60));
        
        return results;
        
    } catch (error) {
        console.error('\n❌ Error fatal en sincronización:', error.message);
        throw error;
    }
}

/**
 * Obtener todos los SKUs de productos de Shopify y sincronizarlos (optimizado)
 * 
 * @param {Object} options - Opciones de sincronización
 * @returns {Promise<Object>} Resumen de la sincronización
 */
async function syncAllProducts(options = {}) {
    try {
        // Pre-cargar productos de Shopify (esto también extrae los SKUs)
        const shopifyProductsMap = await loadAllShopifyProducts();
        
        // Extraer SKUs del mapa
        const skus = Array.from(shopifyProductsMap.keys());
        
        // Contar productos reales para estadísticas
        const totalProducts = Array.from(shopifyProductsMap.values())
            .reduce((acc, item) => {
                if (!acc.has(item.productId)) {
                    acc.set(item.productId, true);
                }
                return acc;
            }, new Map()).size;
        
        console.log(`✅ Sincronizando ${skus.length} SKUs únicos (de ${totalProducts} productos)\n`);
        
        return await syncMultipleProducts(skus, options);
        
    } catch (error) {
        console.error('❌ Error al obtener productos de Shopify:', error.message);
        throw error;
    }
}

// Exportar funciones
module.exports = {
    syncProductStock,
    syncMultipleProducts,
    syncAllProducts,
    getManagerProductBySKU,
    getShopifyProductStockBySKU
};

// Si se ejecuta directamente, procesar argumentos de línea de comandos
if (require.main === module) {
    const args = process.argv.slice(2);
    
    // Extraer opciones
    const options = {
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force'),
        all: args.includes('--all')
    };
    
    // Extraer concurrencia si se especifica (--concurrency=10)
    const concurrencyArg = args.find(arg => arg.startsWith('--concurrency='));
    if (concurrencyArg) {
        const concurrencyValue = parseInt(concurrencyArg.split('=')[1]);
        if (!isNaN(concurrencyValue) && concurrencyValue > 0) {
            options.concurrency = concurrencyValue;
        }
    }
    
    // Extraer maxRetries si se especifica (--max-retries=3)
    const maxRetriesArg = args.find(arg => arg.startsWith('--max-retries='));
    if (maxRetriesArg) {
        const maxRetriesValue = parseInt(maxRetriesArg.split('=')[1]);
        if (!isNaN(maxRetriesValue) && maxRetriesValue >= 0) {
            options.maxRetries = maxRetriesValue;
        }
    }
    
    // Extraer retryDelay si se especifica (--retry-delay=2000)
    const retryDelayArg = args.find(arg => arg.startsWith('--retry-delay='));
    if (retryDelayArg) {
        const retryDelayValue = parseInt(retryDelayArg.split('=')[1]);
        if (!isNaN(retryDelayValue) && retryDelayValue > 0) {
            options.retryDelay = retryDelayValue;
        }
    }
    
    // Desactivar reintentos si se especifica --no-retry
    if (args.includes('--no-retry')) {
        options.maxRetries = 0;
    }

    // Desactivar precarga masiva de Manager+ si se especifica --no-manager-bulk
    if (args.includes('--no-manager-bulk')) {
        options.useManagerBulk = false;
    }

    // Tamaño de página para precarga masiva de Manager+ (--manager-page-size=200)
    const managerPageSizeArg = args.find(arg => arg.startsWith('--manager-page-size='));
    if (managerPageSizeArg) {
        const pageSizeValue = parseInt(managerPageSizeArg.split('=')[1]);
        if (!isNaN(pageSizeValue) && pageSizeValue > 0) {
            options.managerPageSize = pageSizeValue;
        }
    }
    
    // Si no hay argumentos o solo hay opciones, mostrar ayuda
    if (args.length === 0 || (args.length === 1 && args[0].startsWith('--'))) {
        if (!options.all) {
            console.log(`
📦 Sincronización de Stocks Manager+ → Shopify (Optimizado)

Uso:
  node syncStocks.js [SKU1] [SKU2] ... [SKUn]        - Sincronizar productos específicos
  node syncStocks.js --all                            - Sincronizar todos los productos
  node syncStocks.js --all --dry-run                  - Simular sincronización sin cambios

Opciones:
  --dry-run                 Simular sin hacer cambios reales
  --force                   Forzar actualización incluso si los stocks son iguales
  --concurrency=N           Número de productos a procesar en paralelo (default: 5)
                            Recomendado: 5-10 para no sobrecargar las APIs
                            Máximo permitido: 50
  --max-retries=N           Número máximo de reintentos automáticos (default: 3)
                            Se reintentan automáticamente los productos que fallan
                            Por defecto: 3 intentos adicionales
  --retry-delay=N           Milisegundos de espera entre reintentos (default: 2000)
  --no-retry                Desactivar reintentos automáticos
  --no-manager-bulk         No precargar productos de Manager+ en bloque (usa 1 llamada por SKU)
  --manager-page-size=N     Tamaño de página para precarga masiva de Manager+ (default: 200)

⚠️  IMPORTANTE - Concurrencia Alta:

Si pones una concurrencia muy grande (ej: --concurrency=50 o más):

1. ❌ Rate Limiting (429):
   - Shopify permite ~40 peticiones por segundo por app
   - Manager+ tiene límites propios (depende de tu plan)
   - Errores: "Rate limit alcanzado" o código HTTP 429
   - Solución: Reduce la concurrencia o espera entre lotes

2. ❌ Sobre Carga del Servidor:
   - Errores HTTP 500 (error del servidor)
   - Timeouts y conexiones rechazadas
   - Puede bloquear temporalmente tu acceso

3. ❌ Consumo de Recursos:
   - Más memoria RAM usada
   - Más conexiones de red simultáneas
   - Puede afectar el rendimiento del sistema

4. ✅ Recomendaciones:
   - Para pruebas: 3-5
   - Producción: 5-10
   - Solo si sabes que tu API lo soporta: 15-20
   - NUNCA más de 50 (límite del sistema)

🔄 REINTENTOS AUTOMÁTICOS:

Por defecto, el sistema reintenta automáticamente los productos que fallan:
  - Se reintentan solo errores recuperables (rate limits, errores temporales del servidor)
  - NO se reintentan productos no encontrados o saltados
  - Máximo 3 intentos adicionales por defecto
  - Espera 2 segundos entre cada intento
  - Usa menor concurrencia en reintentos para evitar más rate limits

Ejemplos:
  node syncStocks.js --all --dry-run --concurrency=10
  node syncStocks.js ABC123 DEF456 --concurrency=3
  node syncStocks.js --all --max-retries=5 --retry-delay=3000
  node syncStocks.js --all --no-retry  # Sin reintentos automáticos
            `);
            process.exit(0);
        }
    }
    
    // Función principal
    async function main() {
        try {
            if (options.all) {
                // Sincronizar todos los productos
                await syncAllProducts(options);
            } else {
                // Sincronizar SKUs específicos
                const skus = args.filter(arg => !arg.startsWith('--'));
                if (skus.length === 0) {
                    console.error('❌ Error: Debes proporcionar al menos un SKU o usar --all');
                    process.exit(1);
                }
                await syncMultipleProducts(skus, options);
            }
        } catch (error) {
            console.error('❌ Error fatal:', error.message);
            process.exit(1);
        }
    }
    
    main();
}

