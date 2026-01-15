/**
 * Módulo de sincronización de precios entre Manager+ y Shopify
 * 
 * Este módulo obtiene los precios de productos desde Manager+ (lista 652)
 * y los sincroniza con Shopify, actualizando los valores de precio.
 */

require('dotenv').config();
const axios = require('axios');
const { verifyShopifyAuth, SHOPIFY_BASE_URL } = require('./shopifyAuth');

// Variables de entorno
const ERP_BASE_URL = process.env.ERP_BASE_URL;
const ERP_USERNAME = process.env.ERP_USERNAME;
const ERP_PASSWORD = process.env.ERP_PASSWORD;
const RUT_EMPRESA = process.env.RUT_EMPRESA;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;

// Validar variables de entorno críticas
function validateEnvironment() {
    const missing = [];
    
    if (!ERP_BASE_URL) missing.push('ERP_BASE_URL');
    if (!ERP_USERNAME) missing.push('ERP_USERNAME');
    if (!ERP_PASSWORD) missing.push('ERP_PASSWORD');
    if (!RUT_EMPRESA) missing.push('RUT_EMPRESA');
    if (!SHOPIFY_ACCESS_TOKEN) missing.push('SHOPIFY_ACCESS_TOKEN');
    if (!SHOPIFY_SHOP_DOMAIN) missing.push('SHOPIFY_SHOP_DOMAIN');
    
    if (missing.length > 0) {
        console.error('❌ Error: Faltan variables de entorno requeridas:');
        missing.forEach(env => {
            console.error(`   - ${env}`);
        });
        console.error('\n💡 Solución:');
        console.error('   Verifica que tu archivo .env contenga todas las variables necesarias.');
        console.error('   Ejemplo de variables requeridas:');
        console.error('   - ERP_BASE_URL=https://tu-erp.com');
        console.error('   - ERP_USERNAME=tu_usuario');
        console.error('   - ERP_PASSWORD=tu_password');
        console.error('   - RUT_EMPRESA=12345678-9');
        console.error('   - SHOPIFY_ACCESS_TOKEN=tu_token');
        console.error('   - SHOPIFY_SHOP_DOMAIN=tu-tienda.myshopify.com');
        process.exit(1);
    }
    
    // Validar que SHOPIFY_BASE_URL se haya construido correctamente
    if (!SHOPIFY_BASE_URL || SHOPIFY_BASE_URL.includes('undefined')) {
        console.error('❌ Error: SHOPIFY_BASE_URL no está configurado correctamente.');
        console.error(`   Valor actual: ${SHOPIFY_BASE_URL}`);
        console.error('   Verifica que SHOPIFY_SHOP_DOMAIN esté configurado en .env');
        process.exit(1);
    }
}

// Variable para almacenar el token de autenticación del ERP
let erpAuthToken = null;
let erpTokenExpirationTime = null;

// Caché para productos de Shopify (Mapa SKU -> datos del producto con precio)
let shopifyProductsCache = null;

// Caché de listas de precios cargadas (evita recargar en cada sincronización)
let priceListsCache = null;
let priceListsCacheTime = null;
const PRICE_LISTS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

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
 * Cargar todas las listas de precios desde Manager+ con sus productos
 * Usa el endpoint /price-list/{rut_empresa}/?dets=1 que devuelve todas las listas con productos
 * 
 * @returns {Promise<Map<string, Map<string, number>>>} Mapa de listaId -> Map(SKU -> precio)
 */
async function loadAllPriceLists() {
    // Verificar caché
    if (priceListsCache && priceListsCacheTime && (Date.now() - priceListsCacheTime) < PRICE_LISTS_CACHE_DURATION) {
        return priceListsCache;
    }

    try {
        const token = await getERPAuthToken();
        console.log('📋 Cargando listas de precios desde Manager+...');
        
        // Construir URL - el endpoint correcto es /pricelist/ (sin guión)
        const url = `${ERP_BASE_URL}/pricelist/${RUT_EMPRESA}/`;
        console.log(`   URL: ${url}?dets=1`);
        
        // Usar el endpoint correcto: /pricelist/{rut_empresa}/?dets=1
        const response = await axios.get(
            url,
            {
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    dets: 1  // Incluir productos en la respuesta
                },
                validateStatus: (status) => status < 500
            }
        );

        // Log de depuración
        if (response.status !== 200) {
            console.error(`   ⚠️  Status code: ${response.status}`);
            console.error(`   ⚠️  Response: ${JSON.stringify(response.data, null, 2)}`);
            throw new Error(`Error HTTP ${response.status} al obtener listas de precios`);
        }

        // Verificar estructura de respuesta
        if (!response.data) {
            throw new Error('Respuesta vacía del servidor Manager+');
        }

        // Algunas APIs pueden no tener el campo 'retorno', verificar directamente 'data'
        let priceListsData = null;
        if (response.data.retorno === true || response.data.retorno === undefined) {
            // Si retorno es true o undefined, intentar obtener data
            priceListsData = response.data.data || response.data;
        } else {
            console.error(`   ⚠️  retorno=false en respuesta`);
            console.error(`   ⚠️  Response completa: ${JSON.stringify(response.data, null, 2)}`);
            throw new Error(`El servidor devolvió retorno=false: ${response.data.mensaje || response.data.message || 'Sin mensaje'}`);
        }

        if (!priceListsData) {
            console.error(`   ⚠️  No hay datos en la respuesta`);
            console.error(`   ⚠️  Response completa: ${JSON.stringify(response.data, null, 2)}`);
            throw new Error('No se encontraron datos de listas de precios en la respuesta');
        }

        // Asegurarnos de que es un array
        if (!Array.isArray(priceListsData)) {
            console.error(`   ⚠️  Los datos no son un array`);
            console.error(`   ⚠️  Tipo: ${typeof priceListsData}`);
            console.error(`   ⚠️  Contenido: ${JSON.stringify(priceListsData, null, 2)}`);
            throw new Error('Los datos de listas de precios no son un array');
        }

        const priceListsMap = new Map(); // Map<listaId, Map<SKU, precio>>

        // Procesar cada lista de precios
        for (const lista of priceListsData) {
            // El ID puede ser numérico o string, normalizar a string para comparación
            const listaId = lista.id?.toString() || '';
            const listName = lista.listName || lista.nombre || '';
            const productsMap = new Map(); // Map<SKU, precio>

            // Procesar productos de esta lista
            if (Array.isArray(lista.products)) {
                for (const product of lista.products) {
                    // Según la respuesta de la API, el SKU está en el campo 'cod'
                    // Intentar diferentes campos para el SKU (priorizar cod)
                    const sku = product.cod || product.sku || product.codigo || product.codigo_prod || product.name || '';
                    const precio = product.price || product.precio || null;

                    if (sku && precio !== null && precio !== undefined && !isNaN(parseFloat(precio))) {
                        // Normalizar SKU (quitar espacios, convertir a string, mayúsculas)
                        const normalizedSku = sku.toString().trim().toUpperCase();
                        if (normalizedSku) {
                            productsMap.set(normalizedSku, parseFloat(precio));
                        }
                    }
                }
            }
            
            if (productsMap.size > 0) {
                // Guardar por ID
                priceListsMap.set(listaId, productsMap);
                
                // También intentar mapear por nombre si el ID no es "652" pero el nombre lo sugiere
                if (listName && (listName.includes('652') || listName.includes('Lista Precios 652'))) {
                    if (!priceListsMap.has('652')) {
                        priceListsMap.set('652', productsMap);
                    }
                }
                
                // Log de depuración para lista 652
                if (listaId === '652' || listName.includes('652')) {
                    console.log(`   Lista ${listaId} (${listName || 'sin nombre'}): ${productsMap.size} productos cargados`);
                }
            }
        }

        // Guardar en caché
        priceListsCache = priceListsMap;
        priceListsCacheTime = Date.now();

        const totalProducts = Array.from(priceListsMap.values()).reduce((sum, map) => sum + map.size, 0);
        console.log(`✅ ${priceListsMap.size} listas de precios cargadas con ${totalProducts} productos totales`);
        
        // Verificar que exista la lista 652
        if (!priceListsMap.has('652')) {
            console.warn(`⚠️  Lista de precios 652 no encontrada. Verifica que exista en Manager+.`);
        }

        return priceListsMap;

    } catch (error) {
        if (error.response) {
            console.error('❌ Error HTTP al cargar listas de precios:');
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`❌ Error al cargar listas de precios: ${error.message}`);
        }
        
        // Si el error ya tiene un mensaje descriptivo, usarlo; si no, crear uno genérico
        if (error.message && !error.message.includes('Error al cargar')) {
            throw error;
        }
        throw new Error(`Error al cargar listas de precios: ${error.message}`);
    }
}

/**
 * Obtener precio de un producto desde Manager+ (lista 652)
 * 
 * @param {string} sku - Código SKU del producto
 * @param {Map<string, Map<string, number>>} priceListsMap - Mapa de listas de precios (opcional, se carga si no se proporciona)
 * @returns {Promise<{precio: number|null, listaUsada: string|null, error: string|null}>}
 */
async function getManagerProductPrice(sku, priceListsMap = null) {
    try {
        // Normalizar SKU (mayúsculas, sin espacios)
        const normalizedSku = sku.toString().trim().toUpperCase();
        
        // Si no se proporciona el mapa, cargarlo
        if (!priceListsMap) {
            priceListsMap = await loadAllPriceLists();
        }

        // Buscar en lista 652
        const lista652 = priceListsMap.get('652');
        if (lista652 && lista652.has(normalizedSku)) {
            const precio = lista652.get(normalizedSku);
            return { precio, listaUsada: '652', error: null };
        }

        // No encontrado en lista 652
        return { precio: null, listaUsada: null, error: 'Sin precio en lista 652' };
        
    } catch (error) {
        if (error.response?.status === 404) {
            return { precio: null, listaUsada: null, error: 'Producto no encontrado en Manager+' };
        }
        
        // Detectar rate limiting
        if (error.response?.status === 429) {
            throw new Error(`Rate limit alcanzado en Manager+ (429). Reduce la concurrencia.`);
        }
        
        // Detectar errores de servidor
        if (error.response?.status >= 500) {
            throw new Error(`Error del servidor Manager+ (${error.response.status}). Puede estar sobrecargado.`);
        }
        
        console.error(`   ❌ Error al obtener precio de ${sku} de Manager+: ${error.response?.data?.message || error.message}`);
        throw error;
    }
}

/**
 * Pre-cargar todos los productos de Shopify en un Map para acceso rápido O(1)
 * Incluye información de precio actual
 * 
 * @returns {Promise<Map<string, Object>>} Mapa de SKU -> datos del producto con precio
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
                // Primera petición - incluir parámetros para obtener precios
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
            products.forEach(product => {
                product.variants.forEach(variant => {
                    if (variant.sku) {
                        // Normalizar SKU
                        const normalizedSku = variant.sku.toString().trim().toUpperCase();
                        
                        // Si el SKU ya existe, mantener el primero (puede haber duplicados)
                        if (!productMap.has(normalizedSku)) {
                            productMap.set(normalizedSku, {
                                sku: normalizedSku,
                                productId: product.id,
                                variantId: variant.id,
                                currentPrice: parseFloat(variant.price) || 0,
                                title: product.title,
                                variantTitle: variant.title
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
        
        console.log(`✅ ${productMap.size} SKUs únicos cargados en memoria`);
        
        return productMap;
        
    } catch (error) {
        console.error('\n❌ Error al pre-cargar productos de Shopify:');
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Mensaje: ${JSON.stringify(error.response.data, null, 2)}`);
            if (error.response.status === 401) {
                console.error('\n   💡 Solución:');
                console.error('   1. Verifica que SHOPIFY_ACCESS_TOKEN esté configurado en .env');
                console.error('   2. Verifica que SHOPIFY_SHOP_DOMAIN esté configurado');
                console.error('   3. Ejecuta: node shopifyAuth.js para verificar la autenticación\n');
            }
        } else {
            console.error(`   Error: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Obtener información de un producto desde Shopify por SKU (usando caché)
 * 
 * @param {string} sku - Código SKU del producto
 * @param {Map} productsMap - Mapa de productos (opcional, se carga automáticamente)
 * @returns {Promise<Object>} Información del producto con precio
 */
async function getShopifyProductPriceBySKU(sku, productsMap = null) {
    try {
        // Si no se proporciona el mapa, cargarlo
        if (!productsMap) {
            productsMap = await loadAllShopifyProducts();
        }

        // Normalizar SKU
        const normalizedSku = sku.toString().trim().toUpperCase();
        const product = productsMap.get(normalizedSku);
        return product || null;
        
    } catch (error) {
        console.error(`❌ Error al obtener producto ${sku} de Shopify:`, error.message);
        throw error;
    }
}

/**
 * Actualizar el precio de un producto en Shopify
 * 
 * @param {number} productId - ID del producto en Shopify
 * @param {number} variantId - ID de la variante
 * @param {number} price - Nuevo precio
 * @returns {Promise<Object>} Respuesta de la actualización
 */
async function updateShopifyPrice(productId, variantId, price) {
    try {
        // Para actualizar el precio en Shopify, necesitamos actualizar la variante
        // Usamos PUT en /products/{productId}.json con la variante actualizada
        const response = await axios.put(
            `${SHOPIFY_BASE_URL}/products/${productId}.json`,
            {
                product: {
                    id: productId,
                    variants: [
                        {
                            id: variantId,
                            price: price.toString()
                        }
                    ]
                }
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
            const retryAfter = error.response.headers['retry-after'] || error.response.headers['Retry-After'];
            const waitTime = retryAfter ? parseInt(retryAfter) : 5;
            const message = `Rate limit de Shopify alcanzado. Espera ${waitTime} segundos antes de continuar.`;
            throw new Error(message);
        }
        
        // Detectar errores 422 (variantes que no existen o no pertenecen al producto)
        if (error.response?.status === 422) {
            const errorData = error.response?.data;
            if (errorData?.errors?.variants) {
                throw new Error('Variante no existe o no pertenece al producto (422)');
            }
            throw new Error(`Error de validación en Shopify (422): ${JSON.stringify(errorData?.errors || errorData)}`);
        }
        
        // Detectar errores de autenticación
        if (error.response?.status === 401) {
            throw new Error('Token de acceso inválido o expirado.');
        }
        
        // Detectar errores de servidor
        if (error.response?.status >= 500) {
            throw new Error(`Error del servidor Shopify (${error.response.status}). Puede estar sobrecargado.`);
        }
        
        // No loguear errores aquí, se manejarán en la función que llama
        throw error;
    }
}

/**
 * Sincronizar el precio de un producto específico (optimizado con caché)
 * 
 * @param {string} sku - Código SKU del producto
 * @param {Object} options - Opciones de sincronización
 * @param {Map} shopifyProductsMap - Mapa de productos de Shopify (opcional)
 * @param {Map} priceListsMap - Mapa de listas de precios de Manager (opcional)
 * @returns {Promise<Object>} Resultado de la sincronización
 */
async function syncProductPrice(sku, options = {}, shopifyProductsMap = null, priceListsMap = null) {
    const { dryRun = false, forceUpdate = false } = options;
    
    try {
        // 1. Obtener precio de Manager+ (lista 652)
        let managerPriceInfo;
        try {
            managerPriceInfo = await getManagerProductPrice(sku, priceListsMap);
        } catch (error) {
            return {
                sku,
                success: false,
                error: error.message,
                action: 'error'
            };
        }
        
        // Si no hay precio en lista 652, no actualizamos (según requerimiento)
        if (!managerPriceInfo.precio) {
            return {
                sku,
                success: true,
                action: 'skipped',
                error: managerPriceInfo.error || 'Sin precio en lista 652',
                message: 'Producto sin precio en lista 652 - no se actualiza'
            };
        }
        
        // 2. Obtener precio actual de Shopify (usando caché si está disponible)
        const shopifyProduct = await getShopifyProductPriceBySKU(sku, shopifyProductsMap);
        
        if (!shopifyProduct) {
            return {
                sku,
                success: false,
                error: 'Producto no encontrado en Shopify',
                action: 'skipped'
            };
        }
        
        // 3. Comparar precios (redondear para evitar diferencias por decimales)
        const managerPrice = Math.round(managerPriceInfo.precio * 100) / 100; // Redondear a 2 decimales
        const shopifyPrice = Math.round(shopifyProduct.currentPrice * 100) / 100;
        
        if (managerPrice === shopifyPrice && !forceUpdate) {
            return {
                sku,
                success: true,
                action: 'no_change',
                managerPrice,
                shopifyPrice,
                listaUsada: managerPriceInfo.listaUsada,
                message: 'Precios ya están sincronizados'
            };
        }
        
        // 4. Actualizar precio en Shopify
        if (dryRun) {
            return {
                sku,
                success: true,
                action: 'would_update',
                managerPrice,
                shopifyPrice,
                newPrice: managerPrice,
                listaUsada: managerPriceInfo.listaUsada,
                message: 'Dry run: no se realizaron cambios'
            };
        }
        
        await updateShopifyPrice(
            shopifyProduct.productId,
            shopifyProduct.variantId,
            managerPrice
        );
        
        return {
            sku,
            success: true,
            action: 'updated',
            managerPrice,
            shopifyPrice,
            newPrice: managerPrice,
            listaUsada: managerPriceInfo.listaUsada,
            message: 'Precio actualizado exitosamente'
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
async function processInParallel(array, processor, concurrency = 20) {
    const results = [];
    let rateLimitErrors = 0;
    let currentConcurrency = concurrency;
    const logs = []; // Acumular logs para mostrarlos después del chunk
    let lastRateLimitTime = 0;
    let rateLimitWaitTime = 0;
    
    for (let i = 0; i < array.length; i += currentConcurrency) {
        const chunk = array.slice(i, i + currentConcurrency);
        
        try {
            // Procesar chunk en paralelo - todos los productos del chunk se procesan simultáneamente
            const chunkPromises = chunk.map(processor);
            const chunkResults = await Promise.all(chunkPromises);
            
            // Acumular logs (excluir errores de rate limit repetitivos)
            chunkResults.forEach(result => {
                if (result.action === 'updated' || result.action === 'would_update') {
                    logs.push(`   ✅ ${result.sku}: $${result.shopifyPrice} → $${result.managerPrice} (lista ${result.listaUsada})`);
                } else if (result.action === 'no_change') {
                    logs.push(`   ℹ️  ${result.sku}: sin cambios (Shopify $${result.shopifyPrice} = Manager $${result.managerPrice}, lista ${result.listaUsada})`);
                } else if (result.action === 'skipped') {
                    logs.push(`   ⏭️  ${result.sku}: omitido (${result.error || result.message || 'motivo no especificado'})`);
                } else if (result.action === 'error' || !result.success) {
                    // Solo mostrar errores que NO sean rate limit
                    if (!result.error || (!result.error.includes('Rate limit') && !result.error.includes('429'))) {
                        logs.push(`   ❌ ${result.sku}: ${result.error || 'error desconocido'}`);
                    }
                }
            });
            
            // Mostrar logs acumulados del chunk (sin bloquear)
            logs.forEach(log => console.log(log));
            logs.length = 0; // Limpiar logs mostrados
            
            results.push(...chunkResults);
            
            // Detectar y manejar rate limiting
            const chunkRateLimitErrors = chunkResults.filter(r => 
                r.error && (r.error.includes('Rate limit') || r.error.includes('429'))
            );
            
            if (chunkRateLimitErrors.length > 0) {
                rateLimitErrors += chunkRateLimitErrors.length;
                const now = Date.now();
                
                // Extraer tiempo de espera del primer error de rate limit
                const firstRateLimitError = chunkRateLimitErrors[0];
                const waitMatch = firstRateLimitError.error?.match(/Espera (\d+(?:\.\d+)?) segundos/);
                const suggestedWait = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) : 5;
                
                // Si hay múltiples rate limits seguidos, esperar más tiempo
                if (now - lastRateLimitTime < 10000) { // Si fue hace menos de 10 segundos
                    rateLimitWaitTime = Math.max(rateLimitWaitTime, suggestedWait * 2);
                } else {
                    rateLimitWaitTime = Math.max(suggestedWait, 5);
                }
                
                lastRateLimitTime = now;
                
                // Reducir concurrencia si hay rate limits
                if (currentConcurrency > 2) {
                    currentConcurrency = Math.max(2, Math.floor(currentConcurrency / 2));
                    console.log(`\n⚠️  Rate limit detectado (${chunkRateLimitErrors.length} casos). Reduciendo concurrencia a ${currentConcurrency} y esperando ${rateLimitWaitTime}s...`);
                } else {
                    console.log(`\n⚠️  Rate limit detectado (${chunkRateLimitErrors.length} casos). Esperando ${rateLimitWaitTime}s antes de continuar...`);
                }
                
                // Esperar antes de continuar
                for (let wait = rateLimitWaitTime; wait > 0; wait--) {
                    process.stdout.write(`\r   ⏱️  Esperando ${wait} segundo${wait > 1 ? 's' : ''}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                process.stdout.write('\r   ✅ Espera completada. Continuando...\n');
                
                // Resetear contador después de esperar
                rateLimitWaitTime = 0;
            } else {
                // Si no hay rate limits, intentar aumentar la concurrencia gradualmente
                if (currentConcurrency < concurrency && rateLimitErrors === 0) {
                    currentConcurrency = Math.min(concurrency, currentConcurrency + 1);
                }
            }
            
        } catch (error) {
            // Si es un error de rate limit global, esperar y continuar
            if (error.message && error.message.includes('Rate limit')) {
                const waitMatch = error.message.match(/Espera (\d+(?:\.\d+)?) segundos/);
                const waitTime = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) : 5;
                
                console.log(`\n⚠️  Rate limit detectado. Esperando ${waitTime} segundos antes de continuar...`);
                for (let wait = waitTime; wait > 0; wait--) {
                    process.stdout.write(`\r   ⏱️  Esperando ${wait} segundo${wait > 1 ? 's' : ''}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                process.stdout.write('\r   ✅ Espera completada. Continuando...\n');
                
                // Reducir concurrencia
                if (currentConcurrency > 2) {
                    currentConcurrency = Math.max(2, Math.floor(currentConcurrency / 2));
                }
            } else {
                throw error;
            }
        }
        
        // Mostrar progreso
        const processed = Math.min(i + currentConcurrency, array.length);
        console.log(`\r   Procesando: ${processed}/${array.length} productos...`);
    }
    
    return results;
}

/**
 * Sincronizar precios de múltiples productos (optimizado con procesamiento paralelo)
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
        notFound: 0, // Productos no encontrados en el ERP (errores 422)
        details: []
    };
    
    // Validar y limitar concurrencia
    // Por defecto, usar 20 para sincronización de precios
    // Solo se reducirá si se detectan rate limits durante la ejecución
    let concurrency = options.concurrency !== undefined ? options.concurrency : 20;
    const DEFAULT_CONCURRENCY = 20; // Valor por defecto para precios
    const MAX_RECOMMENDED_CONCURRENCY = 20;
    const ABSOLUTE_MAX_CONCURRENCY = 50;
    
    if (concurrency > ABSOLUTE_MAX_CONCURRENCY) {
        console.warn(`⚠️  Advertencia: Concurrencia de ${concurrency} es muy alta. Limitando a ${ABSOLUTE_MAX_CONCURRENCY}`);
        concurrency = ABSOLUTE_MAX_CONCURRENCY;
    } else if (concurrency > MAX_RECOMMENDED_CONCURRENCY) {
        console.warn(`⚠️  Advertencia: Concurrencia de ${concurrency} es alta. Puede causar rate limiting.`);
        console.warn(`   Valor recomendado: hasta ${MAX_RECOMMENDED_CONCURRENCY} para evitar problemas con las APIs.\n`);
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
        const [shopifyProductsMap, priceListsMap] = await Promise.all([
            loadAllShopifyProducts(),
            loadAllPriceLists()
        ]);
        
        console.log('\n🔄 Iniciando sincronización paralela...\n');
        
        // Procesar productos en paralelo con límite de concurrencia
        const processedResults = await processInParallel(
            skus,
            async (sku) => {
                try {
                    const result = await syncProductPrice(sku, options, shopifyProductsMap, priceListsMap);
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
                // Separar errores 422 (productos no encontrados en el ERP) de otros errores
                if (result.error && (
                    result.error.includes('422') || 
                    result.error.includes('Variante no existe') ||
                    result.error.includes('no encontrado en Manager+')
                )) {
                    results.notFound++;
                } else {
                    results.errors++;
                }
            }
        });
        
        // Reintentos automáticos
        // Excluir errores 422 (productos no encontrados) ya que no son recuperables
        const failedProducts = results.details.filter(r => 
            !r.success && 
            r.action === 'error' &&
            r.error && 
            !r.error.includes('no encontrado') &&
            !r.error.includes('skipped') &&
            !r.error.includes('Sin precio') &&
            !r.error.includes('422') &&
            !r.error.includes('Variante no existe')
        );
        
        // Separar productos con rate limit de otros errores
        const rateLimitFailures = failedProducts.filter(r => 
            r.error && (r.error.includes('Rate limit') || r.error.includes('429'))
        );
        const otherFailures = failedProducts.filter(r => 
            !r.error || (!r.error.includes('Rate limit') && !r.error.includes('429'))
        );
        
        // Contar productos no encontrados (422) que no se reintentarán
        const notFoundProducts = results.details.filter(r => 
            !r.success && 
            r.action === 'error' &&
            r.error && (
                r.error.includes('422') || 
                r.error.includes('Variante no existe') ||
                r.error.includes('no encontrado en Manager+')
            )
        );
        
        if (notFoundProducts.length > 0) {
            console.log(`\n📋 ${notFoundProducts.length} producto(s) no encontrado(s) en Manager+ (errores 422):`);
            console.log(`   ℹ️  Estos productos no se reintentarán ya que no existen en el ERP`);
            if (notFoundProducts.length <= 10) {
                notFoundProducts.forEach(p => {
                    console.log(`      - ${p.sku}`);
                });
            } else {
                notFoundProducts.slice(0, 10).forEach(p => {
                    console.log(`      - ${p.sku}`);
                });
                console.log(`      ... y ${notFoundProducts.length - 10} más`);
            }
            console.log('');
        }
        
        if (failedProducts.length > 0 && !options.dryRun) {
            const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
            const retryDelay = options.retryDelay !== undefined ? options.retryDelay : 2000;
            
            console.log(`\n🔄 Reintentando ${failedProducts.length} productos que fallaron (excluyendo productos no encontrados)...`);
            if (rateLimitFailures.length > 0) {
                console.log(`   ⚠️  ${rateLimitFailures.length} productos fallaron por rate limiting`);
                console.log(`   ⏳ Esperando 10 segundos antes de reintentar (para evitar más rate limits)...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            } else {
                console.log(`   Intentos máximos: ${maxRetries}`);
                console.log(`   Retraso entre intentos: ${retryDelay}ms\n`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
            
            let retryAttempt = 1;
            let remainingFailures = [...failedProducts];
            
            while (remainingFailures.length > 0 && retryAttempt <= maxRetries) {
                console.log(`\n🔄 Intento ${retryAttempt}/${maxRetries} de reintento...`);
                
                // Detectar si hay rate limits en los fallos anteriores
                const hasRateLimitErrors = remainingFailures.some(r => 
                    r.error && (r.error.includes('Rate limit') || r.error.includes('429'))
                );
                
                // Si hay rate limits, usar concurrencia muy baja y esperar más
                let retryConcurrency = hasRateLimitErrors ? 2 : Math.max(2, Math.floor(concurrency / 2));
                let initialWait = hasRateLimitErrors ? 10000 : retryDelay;
                
                if (hasRateLimitErrors && retryAttempt === 1) {
                    console.log(`   ⚠️  Detectados errores de rate limiting. Usando concurrencia baja (${retryConcurrency}) y esperando ${initialWait/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, initialWait));
                }
                
                const failedSkus = remainingFailures.map(r => r.sku);
                
                const retryProcessedResults = await processInParallel(
                    failedSkus,
                    async (sku) => {
                        try {
                            const result = await syncProductPrice(sku, options, shopifyProductsMap, priceListsMap);
                            
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
                
                // Actualizar resultados originales y contadores
                retryProcessedResults.forEach(retryResult => {
                    const originalIndex = results.details.findIndex(r => r.sku === retryResult.sku);
                    if (originalIndex !== -1) {
                        const originalResult = results.details[originalIndex];
                        const wasError = !originalResult.success && originalResult.action === 'error';
                        
                        results.details[originalIndex] = retryResult;
                        
                        if (retryResult.success && wasError) {
                            // Determinar qué contador reducir basándose en el error original
                            const wasNotFound = originalResult.error && (
                                originalResult.error.includes('422') || 
                                originalResult.error.includes('Variante no existe') ||
                                originalResult.error.includes('no encontrado en Manager+')
                            );
                            
                            if (wasNotFound) {
                                results.notFound--;
                            } else {
                                results.errors--;
                            }
                            
                            if (retryResult.action === 'updated' || retryResult.action === 'would_update') {
                                results.updated++;
                            } else if (retryResult.action === 'no_change') {
                                results.noChange++;
                            } else if (retryResult.action === 'skipped') {
                                results.skipped++;
                            }
                        }
                    }
                });
                
                remainingFailures = retryProcessedResults.filter(r => 
                    !r.success && 
                    r.action === 'error' &&
                    r.error && 
                    !r.error.includes('no encontrado') &&
                    !r.error.includes('skipped') &&
                    !r.error.includes('Sin precio') &&
                    !r.error.includes('422') &&
                    !r.error.includes('Variante no existe')
                );
                
                // Verificar si hay rate limits en los fallos restantes
                const stillHasRateLimits = remainingFailures.some(r => 
                    r.error && (r.error.includes('Rate limit') || r.error.includes('429'))
                );
                
                if (remainingFailures.length > 0 && retryAttempt < maxRetries) {
                    // Esperar más tiempo si hay rate limits
                    const waitTime = stillHasRateLimits ? 10000 : retryDelay;
                    const waitSeconds = Math.ceil(waitTime / 1000);
                    
                    if (stillHasRateLimits) {
                        console.log(`   ⚠️  ${remainingFailures.length} productos aún fallan (incluyendo rate limits).`);
                        console.log(`   ⏳ Esperando ${waitSeconds} segundos antes del próximo intento...`);
                        for (let wait = waitSeconds; wait > 0; wait--) {
                            process.stdout.write(`\r      ⏱️  ${wait} segundo${wait > 1 ? 's' : ''} restante${wait > 1 ? 's' : ''}...`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                        process.stdout.write('\r      ✅ Espera completada.\n');
                    } else {
                        console.log(`   ⚠️  ${remainingFailures.length} productos aún fallan. Esperando ${waitSeconds}s antes del próximo intento...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                
                retryAttempt++;
            }
            
            if (remainingFailures.length > 0) {
                console.log(`\n⚠️  Después de ${maxRetries} intentos, ${remainingFailures.length} productos aún fallan:`);
                // Agrupar errores similares para no mostrar muchos logs repetitivos
                const errorGroups = {};
                remainingFailures.forEach(failure => {
                    const errorKey = failure.error || 'Error desconocido';
                    if (!errorGroups[errorKey]) {
                        errorGroups[errorKey] = [];
                    }
                    errorGroups[errorKey].push(failure.sku);
                });
                
                Object.entries(errorGroups).forEach(([error, skus]) => {
                    if (skus.length <= 3) {
                        skus.forEach(sku => {
                            console.log(`   ❌ ${sku}: ${error}`);
                        });
                    } else {
                        console.log(`   ❌ ${skus.length} productos con: ${error}`);
                        console.log(`      Ejemplos: ${skus.slice(0, 3).join(', ')}...`);
                    }
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
        if (results.notFound > 0) {
            console.log(`   🔍 No encontrados en Manager+: ${results.notFound} (no se reintentan)`);
        }
        if (results.errors > 0) {
            console.log(`   ❌ Errores finales: ${results.errors}`);
        }
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

        if (skus.length === 0) {
            throw new Error('No hay publicaciones con SKU configurado en Shopify.');
        }
        
        console.log(`✅ Sincronizando ${skus.length} SKUs únicos\n`);
        
        return await syncMultipleProducts(skus, options);
        
    } catch (error) {
        console.error('❌ Error al obtener productos de Shopify:', error.message);
        throw error;
    }
}

// Exportar funciones
module.exports = {
    syncProductPrice,
    syncMultipleProducts,
    syncAllProducts,
    getManagerProductPrice,
    getShopifyProductPriceBySKU,
    clearCache: () => {
        shopifyProductsCache = null;
        priceListsCache = null;
        priceListsCacheTime = null;
    },
    loadAllPriceLists
};

// Si se ejecuta directamente, procesar argumentos de línea de comandos
if (require.main === module) {
    // Validar variables de entorno antes de continuar
    validateEnvironment();
    
    const args = process.argv.slice(2);
    
    // Extraer opciones
    const options = {
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force'),
        all: args.includes('--all')
    };
    
    // Extraer concurrencia si se especifica
    const concurrencyArg = args.find(arg => arg.startsWith('--concurrency='));
    if (concurrencyArg) {
        const concurrencyValue = parseInt(concurrencyArg.split('=')[1]);
        if (!isNaN(concurrencyValue) && concurrencyValue > 0) {
            options.concurrency = concurrencyValue;
        }
    }
    
    // Extraer maxRetries si se especifica
    const maxRetriesArg = args.find(arg => arg.startsWith('--max-retries='));
    if (maxRetriesArg) {
        const maxRetriesValue = parseInt(maxRetriesArg.split('=')[1]);
        if (!isNaN(maxRetriesValue) && maxRetriesValue >= 0) {
            options.maxRetries = maxRetriesValue;
        }
    }
    
    // Extraer retryDelay si se especifica
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
    
    // Si no hay argumentos o solo hay opciones, mostrar ayuda
    if (args.length === 0 || (args.length === 1 && args[0].startsWith('--'))) {
        if (!options.all) {
            console.log(`
💰 Sincronización de Precios Manager+ → Shopify (Optimizado)

Uso:
  node syncPricesShopify.js [SKU1] [SKU2] ... [SKUn]        - Sincronizar productos específicos
  node syncPricesShopify.js --all                            - Sincronizar todos los productos
  node syncPricesShopify.js --all --dry-run                  - Simular sincronización sin cambios

Opciones:
  --dry-run                 Simular sin hacer cambios reales
  --force                   Forzar actualización incluso si los precios son iguales
  --concurrency=N           Número de productos a procesar en paralelo (default: 5)
  --max-retries=N           Número máximo de reintentos automáticos (default: 3)
  --retry-delay=N           Milisegundos de espera entre reintentos (default: 2000)
  --no-retry                Desactivar reintentos automáticos

Lógica de precios:
  - Usa lista de precios 652 de Manager+
  - Si no tiene precio en lista 652, no se actualiza el producto en Shopify
  - Si los precios son diferentes, se actualiza el precio en Shopify

Ejemplos:
  node syncPricesShopify.js --all --dry-run --concurrency=10
  node syncPricesShopify.js ABC123 DEF456 --concurrency=3
  node syncPricesShopify.js --all --max-retries=5 --retry-delay=3000
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
