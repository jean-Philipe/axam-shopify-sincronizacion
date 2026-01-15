/**
 * Scheduler para sincronización automática de stocks y precios
 * 
 * Este script ejecuta la sincronización automáticamente todos los días
 * a las 6:00 PM en hora de Santiago de Chile
 */

require('dotenv').config();
const cron = require('node-cron');
const { syncAllProducts: syncAllStocks } = require('./syncStocks');
const { syncAllProducts: syncAllPrices } = require('./syncPricesShopify');

// Configuración
const TIMEZONE = 'America/Santiago'; // Zona horaria de Santiago de Chile
const CONCURRENCY = process.env.SYNC_CONCURRENCY ? parseInt(process.env.SYNC_CONCURRENCY) : 5;
const MAX_RETRIES = process.env.SYNC_MAX_RETRIES ? parseInt(process.env.SYNC_MAX_RETRIES) : 3;

// Colores para logs (si se ejecuta en terminal que los soporte)
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

/**
 * Función para obtener fecha/hora formateada
 */
function getFormattedDateTime() {
    const now = new Date();
    return now.toLocaleString('es-CL', {
        timeZone: TIMEZONE,
        dateStyle: 'full',
        timeStyle: 'medium'
    });
}

/**
 * Función para ejecutar la sincronización de stocks
 */
async function executeStockSync() {
    const startTime = Date.now();
    const formattedStartTime = getFormattedDateTime();
    
    console.log('\n' + '='.repeat(70));
    console.log(`${colors.cyan}📦 SINCRONIZACIÓN DE STOCKS${colors.reset}`);
    console.log(`${colors.bright}📅 Fecha/Hora (Santiago): ${formattedStartTime}${colors.reset}`);
    console.log(`${colors.bright}🔄 Origen: Manager+ → Destino: Shopify${colors.reset}`);
    console.log('='.repeat(70));
    
    try {
        const options = {
            dryRun: false, // SIEMPRE sincronización real
            concurrency: CONCURRENCY,
            maxRetries: MAX_RETRIES,
            retryDelay: 2000
        };
        
        const results = await syncAllStocks(options);
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        const formattedEndTime = getFormattedDateTime();
        
        console.log('\n' + '='.repeat(70));
        console.log(`${colors.green}✅ Sincronización de STOCKS completada exitosamente${colors.reset}`);
        console.log(`${colors.bright}📅 Finalizada a las: ${formattedEndTime}${colors.reset}`);
        console.log(`${colors.bright}⏱️  Duración total: ${duration} segundos${colors.reset}`);
        console.log('='.repeat(70));
        
        // Resumen rápido
        console.log(`\n📊 Resumen de STOCKS:`);
        console.log(`   ${colors.green}✅ Actualizados: ${results.updated}${colors.reset}`);
        console.log(`   ${colors.blue}ℹ️  Sin cambios: ${results.noChange}${colors.reset}`);
        console.log(`   ${colors.yellow}⏭️  Omitidos: ${results.skipped}${colors.reset}`);
        if (results.errors > 0) {
            console.log(`   ${colors.red}❌ Errores: ${results.errors}${colors.reset}`);
        }
        console.log('');
        
        return results;
        
    } catch (error) {
        const formattedErrorTime = getFormattedDateTime();
        console.error('\n' + '='.repeat(70));
        console.error(`${colors.red}❌ ERROR FATAL en sincronización de STOCKS${colors.reset}`);
        console.error(`${colors.bright}📅 Hora del error: ${formattedErrorTime}${colors.reset}`);
        console.error(`${colors.red}💥 Error: ${error.message}${colors.reset}`);
        console.error('='.repeat(70));
        console.error(`${colors.yellow}⚠️  La sincronización de precios se ejecutará de todas formas...${colors.reset}\n`);
        
        // No lanzar el error para que el scheduler continúe funcionando
        // Solo loguear para debugging
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
            console.error('');
        }
        
        return null;
    }
}

/**
 * Función para ejecutar la sincronización de precios
 */
async function executePriceSync() {
    const startTime = Date.now();
    const formattedStartTime = getFormattedDateTime();
    
    console.log('\n' + '='.repeat(70));
    console.log(`${colors.cyan}💰 SINCRONIZACIÓN DE PRECIOS${colors.reset}`);
    console.log(`${colors.bright}📅 Fecha/Hora (Santiago): ${formattedStartTime}${colors.reset}`);
    console.log(`${colors.bright}🔄 Origen: Manager+ (Lista 18) → Destino: Shopify${colors.reset}`);
    console.log('='.repeat(70));
    
    try {
        const options = {
            dryRun: false, // SIEMPRE sincronización real
            concurrency: CONCURRENCY,
            maxRetries: MAX_RETRIES,
            retryDelay: 2000
        };
        
        const results = await syncAllPrices(options);
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        const formattedEndTime = getFormattedDateTime();
        
        console.log('\n' + '='.repeat(70));
        console.log(`${colors.green}✅ Sincronización de PRECIOS completada exitosamente${colors.reset}`);
        console.log(`${colors.bright}📅 Finalizada a las: ${formattedEndTime}${colors.reset}`);
        console.log(`${colors.bright}⏱️  Duración total: ${duration} segundos${colors.reset}`);
        console.log('='.repeat(70));
        
        // Resumen rápido
        console.log(`\n📊 Resumen de PRECIOS:`);
        console.log(`   ${colors.green}✅ Actualizados: ${results.updated}${colors.reset}`);
        console.log(`   ${colors.blue}ℹ️  Sin cambios: ${results.noChange}${colors.reset}`);
        console.log(`   ${colors.yellow}⏭️  Omitidos: ${results.skipped}${colors.reset}`);
        if (results.errors > 0) {
            console.log(`   ${colors.red}❌ Errores: ${results.errors}${colors.reset}`);
        }
        console.log('');
        
        return results;
        
    } catch (error) {
        const formattedErrorTime = getFormattedDateTime();
        console.error('\n' + '='.repeat(70));
        console.error(`${colors.red}❌ ERROR FATAL en sincronización de PRECIOS${colors.reset}`);
        console.error(`${colors.bright}📅 Hora del error: ${formattedErrorTime}${colors.reset}`);
        console.error(`${colors.red}💥 Error: ${error.message}${colors.reset}`);
        console.error('='.repeat(70) + '\n');
        
        // No lanzar el error para que el scheduler continúe funcionando
        // Solo loguear para debugging
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
            console.error('');
        }
        
        return null;
    }
}

/**
 * Función para ejecutar todas las sincronizaciones (stocks y precios)
 */
async function executeSync() {
    const globalStartTime = Date.now();
    const formattedStartTime = getFormattedDateTime();
    
    console.log('\n' + '='.repeat(70));
    console.log(`${colors.cyan}🕐 Iniciando sincronización automática completa${colors.reset}`);
    console.log(`${colors.bright}📅 Fecha/Hora (Santiago): ${formattedStartTime}${colors.reset}`);
    console.log(`${colors.bright}📋 Proceso: Stocks + Precios${colors.reset}`);
    console.log('='.repeat(70));
    
    let stockResults = null;
    let priceResults = null;
    
    try {
        // ============================================
        // PASO 1: Sincronización de STOCKS
        // ============================================
        console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
        console.log(`${colors.bright}📦 PASO 1/2: Sincronización de STOCKS${colors.reset}`);
        console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}\n`);
        
        try {
            stockResults = await executeStockSync();
            if (stockResults) {
                console.log(`${colors.green}✅ PASO 1 completado: Stocks sincronizados${colors.reset}\n`);
            } else {
                console.log(`${colors.red}⚠️  PASO 1 falló: Stocks no se sincronizaron${colors.reset}\n`);
            }
        } catch (error) {
            console.error(`${colors.red}❌ Error crítico en sincronización de STOCKS: ${error.message}${colors.reset}\n`);
            console.error('Continuando con sincronización de precios...\n');
            stockResults = null;
        }
        
        // ============================================
        // ESPERA ENTRE SINCRONIZACIONES
        // ============================================
        console.log(`${colors.yellow}${'='.repeat(70)}${colors.reset}`);
        console.log(`${colors.yellow}⏳ Esperando 5 segundos antes de sincronizar precios...${colors.reset}`);
        console.log(`${colors.yellow}   (Para evitar sobrecargar las APIs)${colors.reset}`);
        console.log(`${colors.yellow}${'='.repeat(70)}${colors.reset}\n`);
        
        for (let i = 5; i > 0; i--) {
            process.stdout.write(`\r   ⏱️  ${i} segundo${i > 1 ? 's' : ''} restante${i > 1 ? 's' : ''}...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        process.stdout.write('\r   ✅ Espera completada. Continuando...\n\n');
        
        // ============================================
        // PASO 2: Sincronización de PRECIOS
        // ============================================
        console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}`);
        console.log(`${colors.bright}💰 PASO 2/2: Sincronización de PRECIOS${colors.reset}`);
        console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}\n`);
        
        try {
            priceResults = await executePriceSync();
            if (priceResults) {
                console.log(`${colors.green}✅ PASO 2 completado: Precios sincronizados${colors.reset}\n`);
            } else {
                console.log(`${colors.red}⚠️  PASO 2 falló: Precios no se sincronizaron${colors.reset}\n`);
            }
        } catch (error) {
            console.error(`${colors.red}❌ Error crítico en sincronización de PRECIOS: ${error.message}${colors.reset}\n`);
            priceResults = null;
        }
        
        // ============================================
        // RESUMEN FINAL
        // ============================================
        const globalEndTime = Date.now();
        const globalDuration = ((globalEndTime - globalStartTime) / 1000).toFixed(2);
        const formattedEndTime = getFormattedDateTime();
        
        console.log('\n' + '='.repeat(70));
        console.log(`${colors.green}✅ Sincronización completa finalizada${colors.reset}`);
        console.log(`${colors.bright}📅 Finalizada a las: ${formattedEndTime}${colors.reset}`);
        console.log(`${colors.bright}⏱️  Duración total: ${globalDuration} segundos${colors.reset}`);
        console.log('='.repeat(70));
        
        // Resumen global detallado
        console.log(`\n${colors.bright}📊 RESUMEN GLOBAL DE SINCRONIZACIÓN:${colors.reset}`);
        console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}`);
        
        // Resumen de Stocks
        console.log(`\n   ${colors.cyan}📦 STOCKS (Manager+ → Shopify):${colors.reset}`);
        if (stockResults) {
            console.log(`      ${colors.green}✅ Actualizados: ${stockResults.updated}${colors.reset}`);
            console.log(`      ${colors.blue}ℹ️  Sin cambios: ${stockResults.noChange}${colors.reset}`);
            console.log(`      ${colors.yellow}⏭️  Omitidos: ${stockResults.skipped}${colors.reset}`);
            if (stockResults.errors > 0) {
                console.log(`      ${colors.red}❌ Errores: ${stockResults.errors}${colors.reset}`);
            }
            console.log(`      ${colors.green}✅ Estado: Completado${colors.reset}`);
        } else {
            console.log(`      ${colors.red}❌ Estado: Error en sincronización${colors.reset}`);
        }
        
        // Resumen de Precios
        console.log(`\n   ${colors.cyan}💰 PRECIOS (Manager+ Lista 18 → Shopify):${colors.reset}`);
        if (priceResults) {
            console.log(`      ${colors.green}✅ Actualizados: ${priceResults.updated}${colors.reset}`);
            console.log(`      ${colors.blue}ℹ️  Sin cambios: ${priceResults.noChange}${colors.reset}`);
            console.log(`      ${colors.yellow}⏭️  Omitidos: ${priceResults.skipped}${colors.reset}`);
            if (priceResults.errors > 0) {
                console.log(`      ${colors.red}❌ Errores: ${priceResults.errors}${colors.reset}`);
            }
            console.log(`      ${colors.green}✅ Estado: Completado${colors.reset}`);
        } else {
            console.log(`      ${colors.red}❌ Estado: Error en sincronización${colors.reset}`);
        }
        
        console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}\n`);
        
        return { stockResults, priceResults };
        
    } catch (error) {
        const formattedErrorTime = getFormattedDateTime();
        console.error('\n' + '='.repeat(70));
        console.error(`${colors.red}❌ Error fatal en sincronización automática${colors.reset}`);
        console.error(`${colors.bright}📅 Hora del error: ${formattedErrorTime}${colors.reset}`);
        console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
        console.error('='.repeat(70) + '\n');
        
        // Mostrar estado de lo que se completó antes del error
        console.log(`${colors.yellow}📊 Estado antes del error:${colors.reset}`);
        if (stockResults) {
            console.log(`   ${colors.green}✅ Stocks: Completado${colors.reset}`);
        } else {
            console.log(`   ${colors.red}❌ Stocks: No completado${colors.reset}`);
        }
        if (priceResults) {
            console.log(`   ${colors.green}✅ Precios: Completado${colors.reset}`);
        } else {
            console.log(`   ${colors.red}❌ Precios: No completado${colors.reset}`);
        }
        console.log('');
        
        // No lanzar el error para que el scheduler continúe funcionando
        // Solo loguear para debugging
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
        }
        
        return { stockResults, priceResults };
    }
}

/**
 * Función principal
 */
function main() {
    console.log('\n' + '='.repeat(70));
    console.log(`${colors.bright}🚀 Scheduler de Sincronización Automática${colors.reset}`);
    console.log(`${colors.bright}   Stocks y Precios${colors.reset}`);
    console.log('='.repeat(70));
    console.log(`${colors.cyan}⏰ Configuración:${colors.reset}`);
    console.log(`   Zona horaria: ${TIMEZONE} (Santiago de Chile)`);
    console.log(`   Horarios programados:`);
    console.log(`     - ${colors.green}6:00 PM (18:00)${colors.reset} - Todos los días`);
    console.log(`       ${colors.bright}1.${colors.reset} ${colors.cyan}📦 Sincronización de Stocks${colors.reset} (Manager+ → Shopify)`);
    console.log(`       ${colors.bright}2.${colors.reset} ${colors.cyan}💰 Sincronización de Precios${colors.reset} (Manager+ Lista 18 → Shopify)`);
    console.log(`   Concurrencia: ${CONCURRENCY}`);
    console.log(`   Reintentos máximos: ${MAX_RETRIES}`);
    console.log('='.repeat(70));
    console.log(`\n${colors.yellow}💡 El scheduler está activo. Presiona Ctrl+C para detenerlo.${colors.reset}\n`);
    
    // Programar sincronización a las 6:00 PM (18:00) - hora Santiago de Chile
    // Formato cron: minuto hora día mes día-semana
    // 0 18 * * * = Todos los días a las 18:00
    cron.schedule('0 18 * * *', executeSync, {
        scheduled: true,
        timezone: TIMEZONE
    });
    console.log(`${colors.green}✅ Tarea programada: 6:00 PM (18:00)${colors.reset}`);
    console.log(`\n${colors.bright}📋 Proceso de sincronización:${colors.reset}`);
    console.log(`   ${colors.cyan}📦 Paso 1: Stocks${colors.reset} - Manager+ → Shopify`);
    console.log(`   ${colors.cyan}💰 Paso 2: Precios${colors.reset} - Manager+ (Lista 18) → Shopify`);
    console.log(`   ${colors.yellow}⏳ Pausa: 5 segundos entre pasos${colors.reset}`);
    
    // Mostrar próximo evento programado
    const now = new Date();
    const santiagoTime = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
    const currentHour = santiagoTime.getHours();
    
    const nextSyncTime = currentHour < 18
        ? '6:00 PM (hoy)'
        : '6:00 PM (mañana)';
    
    console.log(`\n${colors.cyan}⏭️  Próxima sincronización: ${nextSyncTime}${colors.reset}`);
    console.log(`\n${colors.bright}📅 Hora actual (Santiago): ${getFormattedDateTime()}${colors.reset}\n`);
    
    // Manejar cierre limpio
    process.on('SIGINT', () => {
        console.log(`\n\n${colors.yellow}⚠️  Deteniendo scheduler...${colors.reset}`);
        console.log(`${colors.bright}👋 Hasta luego!${colors.reset}\n`);
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log(`\n\n${colors.yellow}⚠️  Deteniendo scheduler...${colors.reset}`);
        console.log(`${colors.bright}👋 Hasta luego!${colors.reset}\n`);
        process.exit(0);
    });
    
    // Mantener el proceso vivo
    console.log(`${colors.bright}✅ Scheduler iniciado correctamente. Esperando próximas ejecuciones...${colors.reset}\n`);
}

// Ejecutar si se llama directamente
if (require.main === module) {
    main();
}

module.exports = {
    executeSync,
    executeStockSync,
    executePriceSync,
    main
};
