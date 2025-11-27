/**
 * Script de prueba para autenticación y conexión con Shopify
 * 
 * Este archivo permite probar la conexión con Shopify y obtener
 * información de productos para verificar que la autenticación funciona.
 */

// Importaciones necesarias
require('dotenv').config();
const axios = require('axios');

// Variables de entorno de Shopify
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN; // ej: tu-tienda.myshopify.com
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN; // Token de acceso de la API

// Construir la URL base de la API de Shopify
// Usar una versión estable de la API (2023-10 es una versión estable común)
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2023-10'; // Versión de la API
const SHOPIFY_BASE_URL = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}`;

/**
 * Función para verificar la autenticación con Shopify
 * 
 * Realiza una petición GET al endpoint de tienda para verificar
 * que las credenciales son válidas.
 * 
 * @returns {Promise<Object>} Información de la tienda
 */
async function verifyShopifyAuth() {
    try {
        console.log('🔐 Verificando autenticación con Shopify...');
        console.log(`📍 Tienda: ${SHOPIFY_SHOP_DOMAIN}`);
        
        const response = await axios.get(`${SHOPIFY_BASE_URL}/shop.json`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Autenticación exitosa con Shopify');
        console.log(`📦 Tienda: ${response.data.shop.name}`);
        console.log(`🌐 Dominio: ${response.data.shop.domain}`);
        console.log(`📧 Email: ${response.data.shop.email}`);
        
        return response.data.shop;
        
    } catch (error) {
        console.error('❌ Error en la autenticación con Shopify:');
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Mensaje: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`   Error: ${error.message}`);
        }
        throw new Error('Error al autenticarse con Shopify: ' + (error.response?.data?.errors || error.message));
    }
}

/**
 * Función para obtener productos de Shopify
 * 
 * Obtiene una lista de productos desde Shopify con información básica.
 * 
 * @param {number} limit - Número máximo de productos a obtener (por defecto 10)
 * @returns {Promise<Array>} Lista de productos
 */
async function getShopifyProducts(limit = 10) {
    try {
        console.log(`📦 Obteniendo productos de Shopify (límite: ${limit})...`);
        
        const response = await axios.get(`${SHOPIFY_BASE_URL}/products.json`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            },
            params: {
                limit: limit,
                fields: 'id,title,variants,sku,status'
            }
        });

        const products = response.data.products;
        console.log(`✅ Se obtuvieron ${products.length} productos`);
        
        // Mostrar información de cada producto
        products.forEach((product, index) => {
            console.log(`\n   Producto ${index + 1}:`);
            console.log(`   - ID: ${product.id}`);
            console.log(`   - Título: ${product.title}`);
            console.log(`   - Estado: ${product.status}`);
            console.log(`   - Variantes: ${product.variants.length}`);
            
            // Mostrar SKU y stock de cada variante
            product.variants.forEach((variant, vIndex) => {
                console.log(`     Variante ${vIndex + 1}:`);
                console.log(`       - SKU: ${variant.sku || 'Sin SKU'}`);
                console.log(`       - ID Variante: ${variant.id}`);
                console.log(`       - Inventario: ${variant.inventory_quantity !== null ? variant.inventory_quantity : 'N/A'}`);
            });
        });
        
        return products;
        
    } catch (error) {
        console.error('❌ Error al obtener productos de Shopify:');
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Mensaje: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`   Error: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Función para obtener un producto específico por SKU
 * 
 * @param {string} sku - Código SKU del producto
 * @returns {Promise<Object>} Producto encontrado
 */
async function getShopifyProductBySKU(sku) {
    try {
        console.log(`🔍 Buscando producto con SKU: ${sku}...`);
        
        // Shopify no tiene un endpoint directo para buscar por SKU,
        // así que obtenemos productos y filtramos
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

        // Buscar el producto por SKU en las variantes
        const products = response.data.products;
        for (const product of products) {
            const variant = product.variants.find(v => v.sku === sku);
            if (variant) {
                console.log(`✅ Producto encontrado:`);
                console.log(`   - ID Producto: ${product.id}`);
                console.log(`   - Título: ${product.title}`);
                console.log(`   - SKU: ${variant.sku}`);
                console.log(`   - ID Variante: ${variant.id}`);
                console.log(`   - Inventario: ${variant.inventory_quantity !== null ? variant.inventory_quantity : 'N/A'}`);
                
                return {
                    product: product,
                    variant: variant
                };
            }
        }
        
        console.log(`⚠️  No se encontró ningún producto con SKU: ${sku}`);
        return null;
        
    } catch (error) {
        console.error('❌ Error al buscar producto por SKU:');
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Mensaje: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`   Error: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Función para actualizar el inventario de un producto en Shopify
 * 
 * @param {number} variantId - ID de la variante del producto
 * @param {number} quantity - Nueva cantidad de inventario
 * @returns {Promise<Object>} Respuesta de la actualización
 */
async function updateShopifyInventory(variantId, quantity) {
    try {
        console.log(`📝 Actualizando inventario de variante ${variantId} a ${quantity}...`);
        
        // Primero necesitamos obtener el location_id del inventario
        // Por ahora, usaremos el endpoint de inventory_level
        const response = await axios.get(`${SHOPIFY_BASE_URL}/inventory_levels.json`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            },
            params: {
                inventory_item_ids: variantId
            }
        });

        if (response.data.inventory_levels.length === 0) {
            throw new Error('No se encontró información de inventario para esta variante');
        }

        const inventoryLevel = response.data.inventory_levels[0];
        
        // Actualizar el inventario
        const updateResponse = await axios.post(
            `${SHOPIFY_BASE_URL}/inventory_levels/set.json`,
            {
                location_id: inventoryLevel.location_id,
                inventory_item_id: inventoryLevel.inventory_item_id,
                available: quantity
            },
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`✅ Inventario actualizado exitosamente`);
        console.log(`   - Cantidad anterior: ${inventoryLevel.available}`);
        console.log(`   - Cantidad nueva: ${quantity}`);
        
        return updateResponse.data;
        
    } catch (error) {
        console.error('❌ Error al actualizar inventario:');
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Mensaje: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            console.error(`   Error: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Función principal para ejecutar las pruebas
 */
async function main() {
    console.log('🚀 Iniciando pruebas de conexión con Shopify\n');
    console.log('=' .repeat(60));
    
    // Verificar que las variables de entorno estén configuradas
    if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
        console.error('❌ Error: Faltan variables de entorno');
        console.error('   Por favor, configura en tu archivo .env:');
        console.error('   - SHOPIFY_SHOP_DOMAIN=tu-tienda.myshopify.com');
        console.error('   - SHOPIFY_ACCESS_TOKEN=tu-token-de-acceso');
        process.exit(1);
    }
    
    try {
        // 1. Verificar autenticación
        console.log('\n📋 Paso 1: Verificar autenticación\n');
        await verifyShopifyAuth();
        
        // 2. Obtener algunos productos
        console.log('\n\n📋 Paso 2: Obtener productos\n');
        await getShopifyProducts(5);
        
        console.log('\n\n' + '='.repeat(60));
        console.log('✅ Todas las pruebas completadas exitosamente');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('\n\n' + '='.repeat(60));
        console.error('❌ Error durante las pruebas');
        console.error('='.repeat(60));
        process.exit(1);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    main();
}

// Exportar funciones para uso en otros módulos
module.exports = {
    verifyShopifyAuth,
    getShopifyProducts,
    getShopifyProductBySKU,
    updateShopifyInventory,
    SHOPIFY_BASE_URL
};

