/**
 * Script para consultar ciudades y comunas desde Manager+
 * 
 * Uso:
 *   node consultarCiudadesComunas.js                    # Muestra todo
 *   node consultarCiudadesComunas.js --comunas          # Solo comunas
 *   node consultarCiudadesComunas.js --ciudades         # Solo ciudades
 *   node consultarCiudadesComunas.js --buscar "nombre"  # Buscar por nombre
 */

require('dotenv').config();
const axios = require('axios');

const ERP_BASE_URL = process.env.ERP_BASE_URL;
const ERP_USERNAME = process.env.ERP_USERNAME;
const ERP_PASSWORD = process.env.ERP_PASSWORD;
const RUT_EMPRESA = process.env.RUT_EMPRESA;

let authToken = null;

/**
 * Autenticarse en Manager+
 */
async function authenticate() {
    try {
        const response = await axios.post(`${ERP_BASE_URL}/auth/`, {
            username: ERP_USERNAME,
            password: ERP_PASSWORD
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
        authToken = response.data.auth_token;
        console.log('✅ Autenticación exitosa\n');
        return true;
    } catch (error) {
        console.error('❌ Error de autenticación:', error.message);
        return false;
    }
}

/**
 * Obtener comunas desde Manager+
 */
async function getComunas() {
    try {
        const response = await axios.get(`${ERP_BASE_URL}/tabla-gral/comunas`, {
            headers: { Authorization: `Token ${authToken}` }
        });
        return response.data.data || response.data || [];
    } catch (error) {
        console.error('❌ Error al obtener comunas:', error.message);
        return [];
    }
}

/**
 * Obtener ciudades desde Manager+
 */
async function getCiudades() {
    try {
        const response = await axios.get(`${ERP_BASE_URL}/tabla-gral/ciudades`, {
            headers: { Authorization: `Token ${authToken}` }
        });
        return response.data.data || response.data || [];
    } catch (error) {
        console.error('❌ Error al obtener ciudades:', error.message);
        return [];
    }
}

/**
 * Mostrar tabla formateada
 */
function mostrarTabla(titulo, datos, columnas) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📍 ${titulo} (${datos.length} registros)`);
    console.log(`${'='.repeat(80)}\n`);

    if (datos.length === 0) {
        console.log('  (sin datos)\n');
        return;
    }

    // Mostrar encabezados
    const header = columnas.map(c => c.label.padEnd(c.width)).join(' | ');
    console.log(header);
    console.log('-'.repeat(header.length));

    // Mostrar datos
    datos.forEach(item => {
        const row = columnas.map(c => {
            const value = item[c.key] ?? '-';
            return String(value).substring(0, c.width).padEnd(c.width);
        }).join(' | ');
        console.log(row);
    });
    console.log('');
}

/**
 * Normalizar texto para búsqueda
 */
function normalizar(texto) {
    if (!texto) return '';
    return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function main() {
    const args = process.argv.slice(2);
    const mostrarComunas = args.includes('--comunas') || !args.some(a => a.startsWith('--'));
    const mostrarCiudades = args.includes('--ciudades') || !args.some(a => a.startsWith('--'));
    const buscarIndex = args.indexOf('--buscar');
    const buscarTexto = buscarIndex >= 0 ? args[buscarIndex + 1] : null;

    console.log('🔄 Conectando a Manager+...\n');

    if (!await authenticate()) {
        process.exit(1);
    }

    if (mostrarComunas) {
        let comunas = await getComunas();

        if (buscarTexto) {
            const busquedaNormalizada = normalizar(buscarTexto);
            comunas = comunas.filter(c =>
                normalizar(c.name).includes(busquedaNormalizada) ||
                normalizar(c.code_ext).includes(busquedaNormalizada) ||
                normalizar(c.cod_comuna).includes(busquedaNormalizada)
            );
            console.log(`🔍 Buscando comunas que contengan: "${buscarTexto}"`);
        }

        mostrarTabla('COMUNAS', comunas, [
            { key: 'name', label: 'Nombre', width: 25 },
            { key: 'code_ext', label: 'Código Ext', width: 12 },
            { key: 'cod_comuna', label: 'Cod Comuna', width: 12 },
            { key: 'cod_ciudad', label: 'Cod Ciudad', width: 12 },
            { key: 'region', label: 'Región', width: 10 },
            { key: 'cod_region', label: 'Cod Región', width: 10 }
        ]);

        // Mostrar estructura de ejemplo
        if (comunas.length > 0) {
            console.log('📋 Estructura de ejemplo (primera comuna):');
            console.log(JSON.stringify(comunas[0], null, 2));
        }
    }

    if (mostrarCiudades) {
        let ciudades = await getCiudades();

        if (buscarTexto) {
            const busquedaNormalizada = normalizar(buscarTexto);
            ciudades = ciudades.filter(c =>
                normalizar(c.name).includes(busquedaNormalizada) ||
                normalizar(c.code).includes(busquedaNormalizada) ||
                normalizar(c.cod_ciudad).includes(busquedaNormalizada)
            );
            console.log(`🔍 Buscando ciudades que contengan: "${buscarTexto}"`);
        }

        mostrarTabla('CIUDADES', ciudades, [
            { key: 'name', label: 'Nombre', width: 25 },
            { key: 'code', label: 'Código', width: 12 },
            { key: 'cod_ciudad', label: 'Cod Ciudad', width: 12 },
            { key: 'region', label: 'Región', width: 10 },
            { key: 'cod_region', label: 'Cod Región', width: 10 }
        ]);

        // Mostrar estructura de ejemplo
        if (ciudades.length > 0) {
            console.log('📋 Estructura de ejemplo (primera ciudad):');
            console.log(JSON.stringify(ciudades[0], null, 2));
        }
    }

    console.log('\n✨ Consulta completada');
}

main().catch(console.error);
