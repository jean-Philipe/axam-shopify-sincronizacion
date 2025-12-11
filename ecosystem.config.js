/**
 * Archivo de configuración para PM2
 * 
 * Este archivo permite ejecutar el scheduler como un servicio gestionado por PM2
 * 
 * Instalación de PM2:
 *   npm install -g pm2
 * 
 * Uso:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
    apps: [{
        name: 'sync-scheduler',
        script: 'syncScheduler.js',
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '500M',
        env: {
            NODE_ENV: 'production'
        },
        error_file: './logs/scheduler-error.log',
        out_file: './logs/scheduler-out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true
    }]
};
