# 📋 Instrucciones Paso a Paso: Obtener Token de Acceso de Shopify

## Paso 1: Obtener el Dominio de tu Tienda

El dominio de tu tienda ya lo puedes ver en la URL del navegador:
- **URL actual:** `https://admin.shopify.com/store/multitienda-en-linea/themes`
- **Tu dominio de tienda es:** `multitienda-en-linea.myshopify.com`

✅ **Anota este valor:** `multitienda-en-linea.myshopify.com`

---

## Paso 2: Navegar a la Sección de Apps

1. En el **menú lateral izquierdo** de Shopify, busca la sección **"Apps"**
   - Si está colapsado (con una flecha), haz clic para expandirlo
   - Si no lo ves, también puedes ir directamente a: **Configuración** (Settings) en la parte inferior del menú

2. Haz clic en **"Apps"** o **"Apps y canales de venta"**

---

## Paso 3: Crear una App Privada

1. Una vez en la sección de Apps, busca el botón que dice:
   - **"Desarrollar apps"** (Develop apps) o
   - **"Crear app"** (Create app)

2. Si es la primera vez, puede que te pida:
   - Aceptar términos y condiciones
   - Habilitar el desarrollo de apps

3. Haz clic en **"Crear una app"** (Create an app)

4. Te pedirá un nombre para la app, por ejemplo:
   - **"Sincronización de Stocks Manager+"** o
   - **"API Manager Express"**

5. Haz clic en **"Crear app"**

---

## Paso 4: Configurar Permisos de la API

1. Una vez creada la app, verás varias pestañas. Haz clic en:
   - **"Configurar permisos de administrador de la API"** (Configure Admin API scopes)

2. Necesitas habilitar los siguientes permisos:

   ### Permisos de Productos:
   - ✅ **`read_products`** - Leer productos
   - ✅ **`write_products`** - Escribir/actualizar productos

   ### Permisos de Inventario:
   - ✅ **`read_inventory`** - Leer inventario
   - ✅ **`write_inventory`** - Escribir/actualizar inventario

3. Después de seleccionar los permisos, haz clic en **"Guardar"** (Save)

---

## Paso 5: Instalar la App y Obtener el Token

1. Después de guardar los permisos, verás una sección que dice:
   - **"Instalar app"** (Install app) o
   - **"API credentials"** (Credenciales de API)

2. Haz clic en **"Instalar app"** si aparece ese botón

3. Una vez instalada, verás una sección con:
   - **"Token de acceso de administrador"** (Admin API access token)
   - O **"Credenciales de API"** (API credentials)

4. Haz clic en **"Revelar token"** (Reveal token) o **"Mostrar token"** (Show token)

5. **⚠️ IMPORTANTE:** Copia este token inmediatamente, ya que solo se muestra una vez
   - Es una cadena larga de caracteres, algo como: `shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

---

## Paso 6: Configurar en tu Proyecto

1. Abre tu archivo `.env` en la raíz del proyecto

2. Agrega las siguientes líneas:

```env
SHOPIFY_SHOP_DOMAIN=multitienda-en-linea.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_tu_token_aqui
```

3. Reemplaza `shpat_tu_token_aqui` con el token que copiaste

4. Guarda el archivo `.env`

---

## Paso 7: Probar la Conexión

Ejecuta el script de prueba:

```bash
npm run test:shopify
```

O directamente:

```bash
node shopifyAuth.js
```

Si todo está correcto, deberías ver:
- ✅ Autenticación exitosa con Shopify
- ✅ Información de tu tienda
- ✅ Lista de productos

---

## 🔒 Seguridad

- **NUNCA** compartas tu token de acceso
- **NUNCA** subas el archivo `.env` a GitHub o repositorios públicos
- El archivo `.env` ya está en `.gitignore` para proteger tus credenciales

---

## ❓ Solución de Problemas

### Error: "Invalid API key or access token"
- Verifica que copiaste el token completo
- Asegúrate de que no haya espacios antes o después del token
- Verifica que instalaste la app después de configurar los permisos

### Error: "Shop not found"
- Verifica que el dominio esté correcto: `tu-tienda.myshopify.com`
- No incluyas `https://` en el dominio
- Asegúrate de que el dominio sea exactamente como aparece en la URL del admin

### No veo la opción "Desarrollar apps"
- Puede que necesites permisos de administrador
- Algunas tiendas pueden tener restricciones, contacta con el administrador de la tienda

