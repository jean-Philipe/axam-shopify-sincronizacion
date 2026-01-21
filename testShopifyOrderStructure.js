/**
 * Script de prueba para analizar la estructura de datos que devuelve Shopify
 * 
 * Este script consulta una orden específica de Shopify y muestra todos los IDs 
 * disponibles para identificar correctamente qué campo usar como referencia.
 * 
 * Uso: node testShopifyOrderStructure.js [orderId]
 * Ejemplo: node testShopifyOrderStructure.js 6824213053691
 */

require('dotenv').config();
const axios = require('axios');

const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

/**
 * Obtener la configuración del shop de Shopify
 */
async function getShopInfo() {
    try {
        const shopName = SHOPIFY_SHOP_DOMAIN?.replace('.myshopify.com', '');
        const url = `https://${shopName}.myshopify.com/admin/api/2024-01/shop.json`;

        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        console.log('='.repeat(80));
        console.log('📦 INFORMACIÓN DEL SHOP');
        console.log('='.repeat(80));
        console.log(`Nombre: ${response.data.shop.name}`);
        console.log(`Dominio: ${response.data.shop.domain}`);
        console.log(`Email: ${response.data.shop.email}`);
    } catch (error) {
        console.error('Error obteniendo info del shop:', error.response?.data || error.message);
    }
}

/**
 * Listar las últimas órdenes de Shopify
 */
async function listRecentOrders(limit = 10) {
    try {
        const shopName = SHOPIFY_SHOP_DOMAIN?.replace('.myshopify.com', '');
        const url = `https://${shopName}.myshopify.com/admin/api/2024-01/orders.json?status=any&limit=${limit}`;

        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        console.log('\n' + '='.repeat(80));
        console.log('📋 ÚLTIMAS ÓRDENES');
        console.log('='.repeat(80));

        for (const order of response.data.orders) {
            console.log(`\n📦 Orden #${order.order_number} (name: ${order.name})`);
            console.log(`   ├─ ID: ${order.id}`);
            console.log(`   ├─ Admin GraphQL ID: ${order.admin_graphql_api_id}`);
            console.log(`   ├─ Checkout ID: ${order.checkout_id}`);
            console.log(`   ├─ Checkout Token: ${order.checkout_token}`);
            console.log(`   ├─ Token: ${order.token}`);
            console.log(`   ├─ Cart Token: ${order.cart_token}`);
            console.log(`   ├─ Total: $${order.total_price} ${order.currency}`);
            console.log(`   ├─ Fecha: ${order.created_at}`);
            console.log(`   └─ Line Items (${order.line_items.length}):`);

            for (const item of order.line_items) {
                console.log(`       ├─ Line Item ID: ${item.id}`);
                console.log(`       │  ├─ Product ID: ${item.product_id}`);
                console.log(`       │  ├─ Variant ID: ${item.variant_id}`);
                console.log(`       │  ├─ SKU: ${item.sku}`);
                console.log(`       │  ├─ Título: ${item.name}`);
                console.log(`       │  └─ Admin GraphQL ID: ${item.admin_graphql_api_id}`);
            }
        }

        return response.data.orders;
    } catch (error) {
        console.error('Error listando órdenes:', error.response?.data || error.message);
        return [];
    }
}

/**
 * Obtener información completa de una orden específica
 */
async function getOrderDetails(orderId) {
    try {
        const shopName = SHOPIFY_SHOP_DOMAIN?.replace('.myshopify.com', '');
        const url = `https://${shopName}.myshopify.com/admin/api/2024-01/orders/${orderId}.json`;

        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        const order = response.data.order;

        console.log('\n' + '='.repeat(80));
        console.log(`🔍 DETALLES DE ORDEN ${orderId}`);
        console.log('='.repeat(80));

        console.log('\n📌 IDENTIFICADORES PRINCIPALES:');
        console.log(`   ├─ id: ${order.id} (ID numérico interno de Shopify)`);
        console.log(`   ├─ order_number: ${order.order_number} (Número de orden visible al cliente)`);
        console.log(`   ├─ name: ${order.name} (Nombre de la orden ej: #1234)`);
        console.log(`   ├─ admin_graphql_api_id: ${order.admin_graphql_api_id}`);
        console.log(`   ├─ checkout_id: ${order.checkout_id || 'N/A'}`);
        console.log(`   ├─ checkout_token: ${order.checkout_token || 'N/A'}`);
        console.log(`   ├─ token: ${order.token}`);
        console.log(`   └─ cart_token: ${order.cart_token || 'N/A'}`);

        console.log('\n📦 LINE ITEMS Y SUS IDs:');
        for (let i = 0; i < order.line_items.length; i++) {
            const item = order.line_items[i];
            console.log(`   [${i + 1}] ${item.name || item.title}`);
            console.log(`       ├─ LINE_ITEM_ID: ${item.id} <-- ¿Este es el 38803584483579?`);
            console.log(`       ├─ product_id: ${item.product_id}`);
            console.log(`       ├─ variant_id: ${item.variant_id}`);
            console.log(`       ├─ sku: ${item.sku}`);
            console.log(`       ├─ quantity: ${item.quantity}`);
            console.log(`       └─ admin_graphql_api_id: ${item.admin_graphql_api_id}`);
        }

        console.log('\n📝 NOTE ATTRIBUTES (Atributos personalizados):');
        if (order.note_attributes && order.note_attributes.length > 0) {
            for (const attr of order.note_attributes) {
                console.log(`   ├─ ${attr.name}: ${attr.value}`);
            }
        } else {
            console.log('   └─ (Sin atributos personalizados)');
        }

        console.log('\n📍 FULFILLMENTS:');
        if (order.fulfillments && order.fulfillments.length > 0) {
            for (const fulfillment of order.fulfillments) {
                console.log(`   ├─ Fulfillment ID: ${fulfillment.id}`);
                console.log(`   ├─ Status: ${fulfillment.status}`);
                console.log(`   ├─ Tracking Number: ${fulfillment.tracking_number || 'N/A'}`);
                for (const lineItem of fulfillment.line_items || []) {
                    console.log(`       └─ Line Item ID: ${lineItem.id} (SKU: ${lineItem.sku})`);
                }
            }
        } else {
            console.log('   └─ (Sin fulfillments)');
        }

        console.log('\n💳 TRANSACTIONS:');
        // Obtener transacciones
        await getOrderTransactions(orderId);

        console.log('\n📊 RESUMEN COMPLETO EN JSON:');
        console.log('-'.repeat(80));
        // Mostrar sección parcial del JSON para no saturar la consola
        const keysToShow = ['id', 'order_number', 'name', 'checkout_id', 'token', 'cart_token'];
        const partialOrder = {};
        for (const key of keysToShow) {
            partialOrder[key] = order[key];
        }
        console.log(JSON.stringify(partialOrder, null, 2));

        return order;
    } catch (error) {
        console.error(`Error obteniendo orden ${orderId}:`, error.response?.data || error.message);
        return null;
    }
}

/**
 * Obtener transacciones de una orden
 */
async function getOrderTransactions(orderId) {
    try {
        const shopName = SHOPIFY_SHOP_DOMAIN?.replace('.myshopify.com', '');
        const url = `https://${shopName}.myshopify.com/admin/api/2024-01/orders/${orderId}/transactions.json`;

        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        for (const txn of response.data.transactions || []) {
            console.log(`   ├─ Transaction ID: ${txn.id}`);
            console.log(`   ├─ Gateway: ${txn.gateway}`);
            console.log(`   ├─ Status: ${txn.status}`);
            console.log(`   ├─ Amount: $${txn.amount}`);
            console.log(`   └─ Authorization: ${txn.authorization || 'N/A'}`);
        }
    } catch (error) {
        console.log('   └─ (No se pudieron obtener transacciones)');
    }
}

/**
 * Buscar una orden por el número que aparece en la imagen
 */
async function searchOrderByNumber(searchNumber) {
    try {
        const shopName = SHOPIFY_SHOP_DOMAIN?.replace('.myshopify.com', '');
        const url = `https://${shopName}.myshopify.com/admin/api/2024-01/orders.json?status=any&limit=50`;

        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        console.log('\n' + '='.repeat(80));
        console.log(`🔎 BUSCANDO ID: ${searchNumber}`);
        console.log('='.repeat(80));

        for (const order of response.data.orders) {
            // Verificar si el ID corresponde a la orden
            if (order.id.toString() === searchNumber) {
                console.log(`✅ Encontrado como ORDER ID en orden #${order.order_number}`);
                return { type: 'order_id', order };
            }

            if (order.checkout_id?.toString() === searchNumber) {
                console.log(`✅ Encontrado como CHECKOUT ID en orden #${order.order_number}`);
                return { type: 'checkout_id', order };
            }

            // Verificar en line items
            for (const item of order.line_items) {
                if (item.id.toString() === searchNumber) {
                    console.log(`✅ Encontrado como LINE_ITEM ID en orden #${order.order_number}`);
                    console.log(`   └─ Producto: ${item.name}, SKU: ${item.sku}`);
                    return { type: 'line_item_id', order, item };
                }
                if (item.variant_id?.toString() === searchNumber) {
                    console.log(`✅ Encontrado como VARIANT ID en orden #${order.order_number}`);
                    console.log(`   └─ Producto: ${item.name}, SKU: ${item.sku}`);
                    return { type: 'variant_id', order, item };
                }
                if (item.product_id?.toString() === searchNumber) {
                    console.log(`✅ Encontrado como PRODUCT ID en orden #${order.order_number}`);
                    console.log(`   └─ Producto: ${item.name}, SKU: ${item.sku}`);
                    return { type: 'product_id', order, item };
                }
            }
        }

        console.log(`❌ ID ${searchNumber} no encontrado en las últimas 50 órdenes`);
        return null;
    } catch (error) {
        console.error('Error buscando orden:', error.response?.data || error.message);
        return null;
    }
}

/**
 * Comparar los IDs de la imagen
 */
async function compareIds() {
    const idEnNV = '6824213053691';      // El que aparece actualmente en la glosa de la NV
    const idCorrecto = '38803584483579';  // El que debería aparecer según el usuario

    console.log('\n' + '='.repeat(80));
    console.log('⚖️  COMPARACIÓN DE IDs');
    console.log('='.repeat(80));
    console.log(`ID que aparece en NV (Glosa): ${idEnNV}`);
    console.log(`ID que debería aparecer:      ${idCorrecto}`);
    console.log('');

    // Buscar qué es cada ID
    console.log('\n📌 Analizando ID en NV:', idEnNV);
    const resultNV = await searchOrderByNumber(idEnNV);

    console.log('\n📌 Analizando ID correcto:', idCorrecto);
    const resultCorrecto = await searchOrderByNumber(idCorrecto);

    console.log('\n' + '='.repeat(80));
    console.log('📊 CONCLUSIONES');
    console.log('='.repeat(80));

    if (resultNV) {
        console.log(`\nEl ID ${idEnNV} es un ${resultNV.type.toUpperCase()}`);
    } else {
        console.log(`\nEl ID ${idEnNV} podría ser un ORDER_ID (es el campo order.id)`);
    }

    if (resultCorrecto) {
        console.log(`El ID ${idCorrecto} es un ${resultCorrecto.type.toUpperCase()}`);
        if (resultCorrecto.type === 'line_item_id') {
            console.log('\n🎯 RECOMENDACIÓN: Si necesitas que la referencia sea el LINE_ITEM_ID');
            console.log('   entonces debes modificar createClientAndOrderShopify.js para usar:');
            console.log('   orderData.line_items[0].id en lugar de orderData.id');
        } else if (resultCorrecto.type === 'variant_id') {
            console.log('\n🎯 RECOMENDACIÓN: Si necesitas que la referencia sea el VARIANT_ID');
            console.log('   entonces debes modificar createClientAndOrderShopify.js para usar:');
            console.log('   orderData.line_items[0].variant_id en lugar de orderData.id');
        }
    }
}

// Ejecutar script
async function main() {
    console.log('╔' + '═'.repeat(78) + '╗');
    console.log('║' + ' '.repeat(20) + 'ANÁLISIS DE ESTRUCTURA DE DATOS SHOPIFY' + ' '.repeat(18) + '║');
    console.log('╚' + '═'.repeat(78) + '╝');

    const orderId = process.argv[2];

    // Mostrar info del shop
    await getShopInfo();

    // Si se proporcionó un orderId, analizar esa orden
    if (orderId) {
        await getOrderDetails(orderId);
    } else {
        // Listar órdenes recientes
        await listRecentOrders(5);
    }

    // Comparar los IDs mencionados por el usuario
    await compareIds();

    console.log('\n' + '='.repeat(80));
    console.log('ℹ️  NOTAS SOBRE LOS IDs DE SHOPIFY');
    console.log('='.repeat(80));
    console.log(`
Los principales IDs en una orden de Shopify son:

1. order.id - ID numérico interno único de la orden (ej: 6824213053691)
   └─ Este es el que se usa actualmente como "Referencia" en la NV

2. order.order_number - Número secuencial de la orden (ej: 1234)
   └─ Es más corto y human-readable

3. order.name - Nombre de la orden con prefijo (ej: #SHPFY1234)
   └─ Incluye cualquier prefijo configurado en Shopify

4. line_item.id - ID de cada producto dentro de la orden (ej: 38803584483579)
   └─ Cada producto tiene su propio ID único

5. line_item.variant_id - ID de la variante del producto
   └─ Identifica la variante específica (talla, color, etc.)

6. checkout_id - ID del checkout asociado
   └─ Solo disponible si la orden pasó por checkout estándar
`);
}

main().catch(console.error);
