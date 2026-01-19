# Guía: Generar Link Público con Cloudflare Tunnel para Webhook de Shopify

Esta guía te mostrará cómo exponer tu servidor de webhooks de Shopify (puerto 3000) públicamente usando Cloudflare Tunnel (cloudflared), similar a como se hizo para MercadoLibre.

---

## Prerrequisitos

- Servidor corriendo con Docker (ya tienes el contenedor `shopify-webhook-api` en el puerto 3000)
- Acceso a una cuenta de Cloudflare (gratuita)
- Acceso SSH/consola al servidor

---

## Paso 1: Instalar cloudflared en el Servidor

### Opción A: Descargar e Instalar cloudflared (Recomendado)

```bash
# Descargar cloudflared para Linux (AMD64)
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Instalar
sudo dpkg -i cloudflared-linux-amd64.deb

# Verificar instalación
cloudflared --version
```

### Opción B: Usar snap (si está disponible)

```bash
sudo snap install cloudflared
```

### Opción C: Instalar desde repositorio

```bash
# Agregar repositorio de Cloudflare
sudo mkdir -p /etc/cloudflared
cd /etc/cloudflared

# Descargar e instalar
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
sudo chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/

# Verificar
cloudflared --version
```

---

## Paso 2: Autenticarse con Cloudflare

Ejecuta el siguiente comando para iniciar sesión en tu cuenta de Cloudflare:

```bash
cloudflared tunnel login
```

Esto te mostrará:
1. Una URL que debes abrir en tu navegador
2. Una solicitud para autorizar el tunnel en tu cuenta de Cloudflare

**Pasos en el navegador:**
1. Abre la URL que se muestra en la consola
2. Selecciona tu dominio de Cloudflare (si tienes uno) o autoriza el acceso
3. Completa la autorización

**Importante:** Después de autorizar, el certificado se guardará en `~/.cloudflared/cert.pem` y podrás crear tunnels.

---

## Paso 3: Crear un Tunnel Temporal (Rápido - Para Pruebas)

Si solo necesitas una URL temporal para configurar el webhook rápidamente:

```bash
# Exponer el puerto 3000 temporalmente
cloudflared tunnel --url http://localhost:3000
```

**Esto mostrará algo como:**
```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): |
|  https://abc123-def456-ghi789.trycloudflare.com                                           |
+--------------------------------------------------------------------------------------------+
```

**⚠️ NOTA IMPORTANTE:**
- Esta URL es **temporal** y expira cuando cierres el comando
- Si cierras la sesión SSH o detienes el comando, la URL dejará de funcionar
- Úsala solo para pruebas rápidas o configuración inicial

**Para mantener el tunnel corriendo en segundo plano:**

```bash
# Ejecutar en background (nohup)
nohup cloudflared tunnel --url http://localhost:3000 > /tmp/cloudflared.log 2>&1 &

# Ver la URL generada
sleep 2
cat /tmp/cloudflared.log | grep "https://"
```

**Para detener el tunnel:**
```bash
# Encontrar el proceso
ps aux | grep cloudflared

# Matar el proceso (reemplaza PID con el número real)
kill <PID>
```

---

## Paso 4: Crear un Tunnel Permanente (Recomendado para Producción)

Si quieres un tunnel permanente que sobreviva reinicios, sigue estos pasos:

### 4.1: Crear un Tunnel con Nombre

```bash
# Crear un tunnel llamado "shopify-webhook"
cloudflared tunnel create shopify-webhook
```

Esto creará un tunnel y te mostrará su ID (guárdalo, lo necesitarás después).

### 4.2: Configurar el Tunnel

Crea un archivo de configuración:

```bash
# Crear directorio de configuración si no existe
sudo mkdir -p /etc/cloudflared

# Crear archivo de configuración
sudo nano /etc/cloudflared/config.yml
```

**Contenido del archivo de configuración:**

```yaml
tunnel: shopify-webhook
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  # Webhook de Shopify
  - hostname: shopify-webhook-axam.trycloudflare.com  # O tu dominio personalizado
    service: http://localhost:3000
  # Catch-all rule (debe ir al final)
  - service: http_status:404
```

**Reemplaza `<TUNNEL-ID>` con el ID real del tunnel que obtuviste en el paso 4.1.**

### 4.3: Configurar como Servicio del Sistema (Opcional pero Recomendado)

Para que el tunnel se inicie automáticamente al reiniciar el servidor:

```bash
# Instalar cloudflared como servicio
sudo cloudflared service install
```

### 4.4: Iniciar el Tunnel

```bash
# Si no lo instalaste como servicio:
cloudflared tunnel run shopify-webhook

# Si lo instalaste como servicio:
sudo systemctl start cloudflared
sudo systemctl enable cloudflared

# Verificar que está corriendo
sudo systemctl status cloudflared
```

---

## Paso 5: Obtener la URL del Webhook

Después de crear el tunnel, tendrás una URL como:

```
https://shopify-webhook-axam.trycloudflare.com
```

O si usaste un tunnel temporal:
```
https://abc123-def456-ghi789.trycloudflare.com
```

**Tu URL completa del webhook será:**
```
https://tu-url.trycloudflare.com/api/webhooks/shopify
```

---

## Paso 6: Verificar que el Webhook Funciona

Antes de configurarlo en Shopify, verifica que el endpoint está accesible:

```bash
# Probar el endpoint GET
curl https://tu-url.trycloudflare.com/api/webhooks/shopify

# Deberías ver algo como:
# {"success":true,"message":"Webhook endpoint activo para Shopify","timestamp":"..."}
```

También puedes probar desde tu navegador abriendo la URL en un navegador web.

---

## Paso 7: Configurar el Webhook en Shopify

1. **Inicia sesión en tu tienda de Shopify Admin:**
   - Ve a: `https://admin.shopify.com/store/tu-tienda`

2. **Navega a Configuración > Notificaciones:**
   - En el panel izquierdo: **Settings** > **Notifications**
   - O ve directamente a: `https://admin.shopify.com/store/tu-tienda/settings/notifications`

3. **Busca la sección de Webhooks:**
   - Scroll hacia abajo hasta encontrar **"Webhooks"**

4. **Crear un nuevo webhook:**
   - Haz clic en **"Create webhook"** o **"Add webhook"**

5. **Configurar el webhook:**
   - **Event**: Selecciona `Order creation`, `Order payment`, o `Order fulfillment` (según tus necesidades)
   - **Format**: `JSON`
   - **URL**: Pega tu URL de Cloudflare:
     ```
     https://tu-url.trycloudflare.com/api/webhooks/shopify
     ```
   - **API version**: Selecciona la versión de API que uses (generalmente la más reciente)

6. **Guardar:**
   - Haz clic en **"Save webhook"**

---

## Paso 8: Probar el Webhook

Una vez configurado, puedes probar el webhook:

### Opción A: Desde Shopify Admin

1. Ve a tu webhook en Settings > Notifications
2. Haz clic en **"Send test notification"** o similar
3. Verifica en los logs de tu servidor que recibiste el webhook

### Opción B: Crear una Orden de Prueba

1. Crea una orden de prueba en Shopify
2. Verifica en los logs del contenedor:

```bash
# Ver logs del contenedor de Shopify
docker logs -f shopify-webhook-api

# Deberías ver algo como:
# [WEBHOOK] Webhook recibido de Shopify: orders/create desde tu-tienda.myshopify.com
```

---

## Paso 9: Configurar Variable de Entorno (Opcional pero Recomendado)

Si quieres que tu aplicación conozca la URL pública del webhook, puedes agregarla a tu archivo `.env`:

```bash
# Editar el archivo .env
cd /opt/axam/apiSincronizaranManagerShopify
nano .env
```

**Agregar:**
```env
WEBHOOK_BASE_URL=https://tu-url.trycloudflare.com
```

**Reiniciar el contenedor:**
```bash
docker-compose restart api
# o
docker restart shopify-webhook-api
```

---

## Comandos Útiles de Cloudflare Tunnel

### Ver Tunnels Activos

```bash
cloudflared tunnel list
```

### Ver Información de un Tunnel

```bash
cloudflared tunnel info shopify-webhook
```

### Detener un Tunnel

```bash
# Si está corriendo como servicio
sudo systemctl stop cloudflared

# Si está corriendo manualmente, encontrar y matar el proceso
ps aux | grep cloudflared
kill <PID>
```

### Ver Logs del Tunnel

```bash
# Si está como servicio
sudo journalctl -u cloudflared -f

# Si está corriendo manualmente
cloudflared tunnel run shopify-webhook --loglevel debug
```

### Eliminar un Tunnel

```bash
cloudflared tunnel delete shopify-webhook
```

---

## Solución de Problemas

### El tunnel no inicia

```bash
# Verificar que cloudflared está instalado
cloudflared --version

# Verificar que estás autenticado
ls ~/.cloudflared/cert.pem

# Si no existe, ejecutar:
cloudflared tunnel login
```

### El webhook no recibe peticiones

1. **Verificar que el tunnel está corriendo:**
   ```bash
   ps aux | grep cloudflared
   ```

2. **Verificar que el contenedor está corriendo:**
   ```bash
   docker ps | grep shopify-webhook-api
   ```

3. **Verificar que el puerto 3000 es accesible localmente:**
   ```bash
   curl http://localhost:3000/health
   ```

4. **Verificar los logs del tunnel:**
   ```bash
   sudo journalctl -u cloudflared -f
   ```

### La URL cambia cada vez (Tunnel Temporal)

Si estás usando `cloudflared tunnel --url`, la URL cambiará cada vez. Para una URL permanente:
1. Crea un tunnel con nombre (Paso 4.1)
2. Configúralo como servicio del sistema (Paso 4.3)

---

## Diferencias entre Tunnel Temporal y Permanente

| Característica | Tunnel Temporal | Tunnel Permanente |
|----------------|-----------------|-------------------|
| Duración | Hasta que cierres el comando | Permanente |
| URL | Cambia cada vez | Puede ser la misma |
| Reinicios | No sobrevive | Sí sobrevive |
| Uso recomendado | Pruebas rápidas | Producción |
| Comando | `cloudflared tunnel --url` | `cloudflared tunnel run <nombre>` |

---

## Resumen Rápido (Comandos Esenciales)

```bash
# 1. Instalar cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# 2. Autenticarse
cloudflared tunnel login

# 3. Crear tunnel temporal (rápido)
cloudflared tunnel --url http://localhost:3000

# 3. O crear tunnel permanente
cloudflared tunnel create shopify-webhook
cloudflared tunnel run shopify-webhook

# 4. Verificar que funciona
curl https://tu-url.trycloudflare.com/api/webhooks/shopify

# 5. Configurar en Shopify con la URL obtenida
# https://tu-url.trycloudflare.com/api/webhooks/shopify
```

---

## Notas Finales

- **Tunnel Temporal**: Útil para pruebas rápidas, pero la URL expira cuando cierres la sesión
- **Tunnel Permanente**: Mejor para producción, requiere configuración adicional pero es más estable
- **Dominio Personalizado**: Si tienes un dominio en Cloudflare, puedes configurar un subdominio personalizado en lugar de usar `.trycloudflare.com`
- **Seguridad**: Aunque Cloudflare Tunnel es seguro, considera implementar validación adicional del webhook en tu código si es necesario

---

**¿Necesitas ayuda adicional?** Revisa los logs del contenedor y del tunnel para diagnosticar problemas específicos.
