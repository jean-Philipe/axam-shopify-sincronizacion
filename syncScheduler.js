/**
 * Scheduler para sincronización automática de stocks
 * 
 * Este script ejecuta la sincronización automáticamente todos los días
 * a las 6:00 PM en hora de Santiago de Chile
 */

require('dotenv').config();
const cron = require('node-cron');
const { syncAllProducts } = require('./syncStocks');

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
 * Función para ejecutar la sincronización
 */
async function executeSync() {
    const startTime = Date.now();
    const formattedStartTime = getFormattedDateTime();
    
    console.log('\n' + '='.repeat(70));
    console.log(`${colors.cyan}🕐 Iniciando sincronización automática${colors.reset}`);
    console.log(`${colors.bright}📅 Fecha/Hora (Santiago): ${formattedStartTime}${colors.reset}`);
    console.log('='.repeat(70));
    
    try {
        const options = {
            dryRun: false, // SIEMPRE sincronización real
            concurrency: CONCURRENCY,
            maxRetries: MAX_RETRIES,
            retryDelay: 2000
        };
        
        const results = await syncAllProducts(options);
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        const formattedEndTime = getFormattedDateTime();
        
        console.log('\n' + '='.repeat(70));
        console.log(`${colors.green}✅ Sincronización completada exitosamente${colors.reset}`);
        console.log(`${colors.bright}📅 Finalizada a las: ${formattedEndTime}${colors.reset}`);
        console.log(`${colors.bright}⏱️  Duración total: ${duration} segundos${colors.reset}`);
        console.log('='.repeat(70));
        
        // Resumen rápido
        console.log(`\n📊 Resumen:`);
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
        console.error(`${colors.red}❌ Error fatal en sincronización automática${colors.reset}`);
        console.error(`${colors.bright}📅 Hora del error: ${formattedErrorTime}${colors.reset}`);
        console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
        console.error('='.repeat(70) + '\n');
        
        // No lanzar el error para que el scheduler continúe funcionando
        // Solo loguear para debugging
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
        }
        
        return null;
    }
}

/**
 * Función principal
 */
function main() {
    console.log('\n' + '='.repeat(70));
    console.log(`${colors.bright}🚀 Scheduler de Sincronización de Stocks${colors.reset}`);
    console.log('='.repeat(70));
    console.log(`${colors.cyan}⏰ Configuración:${colors.reset}`);
    console.log(`   Zona horaria: ${TIMEZONE} (Santiago de Chile)`);
    console.log(`   Horarios programados:`);
    console.log(`     - ${colors.green}6:00 PM (18:00)${colors.reset} - Todos los días`);
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
    main
};
