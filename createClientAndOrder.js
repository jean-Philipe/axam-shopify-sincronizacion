const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const {subDays, format, addDays} = require("date-fns");

admin.initializeApp();

exports.createClientAndOrder = functions.https.onRequest(async (req, res) => {
  const data = req.body;

  const createClientAndOrder = async () =>{
    // Access the payload data here
    functions.logger.log("Shopify webhook payload:", data);

    //  Send a 200 response to acknowledge receipt of the webhook
    res.sendStatus(200);

    // Generating Authorization token to enter Managermas ERP
    const authInfo = {
      username: "ventasamurai",
      password: "Bayona2502",
    };

    const auth = await axios
        .post("https://axam.managermas.cl/api/auth/", authInfo)
        .then((response) => response.data)
        .catch((error) => error);
    const token = auth.auth_token;
    const authorization = {authorization: `token ${token}`};

    //  Definiendo variables de entrada para crearCliente en Managermas

    const comunas = await axios.get(
        "https://axam.managermas.cl/api/tabla-gral/comunas",
        {headers: authorization},
    );

    const regiones = [
      {code: "1", regionCode: "TA"},
      {code: "2", regionCode: "AN"},
      {code: "3", regionCode: "AT"},
      {code: "4", regionCode: "CO"},
      {code: "5", regionCode: "VS"},
      {code: "6", regionCode: "LI"},
      {code: "7", regionCode: "ML"},
      {code: "8", regionCode: "BI"},
      {code: "9", regionCode: "AR"},
      {code: "10", regionCode: "LL"},
      {code: "11", regionCode: "AI"},
      {code: "12", regionCode: "MA"},
      {code: "13", regionCode: "RM"},
      {code: "14", regionCode: "LR"},
      {code: "15", regionCode: "AP"},
      {code: "16", regionCode: "NB"},
    ];
    // const codigosgr = [
    //   "BAL23025",
    //   "CA-710528",
    //   "JD-D4121350",
    //   "JD-D4121630",
    //   "FD-06",
    //   "FD-07",
    //   "FD-12",
    //   "KC28872U",
    //   "KC28873",
    //   "KC28873U",
    //   "KC29202",
    //   "KC79062U",
    //   "VI5661-4",
    //   "RT-ACGUAPOL",
    //   "RT-ACGUESU1",
    //   "RT-ACGUESU2",
    //   "RT-ACGUNIT1",
    //   "RT-ACGUNIT2",
    //   "RT-ACGUNIT3",
    //   "RT-ACGUNIT4",
    //   "RT-ACGUVIT1",
    //   "RT-ACGUVTL2",
    //   "RT-ACGUVTL3",
    //   "RT-ACGVITL1",
    //   "RT-ACGVITL2",
    //   "RT-ACGVITL3",
    //   "RB-1835528",
    //   "VI4401-3",
    //   "VI4401-4",
    //   "VI4401-5",
    //   "VI5379-2",
    //   "VI5379-3",
    // ];
    //  Formatear info para ingreso de cliente a managermas
    const rutClienteAttr = data.note_attributes.find((item) =>
      item.name === "Rut");
    const razonSocialAttr = data.note_attributes.find((item) =>
      item.name === "Razón social");
    const giroAttr = data.note_attributes.find((item) =>
      item.name === "Giro");
    const emailAttr = data.note_attributes.find((item) =>
      item.name === "Email");
    const direccionAttr = data.note_attributes.find((item) =>
      item.name === "Dirección de facturación");
    const regionAttr = data.note_attributes.find((item) =>
      item.name === "Región");
    const comunaAttr = data.note_attributes.find((item) =>
      item.name === "Comuna");
    const ciudadAttr = data.note_attributes.find((item) =>
      item.name === "Ciudad");
    const telefonoAttr = data.note_attributes.find((item) =>
      item.name === "Recibe-Teléfono");
    const detalleComuna = comunas.data.data.find(
        (comuna) => comuna.name === comunaAttr.value);
    const codigoCiudad = regiones.find(
        (item) => item.regionCode === regionAttr.value,
    ).code;
    const ciudadValue = ciudadAttr ? ciudadAttr.value : "No se indica";

    let nombreAttr;
    let apellidoAttr;
    const boletaFactura= data.note_attributes.find((item) =>
      item.name ==="Boleta/Factura").value;
    if (boletaFactura==="Factura") {
      nombreAttr= data.note_attributes.find((item) =>
        item.name === "Nombre de quien realiza el pedido");
      apellidoAttr= data.note_attributes.find((item)=>
        item.name === "Apellido de quien realiza el pedido");
    } else {
      nombreAttr= data.note_attributes.find((item) =>
        item.name === "Nombre");
      apellidoAttr= data.note_attributes.find((item)=>
        item.name === "Apellido");
    }
    const telefono = data.billing_address.phone ?
    data.billing_address.phone : telefonoAttr;
    const notes= data.note !== null ? data.note : "";

    const infoCliente = {
      rut_empresa: "76299574-3",
      rut_cliente:
        rutClienteAttr && rutClienteAttr.value ?
          rutClienteAttr.value :
          data.billing_address.company,
      razon_social:
        razonSocialAttr && razonSocialAttr.value ?
          razonSocialAttr.value.toUpperCase().slice(0, 50) :
          data.customer.default_address.name.toUpperCase().slice(0, 50),
      nom_fantasia:
        razonSocialAttr && razonSocialAttr.value ?
          razonSocialAttr.value.toUpperCase().slice(0, 50) :
          data.customer.default_address.name.toUpperCase().slice(0, 50),
      giro: giroAttr && giroAttr.value ? giroAttr.value : "Persona Natural",
      holding: "",
      area_prod: "",
      clasif: "A5",
      email: emailAttr && emailAttr.value ? emailAttr.value : data.email,
      emailsii: emailAttr && emailAttr.value ? emailAttr.value : data.email,
      comentario: "Cliente creado desde Shopify, Ciudad: " + ciudadValue,
      tipo: "C",
      tipo_prov: "N",
      vencimiento: "01",
      plazo_pago: "01",
      cod_vendedor: "ventasamurai",
      cod_comis: "ventasamurai",
      cod_cobrador: "",
      lista_precio: "18",
      comen_emp: "",
      descrip_dir: "Direccion Shopify",
      direccion:
        direccionAttr && direccionAttr.value ?
          direccionAttr.value.slice(0, 70) :
          data.customer.default_address.address1.slice(0, 70) +
            "," +
            data.customer.default_address.city,
      cod_comuna: detalleComuna ? detalleComuna.code_ext : ".",
      cod_ciudad: codigoCiudad,
      atencion: ".",
      emailconta: emailAttr && emailAttr.value ? emailAttr.value : data.email,
      telefono:
        data.customer.default_address.phone !== null &&
        data.customer.default_address.phone !== undefined ?
          data.customer.default_address.phone :
          data.billing_address.phone !== null &&
            data.billing_address.phone !== undefined ?
          data.billing_address.phone :
          telefonoAttr.value,

      fax: "",
      cta_banco: "",
      cta_tipo: "",
      cta_corr: "",
      id_ext: "",
      texto1: "",
      texto2: "",
      caract1: "",
      caract2: "",
    };

    /**
   * This function creates a client in the ERP system.
   */
    async function createClient() {
      try {
      // // Verificar si el cliente ya existe en el ERP utilizando el RUT
      //   const existingClient = await axios.get(
      //       `https://axam.managermas.cl/api/clients/76299574-3/${infoCliente.rut_cliente}`,
      //       {headers: authorization},
      //   );
      //   if (existingClient.data.data.length === 0) {
        const response = await axios.post(
            "https://axam.managermas.cl/api/import/create-client/?sobreescribir=S",
            infoCliente,
            {headers: authorization},
        );
        functions.logger.log(
            "Cliente creado/actualizado exitosamente en el ERP",
            response.data.mensaje,
        );
        // } else {
        //   functions.logger.log("El cliente ya existe en el ERP");
        // }
      } catch (error) {
        functions.logger.error(
            "Error al verificar o crear el cliente en el ERP:",
            error.response.data.mensaje);
      }
    }

    const fechaHoy = format(new Date(), "dd/MM/yyyy");
    const fechaTomorrow=format(addDays(new Date(), 1), "yyyyMMdd");
    const fechaAnterior=format(subDays(new Date(), 3), "yyyyMMdd");

    let maxFolio;
    /**
   * This function get the last folio of Nota de Venta.
   */
    async function getFolio() {
      try {
        const baseUrl = "https://axam.managermas.cl/api/";
        const endpoint =
        `documents/76299574-3/NV/V/?df=${fechaAnterior}&dt=${fechaTomorrow}`;
        // Realizar la solicitud GET a la API
        const docs= await axios.get(baseUrl + endpoint,
            {headers: authorization});
        const documentos = docs.data.data;
        // Buscamos el folio mayor definiendo variable maxFolio
        // Inicializamos la variable con un valor muy pequeño
        maxFolio= -Infinity;

        documentos.forEach((documento) => {
          if (documento.folio > maxFolio) {
            maxFolio = documento.folio;
          }
        });

        console.log("El folio más grande es:", maxFolio);
      } catch (error) {
      // Handle API response error
        functions.logger.error("Error al obtener folio", error);
      }
    }
    /**
   * This function get the unit of each product to asign it to the new sell
   * @param {sku} sku
   */
    async function validateProductUnit(sku) {
      try {
        // Realizar la solicitud al ERP para validar la unidad del producto
        const response = await axios.get(
            `https://axam.managermas.cl/api/products/76299574-3/${sku}`,
            {headers: authorization});
          // Manejar la respuesta del ERP
        const unidad= response.data.data[0].unidadstock;
        return unidad;
      } catch (error) {
        // Manejar errores de la solicitud al ERP
        console.error("Error al validar la unidad del producto:", error);
      }
    }

    /**
   * This function create an Order on Manager mas ERP with
   * information os sales on SHopify
   */
    async function createOrder() {
      await createClient();
      await getFolio();

      const detalles = [];

      await Promise.all(data.line_items.map(async (item) => {
        const unidad= await validateProductUnit(item.sku);
        const detalle = {
          cod_producto: item.sku,
          cantidad: item.quantity.toString(),
          unidad: unidad,
          precio_unit: `${Math.round((item.price)/1.19)}`,
          moneda_det: "CLP",
          tasa_cambio_det: "1", // Puedes ajustar esto según tu necesidad
          nro_serie: "",
          num_lote: "",
          fecha_vec: "",
          cen_cos: "A03",
          tipo_desc: "",
          descuento: "",
          ubicacion: "",
          bodega: "",
          concepto1: "Venta", // Venta o Comodato
          concepto2: "",
          concepto3: "",
          concepto4: "",
          descrip: item.title,
          desc_adic: "", // Puedes ajustar esto según tu necesidad
          stock: "0",
          cod_impesp1: "",
          mon_impesp1: "",
          cod_impesp2: "",
          mon_impesp2: "",
          fecha_comp: "",
          porc_retencion: "",
        };
        detalles.push(detalle);
      }));
      if (data.shipping_lines[0].price !== "0") {
        const despacho = {
          cod_producto: "DPCHO",
          cantidad: "1",
          unidad: "UMS",
          precio_unit: `${Math.round(data.shipping_lines[0].price/1.19)}`,
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
          concepto1: "Venta", // Venta o Comodato
          concepto2: "",
          concepto3: "",
          concepto4: "",
          descrip: "DESPACHO e-commerce",
          desc_adic: "", // Puedes ajustar esto según tu necesidad
          stock: "0",
          cod_impesp1: "",
          mon_impesp1: "",
          cod_impesp2: "",
          mon_impesp2: "",
          fecha_comp: "",
          porc_retencion: "",
        };
        detalles.push(despacho);
      }
      const infoOrder=
      {
        rut_empresa: "76299574-3",
        tipodocumento: "NV",
        num_doc: `${maxFolio+1}`,
        fecha_doc: fechaHoy,
        fecha_ref: "",
        fecha_vcto: fechaHoy,
        modalidad: "N",
        cod_unidnegocio: "UNEG-001",
        rut_cliente: infoCliente.rut_cliente,
        dire_cliente: "Direccion Shopify",
        rut_facturador: "",
        cod_vendedor: "ventasamurai",
        cod_comisionista: "ventasamurai",
        lista_precio: "18",
        plazo_pago: "01",
        cod_moneda: "CLP",
        tasa_cambio: "1",
        afecto: `${Math.round(
            (data.total_price-data.total_discounts)/1.19)}`,
        exento: "0",
        iva: `${Math.round(
            (data.total_price-data.total_discounts)/1.19*0.19)}`,
        imp_esp: "",
        iva_ret: "",
        imp_ret: "",
        tipo_desc_global: "M",
        monto_desc_global: `${Math.round(data.total_discounts/1.19)}`,
        total: `${Math.round(data.total_price)}`,
        deuda_pendiente: "0",
        glosa: "Shopify; "+nombreAttr.value+" "+apellidoAttr.value+"; "+
        telefono+"; "+notes+"; Referencia: "+ `${data.checkout_id}`,
        ajuste_iva: "0",
        detalles: detalles,
      };

      functions.logger.log("Orden a ingresar:", infoOrder);

      await axios
          .post("https://axam.managermas.cl/api/import/create-document/?emitir=N&docnumreg=N", infoOrder, {headers: authorization})
          .then((response) => {
            functions.logger.log("Orden creada exitosamente en el ERP:",
                response.data);
          })
          .catch((error) => {
            functions.logger.error("Error al crear la orden en el ERP:",
                error.response.data.mensaje);
          });
    }
    createOrder();
  };
  createClientAndOrder();
});
