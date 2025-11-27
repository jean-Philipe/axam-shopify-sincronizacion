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
            syncStocks: '/api/sync/stocks'
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

