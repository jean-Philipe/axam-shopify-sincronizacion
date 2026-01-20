/**
 * Script de prueba para simular un webhook de Shopify
 * y verificar que la función buscarComunaConCiudad funcione correctamente
 * 
 * Uso: node testWebhookComuna.js
 */

require('dotenv').config();
const { buscarComunaConCiudad, processOrderNotification } = require('./createClientAndOrderShopify');

// Datos de prueba simulando un webhook de Shopify con Huechuraba
const webhookDataHuechuraba = {
    id: 9999999999999,
    name: "#TEST-001",
    email: "cliente.prueba@email.com",
    total_price: "50000.00",
    currency: "CLP",
    financial_status: "paid",
    confirmed: true,
    created_at: new Date().toISOString(),

    // Datos del cliente
    customer: {
        id: 1234567890,
        email: "cliente.prueba@email.com",
        first_name: "Juan",
        last_name: "Pérez",
        phone: "+56912345678",
        default_address: {
            company: "12345678-9",
            address1: "Av. Recoleta 1234",
            city: "Huechuraba",
            province: "Región Metropolitana de Santiago",
            country: "Chile",
            zip: "8520000",
            phone: "+56912345678"
        }
    },

    // Dirección de facturación
    billing_address: {
        name: "Juan Pérez",
        company: "12345678-9",
        address1: "Av. Recoleta 1234",
        address2: "Depto 101",
        city: "Huechuraba",
        province: "Región Metropolitana de Santiago",
        country: "Chile",
        zip: "8520000",
        phone: "+56912345678"
    },

    // Dirección de envío
    shipping_address: {
        name: "Juan Pérez",
        address1: "Av. Recoleta 1234",
        address2: "Depto 101",
        city: "Huechuraba",
        province: "Región Metropolitana de Santiago",
        country: "Chile",
        zip: "8520000",
        phone: "+56912345678"
    },

    // Atributos personalizados (como los envía Shopify)
    note_attributes: [
        { name: "Boleta/Factura", value: "Factura" },
        { name: "Rut", value: "12345678-9" },
        { name: "Razón social", value: "EMPRESA DE PRUEBA SPA" },
        { name: "Giro", value: "Comercio al por menor" },
        { name: "Email", value: "facturacion@empresa.cl" },
        { name: "Dirección de facturación", value: "Av. Recoleta 1234, Depto 101" },
        { name: "Región", value: "Región Metropolitana de Santiago" },
        { name: "Comuna", value: "Huechuraba" },
        { name: "Ciudad", value: "Santiago" },
        { name: "Recibe-Teléfono", value: "+56912345678" },
        { name: "Nombre de quien realiza el pedido", value: "Juan" },
        { name: "Apellido de quien realiza el pedido", value: "Pérez" }
    ],

    // Líneas de la orden
    line_items: [
        {
            id: 1,
            variant_id: 123456789,
            title: "Producto de Prueba",
            quantity: 2,
            sku: "PROD-001",
            price: "25000.00",
            name: "Producto de Prueba",
            product_id: 987654321
        }
    ],

    // Línea de envío
    shipping_lines: [
        {
            id: 1,
            title: "Envío estándar",
            price: "0.00"
        }
    ]
};

// Lista de comunas para probar
const comunasPrueba = [
    { nombre: "Huechuraba", region: "13" },
    { nombre: "Las Condes", region: "13" },
    { nombre: "Providencia", region: "13" },
    { nombre: "Maipú", region: "13" },
    { nombre: "Viña del Mar", region: "5" },
    { nombre: "Concepción", region: "8" },
    { nombre: "Antofagasta", region: "2" },
    { nombre: "Comuna Inexistente XYZ", region: "13" }
];

async function testBuscarComunas() {
    console.log('='.repeat(70));
    console.log('🧪 PRUEBA DE BÚSQUEDA DE COMUNAS');
    console.log('='.repeat(70));
    console.log('');

    for (const prueba of comunasPrueba) {
        try {
            console.log(`\n🔍 Buscando: "${prueba.nombre}" (región ${prueba.region})`);
            const resultado = await buscarComunaConCiudad(prueba.nombre, prueba.region);
            console.log(`   ✅ Resultado: Comuna=${resultado.codComuna}, Ciudad=${resultado.codCiudad}`);
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }
}

async function testWebhookCompleto() {
    console.log('\n');
    console.log('='.repeat(70));
    console.log('🧪 PRUEBA DE WEBHOOK COMPLETO (modo simulación)');
    console.log('='.repeat(70));
    console.log('');

    console.log('📦 Datos del webhook de prueba:');
    console.log(`   - Orden ID: ${webhookDataHuechuraba.id}`);
    console.log(`   - Cliente: ${webhookDataHuechuraba.customer.first_name} ${webhookDataHuechuraba.customer.last_name}`);
    console.log(`   - RUT: ${webhookDataHuechuraba.note_attributes.find(a => a.name === 'Rut')?.value}`);
    console.log(`   - Comuna: ${webhookDataHuechuraba.note_attributes.find(a => a.name === 'Comuna')?.value}`);
    console.log(`   - Región: ${webhookDataHuechuraba.note_attributes.find(a => a.name === 'Región')?.value}`);
    console.log('');

    // IMPORTANTE: Solo ejecutar si ENABLE_SHOPIFY_CREATE está desactivado
    if (process.env.ENABLE_SHOPIFY_CREATE === 'true') {
        console.log('⚠️  ADVERTENCIA: ENABLE_SHOPIFY_CREATE está activado.');
        console.log('   Esto podría crear datos reales en Manager+.');
        console.log('   Para ejecutar la prueba sin crear datos reales,');
        console.log('   asegúrese de que ENABLE_SHOPIFY_CREATE no esté en "true".');
        console.log('');
        console.log('   Ejecute: ENABLE_SHOPIFY_CREATE=false node testWebhookComuna.js');
        return;
    }

    console.log('🔄 Procesando webhook (modo testing - no se crearán datos reales)...\n');

    try {
        const resultado = await processOrderNotification(webhookDataHuechuraba);
        console.log('\n📋 Resultado del procesamiento:');
        console.log(JSON.stringify(resultado, null, 2));
    } catch (error) {
        console.log(`\n❌ Error: ${error.message}`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const soloComuna = args.includes('--solo-comuna');
    const soloWebhook = args.includes('--solo-webhook');

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║           SCRIPT DE PRUEBA - COMUNAS Y WEBHOOK SHOPIFY               ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');
    console.log('');

    if (!soloWebhook) {
        await testBuscarComunas();
    }

    if (!soloComuna) {
        await testWebhookCompleto();
    }

    console.log('\n');
    console.log('✨ Pruebas completadas');
    console.log('');
}

main().catch(console.error);
