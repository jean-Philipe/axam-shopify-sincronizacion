/**
 * Script para obtener productos de Manager+ que tienen stock mayor a 0
 * 
 * Este script lista todos los productos que tienen stock disponible en Manager+
 */

require('dotenv').config();
const axios = require('axios');

// Variables de entorno
const ERP_BASE_URL = process.env.ERP_BASE_URL;
const ERP_USERNAME = process.env.ERP_USERNAME;
const ERP_PASSWORD = process.env.ERP_PASSWORD;
const RUT_EMPRESA = process.env.RUT_EMPRESA;

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
 * Cuando se usa con_stock=S, el stock viene en el campo "unidades" del producto
 * 
 * @param {Object} product - Objeto del producto de Manager+
 * @returns {Object} Información del producto con stock
 */
function extractProductStock(product) {
    const sku = product.codigo_prod || product.cod_producto || product.codigo || '';
    const nombre = product.nombre || product.descripcion || product.descrip || '';
    const unidad = product.unidadstock || product.unidad || '';
    
    // El stock viene en el campo "stock" que es un array de arrays
    // Cada sub-array contiene objetos con el campo "saldo" que es el stock real
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
    
    return {
        sku,
        nombre,
        stock,
        unidad
    };
}

/**
 * Obtener lista de productos desde Manager+ con stock incluido
 * 
 * @returns {Promise<Array>} Lista de productos con información de stock
 */
async function getAllProducts() {
    try {
        const token = await getERPAuthToken();
        
        // Usar el parámetro con_stock=S para obtener el stock en la misma respuesta
        const url = `${ERP_BASE_URL}/products/${RUT_EMPRESA}/`;
        
        const response = await axios.get(url, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${token}`
            },
            params: {
                con_stock: 'S'  // Incluir stock detallado por producto
            }
        });

        const products = response.data.data || response.data;
        
        if (!products) {
            return [];
        }

        // Asegurarse de que siempre sea un array
        if (Array.isArray(products)) {
            return products;
        }
        
        // Si es un objeto único, convertirlo a array
        if (typeof products === 'object') {
            return [products];
        }
        
        return [];
        
    } catch (error) {
        console.error('❌ Error al obtener productos:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Obtener productos con stock mayor a 0
 * 
 * @param {number} minStock - Stock mínimo (por defecto 0, pero se filtra > 0)
 * @returns {Promise<Array>} Lista de productos con stock > 0
 */
async function getProductsWithStock(minStock = 0) {
    console.log('📦 Obteniendo productos de Manager+...\n');
    
    // Autenticarse primero
    await authenticateWithERP();
    console.log('✅ Autenticado con Manager+\n');
    
    // Obtener todos los productos
    const products = await getAllProducts();
    console.log(`✅ Se encontraron ${products.length} productos en Manager+\n`);
    console.log('🔍 Verificando stock de cada producto...\n');
    
    // Debug: Mostrar estructura del primer producto con stock
    if (products.length > 0) {
        // Buscar un producto que tenga stock para ver su estructura
        const productWithStock = products.find(p => 
            (p.stock && Array.isArray(p.stock) && p.stock.length > 0) ||
            (p.unidades && Array.isArray(p.unidades) && p.unidades.length > 0)
        );
        
        if (productWithStock) {
            console.log('🔍 [DEBUG] Estructura de un producto CON stock:');
            console.log(JSON.stringify(productWithStock, null, 2));
            console.log('');
        } else {
            console.log('🔍 [DEBUG] Ningún producto tiene stock en el array. Mostrando estructura del primero:');
            console.log(JSON.stringify(products[0], null, 2));
            console.log('');
        }
    }
    
    const productsWithStock = [];
    let processed = 0;
    let skipped = 0;
    
    // Procesar productos en lotes para no sobrecargar la API
    for (const product of products) {
        // Intentar obtener el SKU de diferentes campos posibles
        // Según la estructura que vimos antes, el campo es codigo_prod
        const sku = product.codigo_prod || 
                   product.cod_producto || 
                   product.codigo || 
                   product.cod || 
                   product.sku ||
                   '';
        
        if (!sku) {
            skipped++;
            continue; // Saltar productos sin SKU
        }
        
        processed++;
        if (processed % 10 === 0) {
            process.stdout.write(`   Procesados: ${processed}/${products.length}\r`);
        }
        
        // Extraer información del producto con stock directamente de la respuesta
        const productStock = extractProductStock(product);
        
        if (productStock && productStock.stock > minStock) {
            productsWithStock.push(productStock);
        }
    }
    
    console.log(`\n✅ Procesados ${processed} productos`);
    if (skipped > 0) {
        console.log(`⚠️  Omitidos ${skipped} productos sin SKU\n`);
    } else {
        console.log('');
    }
    
    return productsWithStock;
}

/**
 * Función principal
 */
async function main() {
    try {
        console.log('🚀 Obteniendo productos con stock de Manager+\n');
        console.log('='.repeat(60));
        
        const products = await getProductsWithStock(0);
        
        console.log('='.repeat(60));
        console.log(`\n📊 Resultados:\n`);
        console.log(`   Total de productos con stock > 0: ${products.length}\n`);
        
        if (products.length === 0) {
            console.log('   No se encontraron productos con stock disponible.\n');
            return;
        }
        
        // Ordenar por stock descendente
        products.sort((a, b) => b.stock - a.stock);
        
        // Mostrar productos
        console.log('📦 Productos con stock disponible:\n');
        products.forEach((product, index) => {
            console.log(`   ${(index + 1).toString().padStart(3, ' ')}. ${product.sku.padEnd(15, ' ')} | Stock: ${product.stock.toString().padStart(6, ' ')} ${product.unidad || ''} | ${product.nombre.substring(0, 50)}`);
        });
        
        console.log('\n' + '='.repeat(60));
        console.log(`\n✅ Proceso completado\n`);
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    main();
}

// Exportar funciones
module.exports = {
    getProductsWithStock,
    extractProductStock
};

