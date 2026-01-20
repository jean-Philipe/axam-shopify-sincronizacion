/**
 * Módulo para crear clientes y órdenes en Manager+ desde webhooks de Shopify
 * 
 * Este módulo procesa las notificaciones de órdenes de Shopify,
 * verifica si el cliente existe en Manager+ y crea la orden de compra/nota de venta.
 * 
 * IMPORTANTE: Por defecto, la creación real está DESACTIVADA para permitir testing.
 * Activar con la variable de entorno ENABLE_SHOPIFY_CREATE=true
 */

require('dotenv').config();
const axios = require('axios');
const { format, addDays, subDays } = require('date-fns');
const { serializeError, delay, getTimestamp } = require('./webhookQueue');

// Configuración de retry
const RETRY_CONFIG = {
    maxRetries: 5,
    baseDelay: 3000,
    maxDelay: 60000,
    retryableStatuses: [429, 500, 502, 503, 504]
};

/**
 * Wrapper de axios con retry automático para errores de rate limit y servidor
 * @param {Function} requestFn - Función que retorna la promesa de axios
 * @param {string} operationName - Nombre de la operación para logging
 * @returns {Promise<any>} Respuesta de axios
 */
async function axiosWithRetry(requestFn, operationName = 'petición') {
    let lastError;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        try {
            const response = await requestFn();
            return response;
        } catch (error) {
            lastError = error;
            const status = error.response?.status;
            const responseData = error.response?.data;

            // Detectar rate limit de múltiples formas
            const isRateLimitStatus = RETRY_CONFIG.retryableStatuses.includes(status);
            const hasRetryField = responseData?.retry !== undefined;
            const hasLimitMessage = responseData?.detail?.includes('límite') ||
                responseData?.message?.includes('límite');

            const isRetryable = isRateLimitStatus || hasRetryField || hasLimitMessage;

            if (!isRetryable || attempt === RETRY_CONFIG.maxRetries) {
                // Marcar el error para que la cola sepa que es rate limit
                if (isRetryable) {
                    lastError.isRateLimit = true;
                }
                throw lastError;
            }

            // Usar el tiempo de retry sugerido por el ERP si existe
            let delayMs = Math.min(
                RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1),
                RETRY_CONFIG.maxDelay
            );

            // Si el ERP nos dice cuánto esperar, usar ese valor + 2 segundos de margen
            if (responseData?.retry) {
                delayMs = Math.max(delayMs, (responseData.retry + 2) * 1000);
            }

            console.log(`[${getTimestamp()}] ⏳ ${operationName}: Error ${status || 'rate-limit'}, reintento ${attempt}/${RETRY_CONFIG.maxRetries} en ${delayMs / 1000}s...`);
            await delay(delayMs);
        }
    }

    throw lastError;
}

// Variables de entorno
const ERP_BASE_URL = process.env.ERP_BASE_URL;
const ERP_USERNAME = process.env.ERP_USERNAME;
const ERP_PASSWORD = process.env.ERP_PASSWORD;
const RUT_EMPRESA = process.env.RUT_EMPRESA;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Flag para habilitar/deshabilitar creación real en Manager
// Por defecto desactivado para testing de webhooks
const ENABLE_SHOPIFY_CREATE = process.env.ENABLE_SHOPIFY_CREATE === 'true' || process.env.ENABLE_SHOPIFY_CREATE === '1';

// Variable para almacenar el token de autenticación del ERP
let erpAuthToken = null;
let erpTokenExpirationTime = null;

// Órdenes ya procesadas (idempotencia simple en memoria)
const processedOrders = new Set();

// Almacenar el último webhook recibido para poder reprocesarlo
let lastWebhookNotification = null;

/**
 * Calcular dígito verificador chileno (módulo 11) para un RUT dado en números
 * @param {string} rutBase - RUT sin dígito verificador, solo dígitos
 * @returns {string} Dígito verificador (0-9 o K)
 */
function calcularDV(rutBase) {
    const clean = (rutBase || '').replace(/\D/g, '');
    if (!clean) return '0';

    let suma = 0;
    let multiplicador = 2;

    for (let i = clean.length - 1; i >= 0; i--) {
        suma += parseInt(clean[i], 10) * multiplicador;
        multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
    }

    const resto = suma % 11;
    const dv = 11 - resto;

    if (dv === 11) return '0';
    if (dv === 10) return 'K';
    return dv.toString();
}

/**
 * Formatear RUT chileno (agregar puntos y guión si no los tiene)
 * @param {string} rut - RUT en cualquier formato
 * @returns {string} RUT formateado
 */
function formatRut(rut) {
    if (!rut) return null;

    // Limpiar el RUT
    const clean = rut.toString().replace(/[.\s-]/g, '').toUpperCase();

    // Separar número y dígito verificador
    const match = clean.match(/^(\d{7,9})([0-9K])$/);
    if (!match) return clean; // Retornar como está si no coincide con el formato esperado

    const [, numero, dv] = match;

    // Agregar puntos al número
    const formatted = numero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    return `${formatted}-${dv}`;
}

/**
 * Autenticarse con el ERP Manager+
 */
async function authenticateWithERP() {
    try {
        const response = await axios.post(`${ERP_BASE_URL}/auth/`, {
            username: ERP_USERNAME,
            password: ERP_PASSWORD
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        erpAuthToken = response.data.auth_token;
        erpTokenExpirationTime = Date.now() + (60 * 60 * 1000); // 1 hora

        return erpAuthToken;
    } catch (error) {
        console.error('[ERP] Error en autenticación:', error.response?.data?.message || error.message);
        throw new Error('Error al autenticarse con el ERP: ' + (error.response?.data?.message || error.message));
    }
}

/**
 * Obtener el token de autenticación del ERP (con caché)
 */
async function getERPAuthToken() {
    if (erpAuthToken && erpTokenExpirationTime && Date.now() < erpTokenExpirationTime) {
        return erpAuthToken;
    }
    return await authenticateWithERP();
}

/**
 * Obtener información completa de una orden de Shopify
 *
 * @param {string} orderId - ID de la orden en Shopify
 * @returns {Promise<Object>} Información completa de la orden
 */
async function getShopifyOrder(orderId) {
    try {
        const shopName = SHOPIFY_SHOP_DOMAIN?.replace('.myshopify.com', '');
        const url = `https://${shopName}.myshopify.com/admin/api/2024-01/orders/${orderId}.json`;

        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        return response.data.order;
    } catch (error) {
        const errorMsg = error.response?.data?.errors || error.message;
        console.error(`[SHOPIFY] Error al obtener orden ${orderId}: ${errorMsg}`);
        throw error;
    }
}

/**
 * Obtener comunas desde Manager+
 */
async function getComunas() {
    try {
        const token = await getERPAuthToken();
        const response = await axiosWithRetry(
            () => axios.get(`${ERP_BASE_URL}/tabla-gral/comunas`, {
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                }
            }),
            'Obtener comunas'
        );
        return response.data.data || [];
    } catch (error) {
        console.error(`[${getTimestamp()}] Error al obtener comunas:`, serializeError(error));
        return [];
    }
}

/**
 * Obtener ciudades desde Manager+
 */
async function getCiudades() {
    try {
        const token = await getERPAuthToken();
        const response = await axiosWithRetry(
            () => axios.get(`${ERP_BASE_URL}/tabla-gral/ciudades`, {
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                }
            }),
            'Obtener ciudades'
        );
        return response.data.data || [];
    } catch (error) {
        console.error(`[${getTimestamp()}] Error al obtener ciudades:`, serializeError(error));
        return [];
    }
}

/**
 * Obtener valores por defecto seguros de comuna y ciudad que siempre funcionen
 * Estos valores son conocidos y válidos en el ERP
 * IMPORTANTE: La comuna y ciudad DEBEN pertenecer a la misma región
 */
async function getValoresSegurosPorDefecto(regionTarget = null) {
    try {
        const comunas = await getComunas();
        const ciudades = await getCiudades();

        // Función auxiliar para obtener el código de región de forma consistente
        const getRegion = (item) => {
            if (!item) return null;
            return item.cod_region || item.region_code || item.region || null;
        };

        // Si se especificó una región, buscar ahí primero
        const regionesPrioritarias = regionTarget
            ? [regionTarget, "13", "RM", "5", "VS", "8", "BI"]
            : ["13", "RM", "5", "VS", "8", "BI"];

        for (const targetReg of regionesPrioritarias) {
            // Buscar una comuna de esta región que tenga cod_ciudad válido
            const comunaConCiudad = comunas?.find(c => {
                const regionC = getRegion(c);
                const ciudadValida = c.cod_ciudad && c.cod_ciudad !== ".";
                const regionMatch = regionC === targetReg ||
                    (targetReg === "13" && regionC === "RM") ||
                    (targetReg === "RM" && regionC === "13") ||
                    (targetReg === "5" && regionC === "VS") ||
                    (targetReg === "VS" && regionC === "5") ||
                    (targetReg === "8" && regionC === "BI") ||
                    (targetReg === "BI" && regionC === "8");
                return ciudadValida && regionMatch;
            });

            if (comunaConCiudad) {
                const codComuna = comunaConCiudad.cod_comuna || comunaConCiudad.code_ext || comunaConCiudad.code;
                const codCiudad = comunaConCiudad.cod_ciudad;

                // Verificar que la ciudad exista
                const ciudadVerificada = ciudades?.find(ciudad => {
                    const codC = ciudad.cod_ciudad || ciudad.code;
                    return codC === codCiudad;
                });

                if (ciudadVerificada) {
                    return { codComuna, codCiudad };
                }

                // Si la ciudad no está verificada, buscar otra de la misma región
                const regionComuna = getRegion(comunaConCiudad);
                const ciudadMismaRegion = ciudades?.find(c => {
                    const regionC = getRegion(c);
                    const codigoValido = (c.cod_ciudad && c.cod_ciudad !== ".") || (c.code && c.code !== ".");
                    return codigoValido && regionC === regionComuna;
                });

                if (ciudadMismaRegion) {
                    return {
                        codComuna,
                        codCiudad: ciudadMismaRegion.cod_ciudad || ciudadMismaRegion.code
                    };
                }
            }
        }

        // Último recurso: usar códigos conocidos de Santiago
        console.log(`[${getTimestamp()}]    └─ [WARN] No se encontró combinación válida, usando Santiago`);
        return { codComuna: "13101", codCiudad: "13" };

    } catch (error) {
        console.log(`[${getTimestamp()}]    └─ [WARN] Error obteniendo valores seguros: ${serializeError(error)}`);
        return { codComuna: "13101", codCiudad: "13" };
    }
}

/**
 * Buscar comuna por nombre en Manager+ con búsqueda flexible
 * @param {string} comunaName - Nombre de la comuna a buscar
 * @param {string} regionCode - Código de región para filtrar
 * @returns {Promise<Object>} Objeto con codComuna y codCiudad válidos
 */
async function buscarComunaConCiudad(comunaName, regionCode) {
    try {
        const comunas = await getComunas();
        const ciudades = await getCiudades();

        if (!comunaName) {
            return await getValoresSegurosPorDefecto(regionCode);
        }

        const normalizedSearch = comunaName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // Función para normalizar nombre
        const normalize = (str) => (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        /**
         * Derivar código de ciudad a partir del código de comuna
         * Códigos de comuna en Chile siguen el formato RRXXX donde RR es la región
         * Ej: 13107 (Huechuraba) → región 13 → ciudad Santiago (código 13)
         * Ej: 05602 (Algarrobo) → región 5 → ciudad Valparaíso (código 5)
         */
        const derivarCiudadDesdeComuna = (codComuna) => {
            if (!codComuna) return null;

            const codigo = String(codComuna);
            let regionNum;

            // El código de comuna tiene formato RRXXX (5 dígitos)
            // RR = región (01-16), XXX = identificador único
            if (codigo.length === 5) {
                regionNum = parseInt(codigo.substring(0, 2), 10);
            } else if (codigo.length === 4) {
                // Algunas comunas tienen código de 4 dígitos (ej: 5602 → 5)
                regionNum = parseInt(codigo.substring(0, 1), 10);
            } else {
                return null;
            }

            // Buscar ciudad que coincida con la región
            const ciudadMatch = ciudades?.find(c => {
                const codCiudad = c.code || c.cod_ciudad;
                return parseInt(codCiudad, 10) === regionNum;
            });

            if (ciudadMatch) {
                return ciudadMatch.code || ciudadMatch.cod_ciudad;
            }

            // Si no hay match exacto, retornar el número de región como string
            return String(regionNum);
        };

        // Buscar comuna por nombre
        let found = comunas.find(c => normalize(c.name) === normalizedSearch);

        // Búsqueda parcial si no hay exacta
        if (!found) {
            found = comunas.find(c => {
                const normalizedName = normalize(c.name);
                return normalizedName.includes(normalizedSearch) || normalizedSearch.includes(normalizedName);
            });
        }

        if (found) {
            const codComuna = found.cod_comuna || found.code_ext || found.code;
            let codCiudad = found.cod_ciudad;

            // Si cod_ciudad no está disponible o es inválido, derivarlo del código de comuna
            if (!codCiudad || codCiudad === ".") {
                codCiudad = derivarCiudadDesdeComuna(codComuna);
                if (codCiudad) {
                    console.log(`[${getTimestamp()}]    └─ ✓ Comuna encontrada: "${found.name}" (${codComuna}), ciudad derivada: ${codCiudad}`);
                    return { codComuna, codCiudad };
                }
            } else {
                console.log(`[${getTimestamp()}]    └─ ✓ Comuna encontrada: "${found.name}" (${codComuna}), ciudad: ${codCiudad}`);
                return { codComuna, codCiudad };
            }

            // Fallback: buscar ciudad de la misma región si la derivación falló
            const regionComuna = found.cod_region || found.region_code || found.region;
            if (regionComuna) {
                const ciudadMismaRegion = ciudades?.find(c => {
                    const regionC = c.cod_region || c.region_code || c.region;
                    return regionC === regionComuna && (c.cod_ciudad || c.code) && (c.cod_ciudad || c.code) !== ".";
                });

                if (ciudadMismaRegion) {
                    codCiudad = ciudadMismaRegion.cod_ciudad || ciudadMismaRegion.code;
                    console.log(`[${getTimestamp()}]    └─ ✓ Comuna "${found.name}" (${codComuna}), ciudad de región: ${codCiudad}`);
                    return { codComuna, codCiudad };
                }
            }
        }

        // No encontrada, usar valores seguros para la región
        console.log(`[${getTimestamp()}]    └─ ⚠️ Comuna "${comunaName}" no encontrada. Buscando valor seguro...`);
        return await getValoresSegurosPorDefecto(regionCode);

    } catch (error) {
        console.error(`[${getTimestamp()}] Error buscando comuna:`, serializeError(error));
        return await getValoresSegurosPorDefecto(regionCode);
    }
}

/**
 * Mapear región de Shopify a código de región de Manager+
 */
function mapRegionToCode(regionName) {
    const regiones = [
        { code: "1", regionCode: "TA", name: "Tarapacá" },
        { code: "2", regionCode: "AN", name: "Antofagasta" },
        { code: "3", regionCode: "AT", name: "Atacama" },
        { code: "4", regionCode: "CO", name: "Coquimbo" },
        { code: "5", regionCode: "VS", name: "Valparaíso" },
        { code: "6", regionCode: "LI", name: "Libertador General Bernardo O'Higgins" },
        { code: "7", regionCode: "ML", name: "Maule" },
        { code: "8", regionCode: "BI", name: "Biobío" },
        { code: "9", regionCode: "AR", name: "Araucanía" },
        { code: "10", regionCode: "LL", name: "Los Lagos" },
        { code: "11", regionCode: "AI", name: "Aysén" },
        { code: "12", regionCode: "MA", name: "Magallanes" },
        { code: "13", regionCode: "RM", name: "Metropolitana" },
        { code: "14", regionCode: "LR", name: "Los Ríos" },
        { code: "15", regionCode: "AP", name: "Arica y Parinacota" },
        { code: "16", regionCode: "NB", name: "Ñuble" }
    ];

    const region = regiones.find(r =>
        r.name.toLowerCase().includes(regionName?.toLowerCase() || '') ||
        regionName?.toLowerCase().includes(r.name.toLowerCase() || '') ||
        r.regionCode.toLowerCase() === regionName?.toLowerCase()
    );

    return region ? region.code : "13"; // Default: RM
}

/**
 * Verificar si un cliente existe en el ERP
 * 
 * @param {string} rutCliente - RUT del cliente a verificar
 * @returns {Promise<boolean>} true si existe, false si no existe
 */
async function checkClientExists(rutCliente) {
    try {
        const token = await getERPAuthToken();
        const endpoint = `${ERP_BASE_URL}/clients/${RUT_EMPRESA}/?rut_cliente=${rutCliente}`;

        try {
            const response = await axios.get(endpoint, {
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                },
                validateStatus: (status) => status < 500
            });

            if (response.status >= 200 && response.status < 300) {
                const data = response.data?.data || response.data;

                if (response.data?.retorno === false) {
                    return false;
                }

                if (Array.isArray(data) && data.length > 0) {
                    const clienteEncontrado = data.find(c =>
                        c.rut_cliente === rutCliente ||
                        c.rut === rutCliente ||
                        (c.rut_cliente && c.rut_cliente.replace(/[.\s-]/g, '') === rutCliente.replace(/[.\s-]/g, ''))
                    );
                    return !!clienteEncontrado;
                }

                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    const rutEncontrado = data.rut_cliente || data.rut;
                    if (rutEncontrado && rutEncontrado.replace(/[.\s-]/g, '') === rutCliente.replace(/[.\s-]/g, '')) {
                        return true;
                    }
                }
            }
        } catch (endpointError) {
            // Continuar si el endpoint no existe
        }

        return false;
    } catch (error) {
        return false;
    }
}

/**
 * Obtener las direcciones de un cliente desde Manager+
 * 
 * @param {string} rutCliente - RUT del cliente
 * @returns {Promise<Array|null>} Lista de direcciones o null si no se encuentran
 */
async function getClientDirecciones(rutCliente) {
    try {
        const token = await getERPAuthToken();

        // Intentar diferentes endpoints para obtener direcciones
        const endpoints = [
            `${ERP_BASE_URL}/clients/${RUT_EMPRESA}/${rutCliente}/addresses/`,
            `${ERP_BASE_URL}/clients/${RUT_EMPRESA}/${rutCliente}/direcciones/`,
            `${ERP_BASE_URL}/clients/${RUT_EMPRESA}/${rutCliente}/`
        ];

        for (const endpoint of endpoints) {
            try {
                const response = await axios.get(endpoint, {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json'
                    },
                    validateStatus: (status) => status < 500
                });

                if (response.status === 200 && response.data) {
                    const data = response.data?.data || response.data;

                    // Si es un cliente con direcciones
                    if (data?.direcciones && Array.isArray(data.direcciones)) {
                        return data.direcciones;
                    }

                    // Si es un array de direcciones directamente
                    if (Array.isArray(data) && data.length > 0 && (data[0].direccion || data[0].descrip_dir)) {
                        return data;
                    }

                    // Si el cliente tiene descrip_dir directamente
                    if (data?.descrip_dir) {
                        return [{ descrip_dir: data.descrip_dir, direccion: data.direccion }];
                    }
                }
            } catch (e) {
                // Continuar con el siguiente endpoint
            }
        }

        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Crear o actualizar la dirección de un cliente en Manager+
 * Esta función es crucial para clientes que ya existen pero no tienen dirección registrada
 * 
 * @param {string} token - Token de autenticación del ERP
 * @param {string} rutCliente - RUT del cliente
 * @param {string} direccion - Dirección física
 * @param {string} codComuna - Código de comuna
 * @param {string} codCiudad - Código de ciudad
 * @param {string} telefono - Teléfono de contacto
 * @param {string} email - Email de contacto
 * @returns {Promise<Object>} Resultado con el nombre de la dirección utilizada
 */
async function createOrUpdateClientAddress(token, rutCliente, direccion, codComuna, codCiudad, telefono, email) {
    const direccionNombre = 'Direccion Shopify';

    try {
        // Intentar crear/actualizar la dirección usando el endpoint principal
        const direccionData = {
            rut_empresa: RUT_EMPRESA,
            rut_cliente: rutCliente,
            descrip_dir: direccionNombre,
            direccion: direccion || 'SIN DIRECCION',
            cod_comuna: codComuna,
            cod_ciudad: codCiudad,
            atencion: ".",
            telefono: telefono || ".",
            fax: "",
            email: email?.slice(0, 50) || ""
        };

        await axiosWithRetry(
            () => axios.post(
                `${ERP_BASE_URL}/import/create-client-address/?sobreescribir=S`,
                direccionData,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            ),
            `Crear dirección para ${rutCliente}`
        );
        console.log(`[${getTimestamp()}]    └─ [DIR] Dirección del cliente creada/actualizada: "${direccionNombre}"`);
        return { success: true, direccionNombre };

    } catch (dirError) {
        // Si falla el endpoint principal, intentar con endpoint alternativo
        try {
            const direccionAlt = {
                rut_empresa: RUT_EMPRESA,
                rut_cliente: rutCliente,
                tipo_direccion: "1", // 1 = Principal
                descripcion: direccionNombre,
                direccion: direccion || 'SIN DIRECCION',
                cod_comuna: codComuna,
                cod_ciudad: codCiudad,
                contacto: ".",
                telefono: telefono || ".",
                email: email?.slice(0, 50) || ""
            };

            await axios.post(
                `${ERP_BASE_URL}/clients/${RUT_EMPRESA}/${rutCliente}/addresses/`,
                direccionAlt,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`[${getTimestamp()}]    └─ [DIR] Dirección creada con endpoint alternativo: "${direccionNombre}"`);
            return { success: true, direccionNombre };

        } catch (altError) {
            // Si ambos endpoints fallan, intentar obtener una dirección existente del cliente
            const direccionesExistentes = await getClientDirecciones(rutCliente);
            if (direccionesExistentes && direccionesExistentes.length > 0) {
                const nombreExistente = direccionesExistentes[0].descrip_dir ||
                    direccionesExistentes[0].descripcion ||
                    direccionesExistentes[0].nombre ||
                    direccionNombre;
                console.log(`[${getTimestamp()}]    └─ [DIR] Usando dirección existente: "${nombreExistente}"`);
                return { success: true, direccionNombre: nombreExistente };
            }

            const altMsg = altError.response?.data?.mensaje || altError.message;
            console.log(`[${getTimestamp()}]    └─ [DIR] No se pudo crear dirección: ${typeof altMsg === 'object' ? serializeError(altMsg) : altMsg}`);
            return { success: false, direccionNombre, error: altMsg };
        }
    }
}

/**
 * Crear cliente en Manager+ desde datos de orden de Shopify
 * 
 * @param {Object} orderData - Datos completos de la orden de Shopify
 * @returns {Promise<Object>} Información del cliente creado
 */
async function createClient(orderData) {
    if (!ENABLE_SHOPIFY_CREATE) {
        console.log('   └─ [TESTING] Creación de cliente DESACTIVADA (ENABLE_SHOPIFY_CREATE=false)');
        return {
            cliente: { rut_cliente: orderData.billing_address?.company || '11111111-1' },
            direccionNombre: 'Direccion Shopify',
            created: false,
            testing: true
        };
    }

    try {
        const token = await getERPAuthToken();

        // Extraer datos del cliente desde la orden de Shopify
        const billingAddress = orderData.billing_address || {};
        const shippingAddress = orderData.shipping_address || billingAddress;
        const customer = orderData.customer || {};

        // Buscar atributos personalizados (note_attributes)
        const noteAttributes = orderData.note_attributes || [];
        const rutAttr = noteAttributes.find(attr => attr.name === 'Rut');
        const razonSocialAttr = noteAttributes.find(attr => attr.name === 'Razón social');
        const giroAttr = noteAttributes.find(attr => attr.name === 'Giro');
        const emailAttr = noteAttributes.find(attr => attr.name === 'Email');
        const direccionAttr = noteAttributes.find(attr => attr.name === 'Dirección de facturación');
        const regionAttr = noteAttributes.find(attr => attr.name === 'Región');
        const comunaAttr = noteAttributes.find(attr => attr.name === 'Comuna');
        const ciudadAttr = noteAttributes.find(attr => attr.name === 'Ciudad');
        const telefonoAttr = noteAttributes.find(attr => attr.name === 'Recibe-Teléfono');

        // Determinar si es factura o boleta
        const boletaFactura = noteAttributes.find(attr => attr.name === 'Boleta/Factura');
        const isFactura = boletaFactura?.value === 'Factura';

        // Obtener nombre y apellido según el tipo de documento
        let nombreAttr, apellidoAttr;
        if (isFactura) {
            nombreAttr = noteAttributes.find(attr => attr.name === 'Nombre de quien realiza el pedido');
            apellidoAttr = noteAttributes.find(attr => attr.name === 'Apellido de quien realiza el pedido');
        } else {
            nombreAttr = noteAttributes.find(attr => attr.name === 'Nombre');
            apellidoAttr = noteAttributes.find(attr => attr.name === 'Apellido');
        }

        // Obtener datos de dirección
        const direccion = direccionAttr?.value ||
            (shippingAddress.address1 ? `${shippingAddress.address1}${shippingAddress.address2 ? ', ' + shippingAddress.address2 : ''}` : '') ||
            billingAddress.address1 || '';
        const ciudad = ciudadAttr?.value || shippingAddress.city || billingAddress.city || '';
        const region = regionAttr?.value || shippingAddress.province || billingAddress.province || '';
        const comunaName = comunaAttr?.value || ciudad;

        // Obtener código de región
        const regionCode = mapRegionToCode(region);

        // Buscar comuna con ciudad válida usando la función probada
        const { codComuna, codCiudad } = await buscarComunaConCiudad(comunaName, regionCode);

        // RUT del cliente
        let rutCliente = rutAttr?.value || billingAddress.company || customer.default_address?.company || '11111111-1';
        if (!rutCliente.includes('-')) {
            // Si no tiene DV, calcularlo
            const rutBase = rutCliente.replace(/\D/g, '');
            rutCliente = formatRut(rutBase) || rutCliente;
        }

        // Razón social
        const razonSocial = razonSocialAttr?.value ||
            billingAddress.name?.toUpperCase() ||
            customer.default_address?.name?.toUpperCase() ||
            'Cliente Shopify';

        // Email
        const email = emailAttr?.value || customer.email || orderData.email || '';

        // Teléfono
        const telefono = telefonoAttr?.value ||
            billingAddress.phone ||
            shippingAddress.phone ||
            customer.default_address?.phone || '';

        // Giro
        const giro = giroAttr?.value || (isFactura ? 'Comercio' : 'Persona Natural');

        // Verificar si el cliente ya existe
        const clienteExiste = await checkClientExists(rutCliente);
        if (clienteExiste) {
            console.log(`   └─ Cliente ${rutCliente} ya existe en Manager+`);

            // Aunque el cliente exista, debemos asegurar que tenga una dirección válida
            // Intentar crear/actualizar la dirección del cliente
            const direccionResult = await createOrUpdateClientAddress(
                token,
                rutCliente,
                direccion.slice(0, 70),
                codComuna,
                codCiudad,
                telefono,
                email
            );

            return {
                cliente: { rut_cliente: rutCliente },
                direccionNombre: direccionResult.direccionNombre || 'Direccion Shopify',
                created: false,
                existing: true
            };
        }

        // Preparar datos del cliente
        const infoCliente = {
            rut_empresa: RUT_EMPRESA,
            rut_cliente: rutCliente,
            razon_social: razonSocial.slice(0, 50),
            nom_fantasia: razonSocial.slice(0, 50),
            giro: giro.slice(0, 50),
            holding: "",
            area_prod: "",
            clasif: "A5",
            email: email,
            emailsii: email,
            comentario: `Cliente creado desde Shopify, Ciudad: ${ciudad || 'No se indica'}`,
            tipo: "C",
            tipo_prov: "N",
            vencimiento: "01",
            plazo_pago: "01",
            cod_vendedor: ERP_USERNAME,
            cod_comis: ERP_USERNAME,
            cod_cobrador: "",
            lista_precio: "652",
            comen_emp: "",
            descrip_dir: "Direccion Shopify",
            direccion: direccion.slice(0, 70),
            cod_comuna: codComuna,
            cod_ciudad: codCiudad,
            atencion: ".",
            emailconta: email,
            telefono: telefono || ".",
            fax: "",
            cta_banco: "",
            cta_tipo: "",
            cta_corr: "",
            id_ext: "",
            texto1: "",
            texto2: "",
            caract1: "",
            caract2: ""
        };

        // Crear cliente en Manager+
        const response = await axiosWithRetry(
            () => axios.post(
                `${ERP_BASE_URL}/import/create-client/?sobreescribir=S`,
                infoCliente,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            ),
            `Crear cliente ${rutCliente}`
        );

        console.log(`   └─ Cliente ${rutCliente} creado exitosamente en Manager+`);

        // Intentar crear/actualizar la dirección del cliente por separado
        // Esto es necesario porque el endpoint create-client puede no guardar la dirección
        const direccionResult = await createOrUpdateClientAddress(
            token,
            rutCliente,
            direccion.slice(0, 70),
            codComuna,
            codCiudad,
            telefono,
            email
        );

        return {
            cliente: { rut_cliente: rutCliente },
            direccionNombre: direccionResult.direccionNombre || 'Direccion Shopify',
            created: true,
            data: response.data
        };

    } catch (error) {
        const errorMsg = serializeError(error.response?.data || error);
        console.error(`[${getTimestamp()}]    └─ Error al crear cliente: ${errorMsg}`);
        throw error;
    }
}

/**
 * Obtener el último folio de Nota de Venta
 * @returns {Promise<number>} Último folio
 */
async function getFolio() {
    try {
        const token = await getERPAuthToken();
        const fechaHoy = new Date();
        const fechaTomorrow = format(addDays(fechaHoy, 1), "yyyyMMdd");
        const fechaAnterior = format(subDays(fechaHoy, 3), "yyyyMMdd");

        const endpoint = `documents/${RUT_EMPRESA}/NV/V/?df=${fechaAnterior}&dt=${fechaTomorrow}`;

        const response = await axios.get(`${ERP_BASE_URL}/${endpoint}`, {
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const documentos = response.data.data || [];

        let maxFolio = -Infinity;
        documentos.forEach((documento) => {
            if (documento.folio > maxFolio) {
                maxFolio = documento.folio;
            }
        });

        return maxFolio === -Infinity ? 0 : maxFolio;
    } catch (error) {
        console.error('Error al obtener folio:', error.message);
        return 0;
    }
}

/**
 * Validar unidad de producto en Manager+
 * @param {string} sku - SKU del producto
 * @returns {Promise<string>} Unidad del producto
 */
async function validateProductUnit(sku) {
    try {
        const token = await getERPAuthToken();
        const response = await axios.get(
            `${ERP_BASE_URL}/products/${RUT_EMPRESA}/${sku}`,
            {
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const unidad = response.data.data[0]?.unidadstock || 'UMS';
        return unidad;
    } catch (error) {
        console.error(`Error al validar unidad del producto ${sku}:`, error.message);
        return 'UMS'; // Unidad por defecto
    }
}

/**
 * Crear orden (Nota de Venta) en Manager+ desde datos de orden de Shopify
 * 
 * @param {Object} orderData - Datos completos de la orden de Shopify
 * @param {Object} clienteInfo - Información del cliente creado
 * @returns {Promise<Object>} Resultado de la creación
 */
async function createOrder(orderData, clienteInfo) {
    if (!ENABLE_SHOPIFY_CREATE) {
        console.log('   └─ [TESTING] Creación de orden DESACTIVADA (ENABLE_SHOPIFY_CREATE=false)');
        return {
            success: true,
            data: { mensaje: 'Orden simulada (testing)' },
            orden: { num_doc: 'TEST', tipodocumento: 'NV' },
            testing: true
        };
    }

    try {
        const token = await getERPAuthToken();

        // Crear cliente primero
        await createClient(orderData);

        // Obtener folio
        const maxFolio = await getFolio();

        // Preparar detalles de la orden
        const detalles = [];

        // Procesar items de la orden
        for (const item of orderData.line_items || []) {
            const unidad = await validateProductUnit(item.sku);

            const detalle = {
                cod_producto: item.sku,
                cantidad: item.quantity.toString(),
                unidad: unidad,
                precio_unit: `${Math.round(item.price / 1.19)}`,
                moneda_det: "CLP",
                tasa_cambio_det: "1",
                nro_serie: "",
                num_lote: "",
                fecha_vec: "",
                cen_cos: "A03",
                tipo_desc: "",
                descuento: "",
                ubicacion: "",
                bodega: "",
                concepto1: "Venta",
                concepto2: "",
                concepto3: "",
                concepto4: "",
                descrip: item.title,
                desc_adic: "",
                stock: "0",
                cod_impesp1: "",
                mon_impesp1: "",
                cod_impesp2: "",
                mon_impesp2: "",
                fecha_comp: "",
                porc_retencion: ""
            };

            detalles.push(detalle);
        }

        // Agregar costo de envío si existe
        if (orderData.shipping_lines && orderData.shipping_lines.length > 0 && orderData.shipping_lines[0].price > 0) {
            const shipping = orderData.shipping_lines[0];
            const despacho = {
                cod_producto: "DPCHO",
                cantidad: "1",
                unidad: "UMS",
                precio_unit: `${Math.round(shipping.price / 1.19)}`,
                moneda_det: "CLP",
                tasa_cambio_det: "1",
                nro_serie: "",
                num_lote: "",
                fecha_vec: "",
                cen_cos: "A03",
                tipo_desc: "",
                descuento: "",
                ubicacion: "",
                bodega: "",
                concepto1: "Venta",
                concepto2: "",
                concepto3: "",
                concepto4: "",
                descrip: "DESPACHO e-commerce",
                desc_adic: "",
                stock: "0",
                cod_impesp1: "",
                mon_impesp1: "",
                cod_impesp2: "",
                mon_impesp2: "",
                fecha_comp: "",
                porc_retencion: ""
            };
            detalles.push(despacho);
        }

        // Obtener datos adicionales
        const noteAttributes = orderData.note_attributes || [];
        const nombreAttr = noteAttributes.find(attr => attr.name === 'Nombre') ||
            noteAttributes.find(attr => attr.name === 'Nombre de quien realiza el pedido');
        const apellidoAttr = noteAttributes.find(attr => attr.name === 'Apellido') ||
            noteAttributes.find(attr => attr.name === 'Apellido de quien realiza el pedido');
        const telefonoAttr = noteAttributes.find(attr => attr.name === 'Recibe-Teléfono');

        const nombre = nombreAttr?.value || '';
        const apellido = apellidoAttr?.value || '';
        const telefono = telefonoAttr?.value || orderData.billing_address?.phone || '';
        const notes = orderData.note || '';

        // Fecha actual
        const fechaHoy = format(new Date(), "dd/MM/yyyy");

        // Calcular totales
        const totalPrice = parseFloat(orderData.total_price || 0);
        const totalDiscounts = parseFloat(orderData.total_discounts || 0);
        const afecto = Math.round((totalPrice - totalDiscounts) / 1.19);
        const iva = Math.round(afecto * 0.19);

        // Preparar glosa
        const glosaParts = [
            'Shopify',
            nombre && apellido ? `${nombre} ${apellido}` : '',
            telefono ? `Tel: ${telefono}` : '',
            notes ? `Notas: ${notes}` : '',
            `Referencia: ${orderData.id || ''}`
        ].filter(Boolean);
        const glosa = glosaParts.join('; ').slice(0, 100);

        // Preparar información de la orden
        const infoOrder = {
            rut_empresa: RUT_EMPRESA,
            tipodocumento: "NV",
            num_doc: (maxFolio + 1).toString(),
            fecha_doc: fechaHoy,
            fecha_ref: "",
            fecha_vcto: fechaHoy,
            modalidad: "N",
            cod_unidnegocio: "UNEG-001",
            rut_cliente: clienteInfo.cliente.rut_cliente,
            dire_cliente: clienteInfo.direccionNombre || 'Direccion Shopify',
            rut_facturador: "",
            cod_vendedor: ERP_USERNAME,
            cod_comisionista: ERP_USERNAME,
            lista_precio: "652",
            plazo_pago: "01",
            cod_moneda: "CLP",
            tasa_cambio: "1",
            afecto: afecto.toString(),
            exento: "0",
            iva: iva.toString(),
            imp_esp: "",
            iva_ret: "",
            imp_ret: "",
            tipo_desc_global: "M",
            monto_desc_global: `${Math.round(totalDiscounts / 1.19)}`,
            total: totalPrice.toString(),
            deuda_pendiente: "0",
            glosa: glosa,
            ajuste_iva: "0",
            detalles: detalles
        };

        // Crear orden en Manager+
        const response = await axiosWithRetry(
            () => axios.post(
                `${ERP_BASE_URL}/import/create-document/?emitir=N&docnumreg=N`,
                infoOrder,
                {
                    headers: {
                        'Authorization': `Token ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            ),
            `Crear orden ${infoOrder.num_doc}`
        );

        console.log(`   └─ Orden ${infoOrder.num_doc} creada exitosamente en Manager+`);

        return {
            success: true,
            data: response.data,
            orden: infoOrder
        };

    } catch (error) {
        const errorMsg = serializeError(error.response?.data || error);
        console.error(`[${getTimestamp()}]    └─ Error al crear orden: ${errorMsg}`);
        throw error;
    }
}

/**
 * Procesar notificación de orden de Shopify
 * 
 * @param {Object} orderData - Datos de la orden de Shopify del webhook
 * @returns {Promise<Object>} Resultado del procesamiento
 */
async function processOrderNotification(orderData) {
    // Almacenar el último webhook recibido
    lastWebhookNotification = JSON.parse(JSON.stringify(orderData));

    // Extraer ID de orden
    const orderId = orderData.id?.toString() || orderData.order_id?.toString() || '';

    if (!orderId) {
        console.error('[ERROR] No se encontró ID de orden en la notificación de Shopify');
        return { success: false, error: 'ID de orden no encontrado' };
    }

    // Idempotencia: evitar reprocesar la misma orden múltiples veces
    if (processedOrders.has(orderId)) {
        console.log(`[SKIP] Orden Shopify ${orderId}: Ya procesada anteriormente`);
        return {
            success: true,
            skipped: true,
            reason: 'order_already_processed',
            orderId
        };
    }
    processedOrders.add(orderId);

    console.log(`[PROCESO] Orden Shopify ${orderId}: Iniciando procesamiento...`);

    // Validaciones previas
    if (!ERP_BASE_URL || !ERP_USERNAME || !ERP_PASSWORD || !RUT_EMPRESA) {
        console.error(`[ERROR] Orden ${orderId}: Variables de entorno del ERP incompletas`);
        return { success: false, error: 'Configuración incompleta: Variables del ERP no definidas' };
    }

    // Verificar si la creación está habilitada
    if (!ENABLE_SHOPIFY_CREATE) {
        console.log(`[TESTING] Orden ${orderId}: Creación DESACTIVADA - Solo recibiendo webhook`);
        console.log(`   └─ Para activar creación, configurar ENABLE_SHOPIFY_CREATE=true en .env`);
        return {
            success: true,
            orderId,
            testing: true,
            message: 'Webhook recibido correctamente. Creación desactivada.',
            orderData: orderData
        };
    }

    try {
        // Obtener información completa de la orden desde Shopify (si no está completa en el webhook)
        let orderDataComplete = orderData;
        if (!orderData.line_items || orderData.line_items.length === 0) {
            orderDataComplete = await getShopifyOrder(orderId);
        }

        // Validar que tenemos datos básicos de la orden
        if (!orderDataComplete || !orderDataComplete.customer) {
            console.error(`[ERROR] Orden ${orderId}: Datos de orden incompletos`);
            return { success: false, error: 'Datos de orden incompletos desde Shopify' };
        }

        // Crear cliente
        console.log(`   └─ Creando cliente...`);
        const clienteInfo = await createClient(orderDataComplete);

        // Crear orden
        console.log(`   └─ Creando orden...`);
        const ordenResult = await createOrder(orderDataComplete, clienteInfo);

        console.log(`[RESUMEN] Orden Shopify ${orderId}: ✅ COMPLETADA - Cliente y Orden creados exitosamente\n`);

        return {
            success: true,
            orderId,
            cliente: clienteInfo,
            orden: ordenResult
        };

    } catch (error) {
        const errorMsg = serializeError(error.response?.data || error);
        console.error(`[${getTimestamp()}] [ERROR] Orden Shopify ${orderId}: ${errorMsg}`);
        console.log(''); // Línea en blanco para separar

        return {
            success: false,
            error: errorMsg,
            orderId
        };
    }
}

/**
 * Obtener el último webhook recibido
 * @returns {Object|null} Último webhook o null si no hay ninguno
 */
function getLastWebhook() {
    return lastWebhookNotification;
}

/**
 * Limpiar el último webhook almacenado
 */
function clearLastWebhook() {
    lastWebhookNotification = null;
}

/**
 * Reprocesar el último webhook recibido
 * @param {boolean} force - Si es true, fuerza el reprocesamiento incluso si ya fue procesado
 * @returns {Promise<Object>} Resultado del procesamiento
 */
async function reprocessLastWebhook(force = false) {
    if (!lastWebhookNotification) {
        return {
            success: false,
            error: 'No hay webhook almacenado para reprocesar'
        };
    }

    const orderId = lastWebhookNotification.id?.toString() ||
        lastWebhookNotification.order_id?.toString() ||
        'N/A';

    if (force) {
        // Remover de processedOrders para permitir reprocesamiento
        processedOrders.delete(orderId);
    }

    return await processOrderNotification(lastWebhookNotification);
}

// Exportar funciones
module.exports = {
    processOrderNotification,
    createClient,
    createOrder,
    getShopifyOrder,
    getLastWebhook,
    clearLastWebhook,
    reprocessLastWebhook,
    checkClientExists,
    buscarComunaConCiudad  // Exportar para testing
};
