// index.js
// ZDKAR Megabytes - Bot de atendimento automático via WhatsApp

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const catalogo = require("./catalogo");

const PEDIDOS_FILE = path.join(__dirname, "pedidos.json");
const NUMERO_PAGAMENTO_MPESA = "856668749";
const NUMERO_PAGAMENTO_EMOLA = "862076956";

const estadoClientes = {};

function carregarPedidos() {
  if (!fs.existsSync(PEDIDOS_FILE)) return [];
  return JSON.parse(fs.readFileSync(PEDIDOS_FILE, "utf-8"));
}

function guardarPedido(pedido) {
  const pedidos = carregarPedidos();
  pedidos.push(pedido);
  fs.writeFileSync(PEDIDOS_FILE, JSON.stringify(pedidos, null, 2), "utf-8");
}

function montarMenuPrincipal() {
  return (
    "🔴 *ZDKAR MEGABYTES* - Só Vodacom 🔴\n" +
    "Navegue sem limites!\n\n" +
    "Escolhe uma categoria enviando o número:\n\n" +
    "1️⃣ Pacotes Mini (24 horas)\n" +
    "2️⃣ Pacotes Normais (24 horas)\n" +
    "3️⃣ Pacotes Smart (30 dias)\n" +
    "4️⃣ Pacotes Diamante (mensal)\n" +
    "5️⃣ Diamante Movitel (mensal)\n\n" +
    "Digite *menu* a qualquer momento para voltar aqui."
  );
}

function montarListaCategoria(chave, titulo) {
  const itens = catalogo[chave];
  let texto = `📦 *${titulo}*\n\n`;
  itens.forEach((item, i) => {
    texto += `${i + 1}. ${item.pacote} — ${item.preco}MT (válido ${item.validade})\n`;
  });
  texto += "\nEnvia o número do pacote que queres comprar, ou *menu* para voltar.";
  return texto;
}

const CATEGORIAS = {
  "1": { chave: "mini", titulo: "Pacotes Mini" },
  "2": { chave: "normais", titulo: "Pacotes Normais (24H)" },
  "3": { chave: "smart", titulo: "Pacotes Smart (30 dias)" },
  "4": { chave: "diamante", titulo: "Pacotes Diamante (Mensal)" },
  "5": { chave: "diamante_movitel", titulo: "Diamante Movitel (Mensal)" },
};

async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("Escaneia este QR code com o teu WhatsApp (Aparelhos ligados):");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const motivo = lastDisconnect?.error?.output?.statusCode;
      const deveReconectar = motivo !== DisconnectReason.loggedOut;
      console.log("Conexão fechada. Reconectar?", deveReconectar);
      if (deveReconectar) iniciar();
    } else if (connection === "open") {
      console.log("✅ Bot ZDKAR Megabytes ligado e pronto a atender clientes!");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const remetente = msg.key.remoteJid;
    const texto = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""
    ).trim();

    if (!texto) return;

    const textoLower = texto.toLowerCase();

    if (["menu", "oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "start"].includes(textoLower)) {
      estadoClientes[remetente] = { etapa: "menu" };
      await sock.sendMessage(remetente, { text: montarMenuPrincipal() });
      return;
    }

    const estado = estadoClientes[remetente] || { etapa: "menu" };

    if (estado.etapa === "menu") {
      if (CATEGORIAS[texto]) {
        const { chave, titulo } = CATEGORIAS[texto];
        estadoClientes[remetente] = { etapa: "categoria", categoria: chave };
        await sock.sendMessage(remetente, { text: montarListaCategoria(chave, titulo) });
      } else {
        await sock.sendMessage(remetente, {
          text: "Não percebi 🤔. Envia *menu* para ver as opções.",
        });
      }
      return;
    }

    if (estado.etapa === "categoria") {
      const itens = catalogo[estado.categoria];
      const indice = parseInt(texto, 10) - 1;

      if (!isNaN(indice) && itens[indice]) {
        const pacoteEscolhido = itens[indice];
        estadoClientes[remetente] = {
          etapa: "aguardando_pagamento",
          categoria: estado.categoria,
          pacote: pacoteEscolhido,
        };

        const resposta =
          `✅ Escolheste: *${pacoteEscolhido.pacote}* — ${pacoteEscolhido.preco}MT\n\n` +
          `Para ativar, efetua o pagamento para:\n` +
          `📱 M-Pesa: ${NUMERO_PAGAMENTO_MPESA}\n` +
          `📱 e-Mola: ${NUMERO_PAGAMENTO_EMOLA}\n\n` +
          `Depois envia aqui o *número de telefone a ativar* e o *comprovativo de pagamento* (print ou código).\n\n` +
          `Assim que confirmarmos, o pacote é ativado! 🚀`;

        await sock.sendMessage(remetente, { text: resposta });
      } else {
        await sock.sendMessage(remetente, {
          text: "Esse número não é válido. Escolhe um pacote da lista ou envia *menu* para voltar.",
        });
      }
      return;
    }

    if (estado.etapa === "aguardando_pagamento") {
      guardarPedido({
        cliente: remetente,
        pacote: estado.pacote.pacote,
        preco: estado.pacote.preco,
        mensagemCliente: texto,
        dataHora: new Date().toISOString(),
        status: "pendente",
      });

      await sock.sendMessage(remetente, {
        text:
          "📥 Recebemos o teu pedido! Vamos confirmar o pagamento e ativar o pacote em breve.\n\n" +
          "Obrigado por escolheres a ZDKAR Megabytes! 🔴\n" +
          "Envia *menu* se quiseres fazer outro pedido.",
      });

      estadoClientes[remetente] = { etapa: "menu" };
      return;
    }
  });
}

iniciar();
