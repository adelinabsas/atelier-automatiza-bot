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
      '--disable-gpu'
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

client.on('ready', () => {
  ultimoQR = null;
  console.log('Bot de Atelier Automatiza listo ✅');
});

// --- Flujo de bienvenida ---

// numeros que ya recibieron el mensaje de espera (tienen el timer de 4 min corriendo)
const esperandoMenu = new Set();
// numeros que ya eligieron su rubro (tienen el timer de 2 min corriendo) — se ignora todo lo que escriban mientras tanto
const yaEligioRubro = new Set();

const MENSAJE_ESPERA = `Hola! Gracias por contactarte con Atelier Automatiza. En breve alguien se va a poner en contacto con vos para armar algo ideal para tu negocio 🙌`;

const MENSAJE_MENU = `Hola! Como estas? Soy Agustina.
Buenísimo 😊 Para empezar y orientarte mejor, qué tipo de negocio tenés?
1️⃣ Vendo productos (e-commerce)
2️⃣ Servicios profesionales o consultoría
3️⃣ Trabajo con turnos o reservas (salud, belleza, fitness, gastronomía, etc.)
4️⃣ Inmobiliaria, turismo o eventos
5️⃣ Otro rubro`;

const RUBRO_MESSAGES = {
  '1': `Buenísimo! 🙌 Si vendés productos, te ayudamos a automatizar tus ventas para que factures más sin trabajar más. Podemos armarte: 🛒 Bot de ventas por WhatsApp: tus clientes ven el catálogo, consultan precios y hacen el pedido, sin que tengas que responder uno por uno. 📋 Catálogo digital siempre actualizado y fácil de compartir. 🔁 Recordatorios para carritos abandonados: recuperá ventas que se estaban por perder. 🌐 Tienda online propia: para vender también fuera de WhatsApp, con presencia profesional. Contame qué te interesa y te preparo un presupuesto a medida 👇`,
  '2': `Buenísimo! 🙌 Si ofrecés servicios profesionales, te ayudamos a que tus clientes te encuentren, confíen y te contraten más fácil. Podemos armarte: 🤖 Bot de WhatsApp que responde consultas y agenda reuniones automáticamente, sin que tengas que estar pendiente del chat. 🌐 Página web profesional: para mostrar tu experiencia y generar confianza. 📋 Catálogo digital de tus servicios y honorarios. 💬 Mensajes automáticos de seguimiento a clientes que consultaron y no cerraron. Contame qué te interesa y te preparo un presupuesto a medida 👇`,
  '3': `Buenísimo! 🙌 Si trabajás con turnos, te ayudamos a automatizar la gestión de tus clientes para que tengas menos trabajo y no pierdas oportunidades. Podemos armarte: 🤖 Reservas automáticas por WhatsApp: tus clientes consultan horarios, eligen su turno y reciben la confirmación, sin que tengas que responder uno por uno. 🔔 Recordatorios automáticos: para reducir ausencias y mantener a tus clientes al día con sus turnos. 💬 Mensajes automáticos para reactivar clientes que hace tiempo no reservan. 🌐 Página web profesional: para mostrar tus servicios, generar confianza y que nuevos clientes te contacten o reserven. La idea es armar un sistema adaptado a tu negocio, para que vos te ocupes de tus clientes y lo demás funcione solo. Contame qué te interesa y te preparo un presupuesto a medida 👇`,
  '4': `Buenísimo! 🙌 Te ayudamos a que ninguna consulta se te escape y cierres más reservas. Podemos armarte: 🤖 Bot de WhatsApp que responde consultas al instante (propiedades, paquetes, disponibilidad) y deriva las que necesitan atención personal. 🌐 Página web profesional para mostrar tus propiedades, paquetes o salones. 📋 Catálogo digital siempre actualizado y fácil de compartir. 🔔 Recordatorios y seguimiento automático para no perder clientes interesados. Contame qué te interesa y te preparo un presupuesto a medida 👇`,
  '5': `Contame, cuál es tu rubro? Así te cuento qué podemos armarte a medida 👇`
};

client.on('message', async (msg) => {
  const from = msg.from;
  const texto = msg.body.trim();

  // Ya eligió su rubro y está esperando el mensaje personalizado: no le contestamos nada más
  if (yaEligioRubro.has(from)) {
    return;
  }

  // Ya recibió el menú y está respondiendo con el número de su rubro
  if (esperandoMenu.has(from) && ['1', '2', '3', '4', '5'].includes(texto)) {
    yaEligioRubro.add(from);
    setTimeout(async () => {
      await client.sendMessage(from, RUBRO_MESSAGES[texto]);
    }, 2 * 60 * 1000); // 2 minutos
    return;
  }

  // Primer contacto de este número
  if (!esperandoMenu.has(from)) {
    esperandoMenu.add(from);
    await msg.reply(MENSAJE_ESPERA);
    setTimeout(async () => {
      await client.sendMessage(from, MENSAJE_MENU);
    }, 4 * 60 * 1000); // 4 minutos
    return;
  }

  // Si ya recibió el menú pero escribe algo que no es un número del 1 al 5, se ignora
});

client.initialize();
