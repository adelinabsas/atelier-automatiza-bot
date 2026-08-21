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

const LINK_PRESUPUESTO = 'https://atelierautomatiza.com.ar/#presupuesto';

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

// Usuarios a los que ya se les cortó el bot (no se responde más hasta que escriban "menu")
const finalizados = new Set();

const MENU = `¡Hola! 👋 Bienvenido a *Atelier Automatiza*.

¿En qué te podemos ayudar?

1️⃣ Pedir presupuesto
2️⃣ Ya tengo presupuesto
3️⃣ Prefiero pedirte mi presupuesto por acá

Respondé con el número de la opción.`;

client.on('qr', (qr) => {
  ultimoQR = qr;
  console.log('Nuevo QR generado, entrá a /qr para escanearlo');
});

client.on('ready', () => {
  ultimoQR = null;
  console.log('Bot de Atelier Automatiza listo ✅');
});

client.on('message', async (msg) => {
  const from = msg.from;
  const texto = msg.body.trim().toLowerCase();

  // Reinicio manual del flujo
  if (texto === 'menu' || texto === 'menú') {
    finalizados.delete(from);
    await msg.reply(MENU);
    return;
  }

  // Si el bot ya se cortó para este número, no responde más
  if (finalizados.has(from)) {
    return;
  }

  switch (texto) {
    case '1':
      await msg.reply(`¡Perfecto! Pedí tu presupuesto acá: ${LINK_PRESUPUESTO}`);
      break;

    case '2':
      await msg.reply('¡Que bueno! 🎉 Te ponemos en contacto con alguien de nuestro equipo para empezar a generar tu página.');
      finalizados.add(from);
      break;

    case '3':
      await msg.reply('¡Dale! Dejame tu idea acá y en breve te contactamos para armarte el presupuesto.');
      finalizados.add(from);
      break;

    default:
      await msg.reply(MENU);
      break;
  }
});

client.initialize();
