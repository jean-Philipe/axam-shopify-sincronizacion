/**
 * API REST Intermedia (Middleware) para interactuar con el ERP Manager+
 * 
 * Este servidor actúa como intermediario entre el cliente y el ERP externo,
 * manejando la autenticación y las peticiones de datos.
 */

// Importaciones necesarias
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

// Configuración de Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors()); // Permite peticiones desde cualquier origen
app.use(express.json()); // Permite parsear JSON en las peticiones

// Variables de entorno del ERP
const ERP_BASE_URL = process.env.ERP_BASE_URL;
const ERP_USERNAME = process.env.ERP_USERNAME;
const ERP_PASSWORD = process.env.ERP_PASSWORD;
const RUT_EMPRESA = process.env.RUT_EMPRESA;

// Variable para almacenar el token de autenticación en memoria
let authToken = null;
let tokenExpirationTime = null;

/**
 * Función para autenticarse con el ERP Manager+
 * 
 * Realiza una petición POST al endpoint de autenticación del ERP
 * y almacena el token recibido en memoria.
 * 
 * @returns {Promise<string>} El token de autenticación
 */
async function authenticateWithERP() {
    try {
        console.log('🔐 Autenticando con el ERP Manager+...');

        const response = await axios.post(`${ERP_BASE_URL}/auth/`, {
            username: ERP_USERNAME,
            password: ERP_PASSWORD
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Extraer el token de la respuesta
        authToken = response.data.auth_token;

        // Establecer tiempo de expiración (asumiendo 1 hora de validez)
        // Ajusta este valor según la documentación del ERP
        tokenExpirationTime = Date.now() + (60 * 60 * 1000); // 1 hora

        console.log('✅ Autenticación exitosa');
        return authToken;

    } catch (error) {
        console.error('❌ Error en la autenticación:', error.response?.data || error.message);
        throw new Error('Error al autenticarse con el ERP: ' + (error.response?.data?.message || error.message));
    }
}

/**
 * Función para obtener el token de autenticación
 * 
 * Verifica si el token actual es válido, si no lo es o no existe,
 * realiza una nueva autenticación.
 * 
 * @returns {Promise<string>} El token de autenticación válido
 */
async function getAuthToken() {
    // Verificar si el token existe y no ha expirado
    if (authToken && tokenExpirationTime && Date.now() < tokenExpirationTime) {
        return authToken;
    }

    // Si no hay token o ha expirado, autenticarse nuevamente
    return await authenticateWithERP();
}

/**
 * Endpoint para consultar productos del ERP
 * 
 * GET /api/local/productos/:sku?
 * 
 * Parámetros:
 * - sku (opcional): Código del producto específico a consultar
 * 
 * Ejemplos:
 * - GET /api/local/productos -> Consulta todos los productos (si está disponible)
 * - GET /api/local/productos/ABC123 -> Consulta el producto con código ABC123
 */
app.get('/api/local/productos/:sku?', async (req, res) => {
    try {
        const codProducto = req.params.sku;

        // Obtener el token de autenticación válido
        const token = await getAuthToken();

        // Construir la URL según si se proporciona un código de producto o no
        let url;
        if (codProducto) {
            // Consultar un producto específico
            url = `${ERP_BASE_URL}/products/${RUT_EMPRESA}/${codProducto}/`;
        } else {
            // Si no se proporciona código, intentar consultar la lista general
            // Nota: Ajusta esta URL según la documentación real del ERP
            url = `${ERP_BASE_URL}/products/${RUT_EMPRESA}/`;
        }

        console.log(`📦 Consultando productos desde: ${url}`);

        // Realizar la petición al ERP con el token de autorización
        const response = await axios.get(url, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${token}`
            }
        });

        // Retornar los datos recibidos del ERP
        res.json({
            success: true,
            data: response.data,
            message: codProducto ? `Producto ${codProducto} consultado exitosamente` : 'Lista de productos consultada exitosamente'
        });

    } catch (error) {
        console.error('❌ Error al consultar productos:', error.response?.data || error.message);

        // Manejar diferentes tipos de errores
        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data?.message || error.message || 'Error desconocido';

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: error.response?.data || null
        });
    }
});

/**
 * Endpoint para sincronizar stocks entre Manager+ y Shopify
 * 
 * POST /api/sync/stocks
 * GET /api/sync/stocks?sku=ABC123
 * GET /api/sync/stocks?all=true
 * 
 * Parámetros:
 * - sku (query, opcional): SKU específico a sincronizar
 * - all (query, opcional): Sincronizar todos los productos
 * - dryRun (query, opcional): Simular sin hacer cambios reales
 * 
 * Body (POST, opcional):
 * - skus: Array de SKUs a sincronizar
 * - dryRun: Boolean para simular sin cambios
 */
const { syncProductStock, syncMultipleProducts, syncAllProducts } = require('./syncStocks');
const { processOrderNotification, getLastWebhook, clearLastWebhook, reprocessLastWebhook } = require('./createClientAndOrderShopify');
const { WebhookQueue, getTimestamp } = require('./webhookQueue');

// Crear instancia de la cola de webhooks
const webhookQueue = new WebhookQueue({
    cacheTTL: 24 * 60 * 60 * 1000,     // 24 horas
    minRequestDelay: 1500,              // 1.5 segundos entre peticiones
    maxRetries: 5,                      // 5 reintentos máximo
    baseRetryDelay: 5000                // 5 segundos delay base
});

// Configurar el procesador de webhooks
webhookQueue.setProcessor(async (webhookData, topic, shop) => {
    // Solo procesar eventos de órdenes
    if (topic === 'orders/create' || topic === 'orders/paid' || topic === 'orders/fulfilled') {
        return await processOrderNotification(webhookData);
    } else {
        console.log(`[${getTimestamp()}] [WEBHOOK] Evento ${topic} no procesado`);
        return { success: true, skipped: true, reason: 'event_not_handled' };
    }
});

app.post('/api/sync/stocks', async (req, res) => {
    try {
        const { skus, dryRun = false } = req.body;

        if (!skus || !Array.isArray(skus) || skus.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Se requiere un array de SKUs en el body'
            });
        }

        const results = await syncMultipleProducts(skus, { dryRun });

        res.json({
            success: true,
            dryRun,
            results
        });

    } catch (error) {
        console.error('❌ Error en sincronización:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/sync/stocks', async (req, res) => {
    try {
        const { sku, all, dryRun } = req.query;
        const isDryRun = dryRun === 'true' || dryRun === true;

        if (all === 'true' || all === true) {
            // Sincronizar todos los productos
            const results = await syncAllProducts({ dryRun: isDryRun });
            res.json({
                success: true,
                dryRun: isDryRun,
                results
            });
        } else if (sku) {
            // Sincronizar un producto específico
            const result = await syncProductStock(sku, { dryRun: isDryRun });
            res.json({
                success: result.success,
                dryRun: isDryRun,
                result
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Se requiere el parámetro "sku" o "all=true"'
            });
        }

    } catch (error) {
        console.error('❌ Error en sincronización:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint para recibir webhooks de Shopify
 * 
 * POST /api/webhooks/shopify
 * 
 * Shopify enviará notificaciones cuando ocurran eventos como:
 * - Nuevas órdenes (order/create, order/paid, order/fulfilled)
 */
app.post('/api/webhooks/shopify', async (req, res) => {
    try {
        // Shopify envía los webhooks con un header X-Shopify-Topic
        const topic = req.headers['x-shopify-topic'];
        const shop = req.headers['x-shopify-shop-domain'];

        console.log(`[${getTimestamp()}] [WEBHOOK] Webhook recibido de Shopify: ${topic || 'unknown'} desde ${shop || 'unknown'}`);

        // Extraer datos de la orden
        const orderData = req.body;
        const orderId = orderData.id?.toString() || orderData.order_id?.toString() || 'N/A';

        // Encolar el webhook para procesamiento
        const queueResult = webhookQueue.enqueue(orderData, topic, shop);

        // Responder inmediatamente a Shopify (200 OK)
        // Shopify requiere respuesta rápida (menos de 20 segundos)
        res.status(200).json({
            success: true,
            message: 'Webhook recibido y encolado',
            orderId,
            queued: queueResult.queued,
            position: queueResult.position,
            reason: queueResult.reason
        });

    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ Error al procesar webhook de Shopify:`, error.message);
        // Aún así responder 200 para evitar reintentos de Shopify
        res.status(200).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint para verificar el webhook (GET request de Shopify)
 * 
 * Shopify puede hacer un GET para verificar que el endpoint existe
 */
app.get('/api/webhooks/shopify', (req, res) => {
    res.json({
        success: true,
        message: 'Webhook endpoint activo para Shopify',
        timestamp: new Date().toISOString()
    });
});

/**
 * Endpoint para reprocesar el último webhook recibido
 * 
 * POST /api/webhooks/shopify/reprocess
 * GET /api/webhooks/shopify/reprocess?force=true
 * 
 * Útil para reintentar crear cliente y orden si falló anteriormente
 */
app.post('/api/webhooks/shopify/reprocess', async (req, res) => {
    try {
        const force = req.query.force === 'true' || req.body.force === true;
        console.log(`[REPROCESS] Reprocesando último webhook de Shopify${force ? ' (forzado)' : ''}...`);
        const result = await reprocessLastWebhook(force);

        res.json({
            success: result.success,
            message: result.success ? 'Webhook reprocesado exitosamente' : 'Error al reprocesar webhook',
            result: result
        });
    } catch (error) {
        console.error(`[REPROCESS] Error: ${error.message}`);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/webhooks/shopify/reprocess', async (req, res) => {
    try {
        const force = req.query.force === 'true';
        console.log(`[REPROCESS] Reprocesando último webhook de Shopify${force ? ' (forzado)' : ''}...`);
        const result = await reprocessLastWebhook(force);

        res.json({
            success: result.success,
            message: result.success ? 'Webhook reprocesado exitosamente' : 'Error al reprocesar webhook',
            result: result
        });
    } catch (error) {
        console.error(`[REPROCESS] Error: ${error.message}`);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint para ver información del último webhook recibido
 * 
 * GET /api/webhooks/shopify/last
 */
app.get('/api/webhooks/shopify/last', async (req, res) => {
    const lastWebhook = getLastWebhook();

    if (!lastWebhook) {
        return res.status(404).json({
            success: false,
            message: 'No hay webhook almacenado'
        });
    }

    const orderId = lastWebhook.id?.toString() ||
        lastWebhook.order_id?.toString() ||
        'N/A';

    res.json({
        success: true,
        orderId: orderId,
        webhook: lastWebhook,
        timestamp: new Date().toISOString()
    });
});

/**
 * Endpoint para limpiar el último webhook almacenado
 * 
 * DELETE /api/webhooks/shopify/last
 */
app.delete('/api/webhooks/shopify/last', async (req, res) => {
    clearLastWebhook();
    res.json({
        success: true,
        message: 'Último webhook limpiado'
    });
});

/**
 * Endpoint para ver el estado de la cola de webhooks
 * 
 * GET /api/webhooks/shopify/queue/status
 */
app.get('/api/webhooks/shopify/queue/status', (req, res) => {
    const status = webhookQueue.getStatus();
    res.json({
        success: true,
        ...status,
        timestamp: new Date().toISOString()
    });
});

/**
 * Endpoint para ver órdenes procesadas recientemente
 * 
 * GET /api/webhooks/shopify/queue/processed?limit=50
 */
app.get('/api/webhooks/shopify/queue/processed', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const orders = webhookQueue.getProcessedOrders(limit);
    res.json({
        success: true,
        count: orders.length,
        orders,
        timestamp: new Date().toISOString()
    });
});

/**
 * Endpoint para forzar reprocesamiento de una orden específica
 * 
 * POST /api/webhooks/shopify/queue/reprocess/:orderId
 */
app.post('/api/webhooks/shopify/queue/reprocess/:orderId', (req, res) => {
    const { orderId } = req.params;

    if (!orderId) {
        return res.status(400).json({
            success: false,
            error: 'Se requiere orderId'
        });
    }

    const cleared = webhookQueue.forceReprocess(orderId);
    res.json({
        success: true,
        message: `Orden ${orderId} lista para reprocesar. Envía el webhook nuevamente.`,
        cleared
    });
});

/**
 * Endpoint de salud/health check
 * 
 * GET /health
 * 
 * Permite verificar que el servidor está funcionando correctamente
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'API Middleware funcionando correctamente',
        timestamp: new Date().toISOString()
    });
});

/**
 * Endpoint de información
 * 
 * GET /
 * 
 * Muestra información básica sobre la API
 */
app.get('/', (req, res) => {
    res.json({
        name: 'API Manager Express - Axam Middleware',
        version: '1.0.0',
        description: 'API REST intermedia para interactuar con el ERP Manager+',
        endpoints: {
            health: '/health',
            productos: '/api/local/productos/:sku?',
            syncStocks: '/api/sync/stocks',
            webhook: '/api/webhooks/shopify',
            webhookReprocess: '/api/webhooks/shopify/reprocess',
            webhookLast: '/api/webhooks/shopify/last',
            queueStatus: '/api/webhooks/shopify/queue/status',
            queueProcessed: '/api/webhooks/shopify/queue/processed',
            queueReprocess: '/api/webhooks/shopify/queue/reprocess/:orderId'
        }
    });
});

/**
 * Iniciar el servidor
 */
app.listen(PORT, () => {
    console.log('🚀 Servidor iniciado correctamente');
    console.log(`📍 Puerto: ${PORT}`);
    console.log(`🌐 URL base: http://localhost:${PORT}`);
    console.log(`📋 Endpoints disponibles:`);
    console.log(`   - GET /health`);
    console.log(`   - GET /api/local/productos/:sku?`);
    console.log(`   - GET /api/sync/stocks?sku=ABC123`);
    console.log(`   - GET /api/sync/stocks?all=true`);
    console.log(`   - POST /api/sync/stocks`);
    console.log(`   - POST /api/webhooks/shopify`);
    console.log(`   - POST/GET /api/webhooks/shopify/reprocess?force=true`);
    console.log(`   - GET /api/webhooks/shopify/last`);
    console.log(`   - DELETE /api/webhooks/shopify/last`);
    console.log(`   - GET /api/webhooks/shopify/queue/status`);
    console.log(`   - GET /api/webhooks/shopify/queue/processed`);
    console.log(`   - POST /api/webhooks/shopify/queue/reprocess/:orderId`);
    console.log(`\n💡 Realizando autenticación inicial con el ERP...`);

    // Realizar una autenticación inicial al iniciar el servidor
    authenticateWithERP()
        .then(() => {
            console.log('✅ Servidor listo para recibir peticiones\n');
        })
        .catch((error) => {
            console.warn('⚠️  Advertencia: No se pudo autenticar inicialmente. Se intentará al hacer la primera petición.');
            console.warn(`   Error: ${error.message}\n`);
        });
});

// Manejo de errores no capturados
process.on('unhandledRejection', (error) => {
    console.error('❌ Error no manejado:', error);
});

