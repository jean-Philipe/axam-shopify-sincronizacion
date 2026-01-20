/**
 * Script para obtener y mostrar comunas y ciudades de Manager+
 * Uso: node testComunasCiudades.js
 */

require('dotenv').config();
const axios = require('axios');

const ERP_BASE_URL = process.env.ERP_BASE_URL;
const ERP_USERNAME = process.env.ERP_USERNAME;
const ERP_PASSWORD = process.env.ERP_PASSWORD;

let authToken = null;

async function authenticate() {
    console.log('🔐 Autenticando con Manager+...');
    const response = await axios.post(`${ERP_BASE_URL}/auth/`, {
        username: ERP_USERNAME,
        password: ERP_PASSWORD
    });
    authToken = response.data.auth_token;
    console.log('✅ Autenticación exitosa\n');
    return authToken;
}

async function getComunas() {
    const response = await axios.get(`${ERP_BASE_URL}/tabla-gral/comunas`, {
        headers: {
            'Authorization': `Token ${authToken}`,
            'Content-Type': 'application/json'
        }
    });
    return response.data.data || [];
}

async function getCiudades() {
    const response = await axios.get(`${ERP_BASE_URL}/tabla-gral/ciudades`, {
        headers: {
            'Authorization': `Token ${authToken}`,
            'Content-Type': 'application/json'
        }
    });
    return response.data.data || [];
}

async function main() {
    try {
        await authenticate();

        // Esperar un poco para evitar rate limit
        console.log('⏳ Esperando 3s para evitar rate limit...\n');
        await new Promise(r => setTimeout(r, 3000));

        // Obtener comunas
        console.log('📍 Obteniendo COMUNAS...');
        const comunas = await getComunas();
        console.log(`   Total: ${comunas.length} comunas\n`);

        // Mostrar estructura de primera comuna
        if (comunas.length > 0) {
            console.log('📋 Estructura de una comuna:');
            console.log(JSON.stringify(comunas[0], null, 2));
            console.log('\n');
        }

        // Buscar Quillota específicamente
        const quillota = comunas.find(c =>
            c.name?.toLowerCase().includes('quillota') ||
            c.nombre?.toLowerCase().includes('quillota')
        );
        if (quillota) {
            console.log('🎯 Comuna "Quillota" encontrada:');
            console.log(JSON.stringify(quillota, null, 2));
            console.log('\n');
        } else {
            console.log('❌ Comuna "Quillota" NO encontrada\n');

            // Buscar comunas de región 5 (Valparaíso)
            const comunasV = comunas.filter(c =>
                c.cod_ciudad === '5' ||
                c.cod_region === '5' ||
                c.region === '5' ||
                c.cod_ciudad === 'VS' ||
                c.region === 'VS'
            );
            console.log(`📍 Comunas de región Valparaíso (5): ${comunasV.length}`);
            if (comunasV.length > 0) {
                console.log('   Primeras 5:');
                comunasV.slice(0, 5).forEach(c => {
                    console.log(`   - ${c.name || c.nombre} (cod: ${c.cod_comuna || c.code})`);
                });
            }
            console.log('\n');
        }

        // Esperar antes de ciudades
        console.log('⏳ Esperando 3s...\n');
        await new Promise(r => setTimeout(r, 3000));

        // Obtener ciudades
        console.log('🏙️ Obteniendo CIUDADES...');
        const ciudades = await getCiudades();
        console.log(`   Total: ${ciudades.length} ciudades\n`);

        // Mostrar estructura de primera ciudad
        if (ciudades.length > 0) {
            console.log('📋 Estructura de una ciudad:');
            console.log(JSON.stringify(ciudades[0], null, 2));
            console.log('\n');
        }

        // Listar todas las ciudades
        console.log('📋 Todas las ciudades:');
        ciudades.forEach(c => {
            const code = c.cod_ciudad || c.code;
            const name = c.name || c.nombre;
            const region = c.cod_region || c.region;
            console.log(`   ${code}: ${name} (región: ${region})`);
        });

        console.log('\n✅ Consulta completada');

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
    }
}

main();
