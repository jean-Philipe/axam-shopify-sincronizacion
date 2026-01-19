/**
 * Módulo de Cola de Procesamiento de Webhooks
 * 
 * Implementa:
 * - Cola FIFO para procesar webhooks secuencialmente
 * - Cache de órdenes procesadas para prevenir duplicados
 * - Retry con backoff exponencial para errores de rate limiting
 * - Logging mejorado con timestamps
 */

/**
 * Generar timestamp formateado para logs
 * @returns {string} Timestamp en formato HH:MM:SS
 */
function getTimestamp() {
    return new Date().toLocaleTimeString('es-CL', { hour12: false });
}

/**
 * Serializar error para logging correcto
 * @param {any} error - Error a serializar
 * @returns {string} Mensaje de error legible
 */
function serializeError(error) {
    if (typeof error === 'string') {
        return error;
    }
    if (error instanceof Error) {
        return error.message;
    }
    if (error && typeof error === 'object') {
        // Intentar extraer mensaje de respuesta de axios
        if (error.response?.data) {
            const data = error.response.data;
            return data.mensaje || data.message || data.error || JSON.stringify(data);
        }
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }
    return String(error);
}

/**
 * Helper para esperar un tiempo determinado
 * @param {number} ms - Milisegundos a esperar
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clase para manejar la cola de webhooks
 */
class WebhookQueue {
    constructor(options = {}) {
        // Cola de webhooks pendientes
        this.queue = [];
        
        // Cache de órdenes procesadas: orderId -> { timestamp, status, result }
        this.processedOrders = new Map();
        
        // Estado del procesador
        this.isProcessing = false;
        
        // Configuración
        this.config = {
            // TTL del cache en ms (24 horas por defecto)
            cacheTTL: options.cacheTTL || 24 * 60 * 60 * 1000,
            // Delay mínimo entre peticiones al ERP (ms)
            minRequestDelay: options.minRequestDelay || 1500,
            // Máximo de reintentos por webhook
            maxRetries: options.maxRetries || 5,
            // Delay base para backoff exponencial (ms)
            baseRetryDelay: options.baseRetryDelay || 5000,
            // Máximo delay de retry (ms)
            maxRetryDelay: options.maxRetryDelay || 120000,
            // Intervalo de limpieza del cache (1 hora)
            cleanupInterval: options.cleanupInterval || 60 * 60 * 1000
        };
        
        // Estadísticas
        this.stats = {
            total: 0,
            processed: 0,
            duplicates: 0,
            failed: 0,
            retries: 0
        };
        
        // Iniciar limpieza periódica del cache
        this.startCacheCleanup();
        
        console.log(`[${getTimestamp()}] 📊 Cola de webhooks inicializada`);
        console.log(`   └─ TTL cache: ${this.config.cacheTTL / 1000 / 60 / 60}h`);
        console.log(`   └─ Delay entre peticiones: ${this.config.minRequestDelay}ms`);
        console.log(`   └─ Max reintentos: ${this.config.maxRetries}`);
    }
    
    /**
     * Iniciar limpieza periódica del cache
     */
    startCacheCleanup() {
        setInterval(() => {
            this.cleanupCache();
        }, this.config.cleanupInterval);
    }
    
    /**
     * Limpiar entradas antiguas del cache
     */
    cleanupCache() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [orderId, data] of this.processedOrders.entries()) {
            if (now - data.timestamp > this.config.cacheTTL) {
                this.processedOrders.delete(orderId);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`[${getTimestamp()}] 🧹 Cache limpiado: ${cleaned} entradas antiguas eliminadas`);
        }
    }
    
    /**
     * Verificar si una orden ya fue procesada o está en proceso
     * @param {string} orderId - ID de la orden
     * @returns {boolean} true si ya está procesada o en proceso
     */
    isOrderProcessed(orderId) {
        if (!orderId) return false;
        
        const cached = this.processedOrders.get(orderId);
        if (!cached) return false;
        
        // Verificar TTL
        if (Date.now() - cached.timestamp > this.config.cacheTTL) {
            this.processedOrders.delete(orderId);
            return false;
        }
        
        return cached.status === 'completed' || cached.status === 'processing';
    }
    
    /**
     * Marcar orden como en proceso
     * @param {string} orderId - ID de la orden
     */
    markAsProcessing(orderId) {
        this.processedOrders.set(orderId, {
            timestamp: Date.now(),
            status: 'processing',
            result: null
        });
    }
    
    /**
     * Marcar orden como completada
     * @param {string} orderId - ID de la orden
     * @param {Object} result - Resultado del procesamiento
     */
    markAsCompleted(orderId, result) {
        this.processedOrders.set(orderId, {
            timestamp: Date.now(),
            status: 'completed',
            result
        });
        this.stats.processed++;
    }
    
    /**
     * Marcar orden como fallida
     * @param {string} orderId - ID de la orden
     * @param {string} error - Mensaje de error
     */
    markAsFailed(orderId, error) {
        this.processedOrders.set(orderId, {
            timestamp: Date.now(),
            status: 'failed',
            error
        });
        this.stats.failed++;
    }
    
    /**
     * Agregar webhook a la cola
     * @param {Object} webhookData - Datos del webhook
     * @param {string} topic - Tipo de evento (orders/create, etc)
     * @param {string} shop - Dominio de la tienda
     * @returns {Object} Resultado de agregar a la cola
     */
    enqueue(webhookData, topic, shop) {
        const orderId = webhookData.id?.toString() || webhookData.order_id?.toString();
        
        if (!orderId) {
            console.log(`[${getTimestamp()}] ⚠️  Webhook sin ID de orden, ignorando`);
            return { queued: false, reason: 'missing_order_id' };
        }
        
        this.stats.total++;
        
        // Verificar duplicado
        if (this.isOrderProcessed(orderId)) {
            this.stats.duplicates++;
            console.log(`[${getTimestamp()}] 🔄 Orden ${orderId}: DUPLICADA - Ya procesada o en proceso, ignorando`);
            return { 
                queued: false, 
                reason: 'duplicate',
                orderId,
                cacheStatus: this.processedOrders.get(orderId)?.status
            };
        }
        
        // Verificar si ya está en la cola
        const alreadyQueued = this.queue.some(item => item.orderId === orderId);
        if (alreadyQueued) {
            this.stats.duplicates++;
            console.log(`[${getTimestamp()}] 🔄 Orden ${orderId}: Ya está en la cola de espera, ignorando`);
            return { queued: false, reason: 'already_queued', orderId };
        }
        
        // Agregar a la cola
        const queueItem = {
            orderId,
            webhookData,
            topic,
            shop,
            enqueuedAt: Date.now(),
            retryCount: 0
        };
        
        this.queue.push(queueItem);
        console.log(`[${getTimestamp()}] 📥 Orden ${orderId}: Agregada a la cola (posición: ${this.queue.length})`);
        
        // Iniciar procesamiento si no está activo
        if (!this.isProcessing) {
            this.processQueue();
        }
        
        return { 
            queued: true, 
            orderId, 
            position: this.queue.length 
        };
    }
    
    /**
     * Procesar la cola de webhooks
     */
    async processQueue() {
        if (this.isProcessing) {
            return;
        }
        
        this.isProcessing = true;
        console.log(`[${getTimestamp()}] ⚙️  Iniciando procesamiento de cola (${this.queue.length} pendientes)`);
        
        while (this.queue.length > 0) {
            const item = this.queue[0];
            
            try {
                // Marcar como en proceso
                this.markAsProcessing(item.orderId);
                
                console.log(`[${getTimestamp()}] 🔄 Orden ${item.orderId}: Procesando... (intento ${item.retryCount + 1}/${this.config.maxRetries + 1})`);
                
                // Procesar el webhook
                const result = await this.processWebhook(item);
                
                if (result.success) {
                    this.markAsCompleted(item.orderId, result);
                    console.log(`[${getTimestamp()}] ✅ Orden ${item.orderId}: Procesada exitosamente`);
                    this.queue.shift(); // Remover de la cola
                } else if (result.retry && item.retryCount < this.config.maxRetries) {
                    // Necesita retry
                    item.retryCount++;
                    this.stats.retries++;
                    
                    const retryDelay = Math.min(
                        this.config.baseRetryDelay * Math.pow(2, item.retryCount - 1),
                        this.config.maxRetryDelay
                    );
                    
                    console.log(`[${getTimestamp()}] ⏳ Orden ${item.orderId}: Rate limit, esperando ${retryDelay / 1000}s antes de reintentar...`);
                    
                    // Marcar como pendiente nuevamente
                    this.processedOrders.delete(item.orderId);
                    
                    await delay(retryDelay);
                    // No remover de la cola, se reintentará
                } else {
                    // Falló definitivamente
                    this.markAsFailed(item.orderId, result.error);
                    console.log(`[${getTimestamp()}] ❌ Orden ${item.orderId}: Falló después de ${item.retryCount + 1} intentos - ${result.error}`);
                    this.queue.shift(); // Remover de la cola
                }
                
            } catch (error) {
                const errorMsg = serializeError(error);
                
                // Verificar si es error de rate limit
                const isRateLimit = error.response?.status === 429 || 
                                   errorMsg.includes('429') || 
                                   errorMsg.toLowerCase().includes('rate limit') ||
                                   errorMsg.toLowerCase().includes('too many requests');
                
                if (isRateLimit && item.retryCount < this.config.maxRetries) {
                    item.retryCount++;
                    this.stats.retries++;
                    
                    const retryDelay = Math.min(
                        this.config.baseRetryDelay * Math.pow(2, item.retryCount - 1),
                        this.config.maxRetryDelay
                    );
                    
                    console.log(`[${getTimestamp()}] ⏳ Orden ${item.orderId}: ERROR 429 (Rate Limit), esperando ${retryDelay / 1000}s...`);
                    
                    // Marcar como pendiente nuevamente
                    this.processedOrders.delete(item.orderId);
                    
                    await delay(retryDelay);
                } else {
                    this.markAsFailed(item.orderId, errorMsg);
                    console.log(`[${getTimestamp()}] ❌ Orden ${item.orderId}: Error crítico - ${errorMsg}`);
                    this.queue.shift();
                }
            }
            
            // Delay mínimo entre peticiones
            if (this.queue.length > 0) {
                await delay(this.config.minRequestDelay);
            }
        }
        
        this.isProcessing = false;
        console.log(`[${getTimestamp()}] ✨ Cola de webhooks vacía. Estadísticas: ${JSON.stringify(this.stats)}`);
    }
    
    /**
     * Procesar un webhook individual (debe ser sobrescrito)
     * @param {Object} item - Item de la cola
     * @returns {Promise<Object>} Resultado del procesamiento
     */
    async processWebhook(item) {
        // Este método debe ser sobrescrito con la lógica real
        throw new Error('processWebhook debe ser implementado');
    }
    
    /**
     * Establecer el procesador de webhooks
     * @param {Function} processor - Función async que procesa el webhook
     */
    setProcessor(processor) {
        this.processWebhook = async (item) => {
            try {
                const result = await processor(item.webhookData, item.topic, item.shop);
                return {
                    success: result.success !== false,
                    retry: false,
                    ...result
                };
            } catch (error) {
                const errorMsg = serializeError(error);
                const isRateLimit = error.response?.status === 429 || 
                                   errorMsg.includes('429') || 
                                   errorMsg.toLowerCase().includes('rate limit');
                
                return {
                    success: false,
                    retry: isRateLimit,
                    error: errorMsg
                };
            }
        };
    }
    
    /**
     * Obtener estado de la cola
     * @returns {Object} Estado actual
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            isProcessing: this.isProcessing,
            cacheSize: this.processedOrders.size,
            stats: { ...this.stats },
            pendingOrders: this.queue.map(item => ({
                orderId: item.orderId,
                enqueuedAt: new Date(item.enqueuedAt).toISOString(),
                retryCount: item.retryCount
            }))
        };
    }
    
    /**
     * Obtener órdenes procesadas recientemente
     * @param {number} limit - Límite de resultados
     * @returns {Array} Lista de órdenes procesadas
     */
    getProcessedOrders(limit = 50) {
        const orders = [];
        for (const [orderId, data] of this.processedOrders.entries()) {
            orders.push({
                orderId,
                status: data.status,
                timestamp: new Date(data.timestamp).toISOString(),
                ...(data.error && { error: data.error })
            });
        }
        
        // Ordenar por timestamp descendente
        orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        return orders.slice(0, limit);
    }
    
    /**
     * Forzar reprocesamiento de una orden
     * @param {string} orderId - ID de la orden
     * @returns {boolean} true si se puede reprocesar
     */
    forceReprocess(orderId) {
        // Remover del cache para permitir reprocesamiento
        this.processedOrders.delete(orderId);
        console.log(`[${getTimestamp()}] 🔃 Orden ${orderId}: Cache limpiado, se permitirá reprocesar`);
        return true;
    }
}

// Exportar
module.exports = {
    WebhookQueue,
    serializeError,
    delay,
    getTimestamp
};
