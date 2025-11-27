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

// Variable para almacenar el token de autenticación del ERP
let erpAuthToken = null;
let erpTokenExpirationTime = null;

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
 * Extraer stock de un producto desde la respuesta del endpoint de productos
 * 
 * Cuando se usa con_stock=S, el stock viene en el campo "stock" (array de arrays)
 * donde cada objeto tiene un campo "saldo" que es el stock real
 * 
 * @param {Object} product - Objeto del producto de Manager+
 * @returns {number} Stock total del producto
 */
function extractStockFromProduct(product) {
    let stock = 0;
    
    if (product.stock && Array.isArray(product.stock) && product.stock.length > 0) {
        // Iterar sobre cada sub-array en el array principal
        product.stock.forEach(subArray => {
            if (Array.isArray(subArray)) {
                // Sumar todos los "saldo" de cada objeto en el sub-array
                subArray.forEach(item => {
                    if (item && typeof item === 'object') {
                        const saldo = item.saldo || 0;
                        stock += parseFloat(saldo) || 0;
                    }
                });
            }
        });
    }
    
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
async function getManagerProductBySKU(sku) {
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
        console.error(`   ❌ Error al obtener stock de ${sku} de Manager+: ${error.response?.data?.message || error.message}`);
        throw error;
    }
}

/**
 * Obtener información de un producto desde Shopify por SKU
 * 
 * @param {string} sku - Código SKU del producto
 * @returns {Promise<Object>} Información del producto con stock
 */
async function getShopifyProductStockBySKU(sku) {
    try {
        const result = await getShopifyProductBySKU(sku);
        
        if (!result || !result.variant) {
            return null;
        }

        const variant = result.variant;
        
        return {
            sku: variant.sku,
            productId: result.product.id,
            variantId: variant.id,
            inventoryItemId: variant.inventory_item_id,
            currentStock: variant.inventory_quantity !== null ? variant.inventory_quantity : 0,
            productTitle: result.product.title
        };
        
    } catch (error) {
        console.error(`❌ Error al obtener producto ${sku} de Shopify:`, error.message);
        throw error;
    }
}

/**
 * Obtener el location_id de inventario de Shopify
 * 
 * @returns {Promise<number>} ID de la ubicación de inventario
 */
async function getShopifyLocationId() {
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
        return locations[0].id;
        
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
        console.error('❌ Error al actualizar stock en Shopify:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Sincronizar el stock de un producto específico
 * 
 * @param {string} sku - Código SKU del producto
 * @param {Object} options - Opciones de sincronización
 * @returns {Promise<Object>} Resultado de la sincronización
 */
async function syncProductStock(sku, options = {}) {
    const { dryRun = false, forceUpdate = false } = options;
    
    try {
        console.log(`\n🔄 ${sku}`);
        
        // 1. Obtener stock de Manager+
        let managerProduct;
        try {
            managerProduct = await getManagerProductBySKU(sku);
        } catch (error) {
            console.error(`   ❌ Error Manager+: ${error.message}`);
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

        console.log(`   📦 Manager+: ${managerProduct.stock} ${managerProduct.unidad || ''}`);
        
        // 2. Obtener stock de Shopify
        const shopifyProduct = await getShopifyProductStockBySKU(sku);
        
        if (!shopifyProduct) {
            return {
                sku,
                success: false,
                error: 'Producto no encontrado en Shopify',
                action: 'skipped'
            };
        }

        console.log(`   🛒 Shopify: ${shopifyProduct.currentStock}`);
        
        // 3. Comparar stocks
        const managerStock = parseInt(managerProduct.stock) || 0;
        const shopifyStock = shopifyProduct.currentStock;
        
        if (managerStock === shopifyStock && !forceUpdate) {
            console.log(`   ✓ Sincronizado (${managerStock})`);
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
            console.log(`   🔍 [SIMULACIÓN] Actualizaría: ${shopifyStock} → ${managerStock}`);
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
        
        console.log(`   📤 Actualizando: ${shopifyStock} → ${managerStock}`);
        
        const locationId = await getShopifyLocationId();
        await updateShopifyStock(
            shopifyProduct.inventoryItemId,
            locationId,
            managerStock
        );
        
        console.log(`   ✅ Actualizado`);
        
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
        console.error(`   ❌ Error: ${error.message}`);
        return {
            sku,
            success: false,
            error: error.message,
            action: 'error'
        };
    }
}

/**
 * Sincronizar stocks de múltiples productos
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
    
    console.log(`\n🚀 Iniciando sincronización de ${skus.length} productos\n`);
    console.log('='.repeat(60));
    
    // Verificar autenticación con Shopify primero
    await verifyShopifyAuth();
    
    for (const sku of skus) {
        const result = await syncProductStock(sku, options);
        results.details.push(result);
        
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
        
        // Pequeña pausa para no sobrecargar las APIs
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Resumen de sincronización:');
    console.log(`   ✅ Actualizados: ${results.updated}`);
    console.log(`   ℹ️  Sin cambios: ${results.noChange}`);
    console.log(`   ⏭️  Omitidos: ${results.skipped}`);
    console.log(`   ❌ Errores: ${results.errors}`);
    console.log('='.repeat(60));
    
    return results;
}

/**
 * Obtener todos los SKUs de productos de Shopify y sincronizarlos
 * 
 * @param {Object} options - Opciones de sincronización
 * @returns {Promise<Object>} Resumen de la sincronización
 */
async function syncAllProducts(options = {}) {
    try {
        console.log('📦 Obteniendo lista de productos de Shopify...');
        
        // Obtener productos de Shopify
        const response = await axios.get(`${SHOPIFY_BASE_URL}/products.json`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            },
            params: {
                limit: 250, // Máximo permitido por Shopify
                fields: 'id,title,variants'
            }
        });

        const products = response.data.products;
        const skus = [];
        
        // Extraer todos los SKUs únicos
        products.forEach(product => {
            product.variants.forEach(variant => {
                if (variant.sku && !skus.includes(variant.sku)) {
                    skus.push(variant.sku);
                }
            });
        });
        
        console.log(`✅ Se encontraron ${skus.length} productos únicos con SKU`);
        
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
    
    const options = {
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force'),
        all: args.includes('--all')
    };
    
    // Si no hay argumentos o solo hay opciones, mostrar ayuda
    if (args.length === 0 || (args.length === 1 && args[0].startsWith('--'))) {
        if (!options.all) {
            console.log(`
📦 Sincronización de Stocks Manager+ → Shopify

Uso:
  node syncStocks.js [SKU1] [SKU2] ... [SKUn]  - Sincronizar productos específicos
  node syncStocks.js --all                      - Sincronizar todos los productos
  node syncStocks.js --all --dry-run            - Simular sincronización sin cambios

Opciones:
  --dry-run    Simular sin hacer cambios reales
  --force      Forzar actualización incluso si los stocks son iguales
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

