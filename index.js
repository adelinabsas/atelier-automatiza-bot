const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

const LINK_PRESUPUESTO = 'https://atelierautomatiza.com.ar/#presupuesto';

// Usuarios a los que ya se les cortó el bot (no se responde más hasta que escriban "menu")
const finalizados = new Set();

const MENU = `¡Hola! 👋 Bienvenido a *Atelier Automatiza*.

¿En qué te podemos ayudar?

1️⃣ Pedir presupuesto
2️⃣ Ya tengo presupuesto
3️⃣ Tengo dudas adicionales

Respondé con el número de la opción.`;

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
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
      await msg.reply('Ya va a estar alguien ayudándote con tus dudas. ¡Gracias por escribirnos!');
      finalizados.add(from);
      break;

    default:
      await msg.reply(MENU);
      break;
  }
});

client.initialize();
