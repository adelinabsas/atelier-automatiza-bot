const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Borra los archivos "Singleton*" que Chromium deja trabados si el proceso
// anterior se cayó de golpe (crash) en vez de cerrarse limpio. Sin esto,
// el bot queda en loop de crashes al reiniciar sobre un volumen persistente.
function limpiarLocksChromium(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      limpiarLocksChromium(fullPath);
    } else if (entry.name.startsWith('Singleton')) {
      try {
        fs.unlinkSync(fullPath);
        console.log('Lock de Chromium eliminado:', fullPath);
      } catch (e) {
        console.log('No se pudo borrar el lock:', fullPath, e.message);
      }
    }
  }
}
limpiarLocksChromium(path.join(__dirname, 'session'));

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disk-cache-size=0',
      '--disable-software-rasterizer',
      '--disable-background-networking',
    ]
  }
});

// --- Servidor web para ver el QR desde el navegador ---
let ultimoQR = null;
const app = express();
app.get('/qr', async (req, res) => {
  if (!ultimoQR) {
    return res.send('<h2>No hay QR pendiente. El bot ya está conectado, o todavía no generó uno (esperá unos segundos y refrescá).</h2>');
  }
  const imagen = await qrcode.toDataURL(ultimoQR);
  res.send(`
    <html>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#111;">
        <div style="text-align:center;">
          <img src="${imagen}" style="width:300px;height:300px;" />
          <p style="color:#fff;font-family:sans-serif;">Escaneá con WhatsApp → Dispositivos vinculados</p>
        </div>
      </body>
    </html>
  `);
});
app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor de QR escuchando');
});

client.on('qr', (qr) => {
  ultimoQR = qr;
  console.log('Nuevo QR generado, entrá a /qr para escanearlo');
});

// Momento en el que el bot queda activo. Se usa para ignorar mensajes
// que ya estaban pendientes de antes (conversaciones viejas) y que
// WhatsApp puede entregar de golpe al reconectar.
let horaActivacion = null;

client.on('ready', () => {
  ultimoQR = null;
  horaActivacion = Date.now();
  console.log('Bot de Atelier Automatiza listo ✅');
});

// --- Flujo de bienvenida ---
// Un solo estado por número, para no tener condiciones que se pisen entre sí:
//   (sin estado)     -> primer contacto
//   'esperando_menu' -> ya recibió el msg de espera, el menú todavía no salió (timer de 4 min corriendo)
//   'menu_enviado'   -> ya le llegó el menú, esperando que responda con su rubro
//   'rubro_elegido'  -> ya eligió y le mandamos (o le vamos a mandar) su mensaje personalizado: se ignora todo lo demás
const estados = new Map();

const MENSAJE_ESPERA = `Hola! Gracias por contactarte con Atelier Automatiza. En breve alguien se va a poner en contacto con vos para armar algo ideal para tu negocio`;

const MENSAJE_AGUSTINA_1 = `Hola! Como estas? Soy Agustina`;

const MENSAJE_AGUSTINA_2 = `Para empezar y orientarte mejor, qué tipo de negocio tenés?`;

const MENSAJE_AGUSTINA_3 = `Vendo productos (e-commerce)
Servicios profesionales o consultoría
Trabajo con turnos o reservas (salud, belleza, fitness, gastronomía, etc.)
Inmobiliaria, turismo o eventos
Otro rubro`;

// Cada mensaje separado en párrafos (con saltos de línea) para que se lea fácil en WhatsApp
const RUBRO_MESSAGES = {
  '1': `Buenísimo! Si vendés productos, te ayudamos a automatizar tus ventas para que factures más sin trabajar más.

Podemos armarte:
- Bot de ventas por WhatsApp: tus clientes ven el catálogo, consultan precios y hacen el pedido, sin que tengas que responder uno por uno.
- Catálogo digital siempre actualizado y fácil de compartir.
- Recordatorios para carritos abandonados, para recuperar ventas que se estaban por perder.
- Tienda online propia, para vender también fuera de WhatsApp con presencia profesional.

Contame qué te interesa y te preparo un presupuesto a medida`,

  '2': `Buenísimo! Si ofrecés servicios profesionales, te ayudamos a que tus clientes te encuentren, confíen y te contraten más fácil.

Podemos armarte:
- Bot de WhatsApp que responde consultas y agenda reuniones automáticamente, sin que tengas que estar pendiente del chat.
- Página web profesional, para mostrar tu experiencia y generar confianza.
- Catálogo digital de tus servicios y honorarios.
- Mensajes automáticos de seguimiento a clientes que consultaron y no cerraron.

Contame qué te interesa y te preparo un presupuesto a medida`,

  '3': `Buenísimo! Si trabajás con turnos, te ayudamos a automatizar la gestión de tus clientes para que tengas menos trabajo y no pierdas oportunidades.

Podemos armarte:
- Reservas automáticas por WhatsApp: tus clientes consultan horarios, eligen su turno y reciben la confirmación, sin que tengas que responder uno por uno.
- Recordatorios automáticos, para reducir ausencias y mantener a tus clientes al día con sus turnos.
- Mensajes automáticos para reactivar clientes que hace tiempo no reservan.
- Página web profesional, para mostrar tus servicios, generar confianza y que nuevos clientes te contacten o reserven.

La idea es armar un sistema adaptado a tu negocio, para que vos te ocupes de tus clientes y lo demás funcione solo.

Contame qué te interesa y te preparo un presupuesto a medida`,

  '4': `Buenísimo! Te ayudamos a que ninguna consulta se te escape y cierres más reservas.

Podemos armarte:
- Bot de WhatsApp que responde consultas al instante (propiedades, paquetes, disponibilidad) y deriva las que necesitan atención personal.
- Página web profesional para mostrar tus propiedades, paquetes o salones.
- Catálogo digital siempre actualizado y fácil de compartir.
- Recordatorios y seguimiento automático para no perder clientes interesados.

Contame qué te interesa y te preparo un presupuesto a medida`,

  '5': `Contame, cuál es tu rubro? Así te cuento qué podemos armarte a medida`
};

// Palabras clave para reconocer el rubro aunque no respondan solo con el número
const RUBRO_KEYWORDS = {
  '1': ['producto', 'productos', 'ecommerce', 'e-commerce', 'vendo', 'venta', 'ventas', 'tienda'],
  '2': ['servicio', 'servicios', 'consultoria', 'profesional', 'profesionales', 'consultor'],
  '3': ['turno', 'turnos', 'reserva', 'reservas', 'salud', 'belleza', 'fitness', 'gastronomia', 'gym', 'gimnasio', 'peluqueria', 'estetica'],
  '4': ['inmobiliaria', 'inmobiliarias', 'turismo', 'evento', 'eventos', 'propiedad', 'propiedades', 'alquiler'],
  '5': ['otro', 'otros']
};

function quitarAcentos(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Devuelve '1'..'5' si reconoce el número o alguna palabra clave, o null si no entendió nada
function detectarRubro(textoOriginal) {
  const texto = quitarAcentos(textoOriginal.toLowerCase().trim());

  if (['1', '2', '3', '4', '5'].includes(texto)) {
    return texto;
  }

  for (const [numero, palabras] of Object.entries(RUBRO_KEYWORDS)) {
    for (const palabra of palabras) {
      if (texto.includes(palabra)) {
        return numero;
      }
    }
  }

  return null;
}

client.on('message', async (msg) => {
  // Mensaje de una conversación vieja, de antes de activar el bot: se ignora.
  // (msg.timestamp viene en segundos, horaActivacion en milisegundos)
  if (horaActivacion && msg.timestamp * 1000 < horaActivacion) {
    return;
  }

  const from = msg.from;
  const texto = msg.body.trim();
  const estado = estados.get(from);

  // Ya eligió su rubro: se ignora todo lo que escriba de acá en más
  if (estado === 'rubro_elegido') {
    return;
  }

  // Ya le llegó el menú: se evalúa SOLO este primer mensaje que manda después (por número o por palabra clave).
  // No importa si matchea o no, después de este mensaje se corta la detección automática (pasa a estado 'rubro_elegido')
  // para no seguir escaneando el resto de la conversación en busca de una palabra suelta.
  if (estado === 'menu_enviado') {
    const rubro = detectarRubro(texto);
    estados.set(from, 'rubro_elegido');
    if (rubro) {
      setTimeout(async () => {
        await client.sendMessage(from, RUBRO_MESSAGES[rubro]);
      }, 2 * 60 * 1000); // 2 minutos
    }
    // Si no entendió nada en ese primer mensaje, no contesta nada más (para que no parezca un bot)
    return;
  }

  // Ya recibió el mensaje de espera, pero el menú todavía no salió: se ignora lo que escriba mientras tanto
  if (estado === 'esperando_menu') {
    return;
  }

  // Primer contacto de este número
  estados.set(from, 'esperando_menu');
  await msg.reply(MENSAJE_ESPERA);
  setTimeout(async () => {
    estados.set(from, 'menu_enviado');
    await client.sendMessage(from, MENSAJE_AGUSTINA_1);
    setTimeout(async () => {
      await client.sendMessage(from, MENSAJE_AGUSTINA_2);
      setTimeout(async () => {
        await client.sendMessage(from, MENSAJE_AGUSTINA_3);
      }, 3000); // 3 segundos entre mensaje 2 y 3
    }, 4000); // 4 segundos entre mensaje 1 y 2
  }, 4 * 60 * 1000); // 4 minutos
});

client.initialize();
