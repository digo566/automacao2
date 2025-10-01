const express = require('express');
const qrcode = require('qrcode');
const path = require('path'); 
// IMPORTANTE: Adicionado MessageMedia para envio de arquivos
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// --- CONTATOS E GRUPOS IGNORADOS ---
// O bot não responderá a mensagens destes IDs de chat.
const IGNORED_CONTACTS = [
    // Adicione os IDs de contato que você quer IGNORAR aqui.
];

// --- 1. CONFIGURAÇÃO DA CONVERSA (SEU MENU) ---
// Para enviar uma mídia, use o objeto 'media' (type, url, caption).
const CONVERSATION_FLOW = {
    START: {
        message: "Olá! Seja bem-vindo ao Atendimento Automático.\nEscolha uma opção digitando o número correspondente:",
        options: {
            '1': { text: "1. Informações sobre Produtos", next_state: "PRODUCTS_MENU" },
            '2': { text: "2. Falar com um Atendente (Humano)", next_state: "HUMAN_TRANSFER" },
            '3': { text: "3. Encerrar Atendimento", next_state: "END" }
        },
        fallback_message: "Opção inválida. Por favor, digite 1, 2 ou 3."
    },
    PRODUCTS_MENU: {
        message: "Ótimo! Temos estas categorias:\n\n1. Roupas\n2. Calçados\n3. Voltar ao Menu Principal",
        options: {
            '1': { text: "1. Roupas", next_state: "INFO_ROUPAS" },
            '2': { text: "2. Calçados", next_state: "INFO_CALCADOS" },
            '3': { text: "3. Voltar ao Menu Principal", next_state: "START" }
        },
        fallback_message: "Opção inválida. Digite 1, 2 ou 3 para navegar."
    },
    // NOVO: Estado enviando uma Imagem (Exemplo de Roupas)
    INFO_ROUPAS: {
        message: "As informações sobre roupas e estoque estão no link abaixo.",
        media: {
            type: 'image',
            // URL de placeholder para teste. Use links diretos para suas imagens (JPG, PNG).
            url: 'https://placehold.co/600x400/50C878/FFFFFF?text=Catalogo+Roupas',
            caption: 'Veja nossos novos modelos de inverno! Clique no link para ver a coleção completa: www.suaempresa.com/roupas',
        },
        is_final: true,
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },
    // NOVO: Estado enviando outra Imagem (Exemplo de Calçados)
    INFO_CALCADOS: {
        message: "Aqui está o nosso folder de promoções!",
        media: {
            type: 'image',
            // URL de placeholder para teste. Para áudios ou documentos, use URLs diretas (MP3, PDF).
            url: 'https://placehold.co/600x400/007FFF/FFFFFF?text=Promocao+Calcados',
            caption: 'Tênis e sapatos com 30% OFF! Acesse: www.suaempresa.com/calcados',
        },
        is_final: true,
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },
    HUMAN_TRANSFER: {
        message: "Entendido! Um atendente humano será notificado. Por favor, aguarde alguns instantes. Digite #MENU para cancelar e voltar.",
        is_final: true,
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },
    END: {
        message: "Obrigado por usar nosso serviço! Digite qualquer coisa para recomeçar.",
        is_final: true,
    }
};

// --- 2. GERENCIAMENTO DE SESSÃO E CLIENTE ---

const SESSION_STATE = {}; 
const SESSION_PATH = path.join(process.cwd(), '/data/.wwebjs_auth');

// ARGUMENTOS DE OTIMIZAÇÃO EXTREMA PARA AMBIENTES CLOUD LIMITADOS
const PUPPETEER_ARGS = [
    '--no-sandbox', 
    '--disable-setuid-sandbox', 
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process', 
    '--disable-gpu',
    // Novos argumentos agressivos:
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-of-messages',
    '--ignore-certificate-errors',
    '--window-size=1280,720'
];

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }), 
    puppeteer: {
        args: PUPPETEER_ARGS,
        executablePath: '/usr/bin/google-chrome' 
    }
});

const app = express();
const PORT = process.env.PORT || 3001;
let qrCodeBase64 = null;
let clientConnected = false;

app.use(express.json());

// Configuração CORS (para comunicação com o painel web)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// --- Lógica do WhatsApp Client ---

client.on('qr', (qr) => {
    console.log('QR CODE RECEBIDO. Escaneie na interface web.');
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Erro ao gerar QR Code Base64:', err);
            qrCodeBase64 = null;
        } else {
            qrCodeBase64 = url.split(',')[1]; 
        }
    });
});

client.on('ready', () => {
    console.log('CLIENTE PRONTO E CONECTADO!');
    clientConnected = true;
    qrCodeBase64 = null; 
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado', reason);
    clientConnected = false;
});

// --- LÓGICA DE AUTOMAÇÃO DE CONVERSA ---
client.on('message', async (msg) => {
    if (msg.fromMe || msg.isStatus) return;

    const chatId = msg.from;
    
    if (IGNORED_CONTACTS.includes(chatId)) {
        console.log(`Mensagem de ${chatId} ignorada (Contato Pessoal/Excluído).`);
        return; 
    }
    
    const userMessage = msg.body.trim().toUpperCase();
    let currentStateKey = SESSION_STATE[chatId] ? SESSION_STATE[chatId].state : 'START';

    if (userMessage === '#MENU' || !msg.body) {
        currentStateKey = 'START';
        SESSION_STATE[chatId] = { state: currentStateKey };
        console.log(`Usuário ${chatId} resetou para o menu START.`);
    }

    const currentState = CONVERSATION_FLOW[currentStateKey];

    if (currentStateKey === 'END') {
        currentStateKey = 'START';
        SESSION_STATE[chatId] = { state: currentStateKey };
        await msg.reply(CONVERSATION_FLOW['START'].message);
        return;
    }

    if (currentState.is_final) {
        // Para estados finais que enviam mídia, tentamos enviar o fallback
        if (!currentState.media) {
            await msg.reply(currentState.fallback_message);
        }
        return;
    }

    const nextStateData = currentState.options ? currentState.options[userMessage] : null;

    if (nextStateData) {
        const nextStateKey = nextStateData.next_state;
        const nextState = CONVERSATION_FLOW[nextStateKey];

        if (nextState) {
            SESSION_STATE[chatId] = { state: nextStateKey };

            // --- NOVO: LÓGICA DE ENVIO DE MÍDIA ---
            if (nextState.media && nextState.media.url) {
                try {
                    const mediaUrl = nextState.media.url;
                    const mediaCaption = nextState.media.caption || '';
                    
                    // Cria o objeto MessageMedia a partir da URL
                    const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
                    
                    // Envia a mídia (imagem, áudio, etc.)
                    await client.sendMessage(chatId, media, { caption: mediaCaption });
                    
                    // Aguarda um momento para garantir a ordem e envia a mensagem de texto
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await msg.reply(nextState.message); 
                    
                } catch (mediaError) {
                    console.error(`ERRO AO ENVIAR MÍDIA para ${chatId}:`, mediaError.message);
                    // Se a mídia falhar (ex: URL inválida), envia apenas a mensagem de texto
                    await msg.reply(`⚠️ Ops! Houve um erro ao enviar a mídia. Enviando apenas o texto:\n\n${nextState.message}`);
                }
            } else {
                // Envio de mensagem de texto normal
                await msg.reply(nextState.message);
            }
        } else {
            await msg.reply('Erro de configuração: Estado seguinte não encontrado.');
            SESSION_STATE[chatId] = { state: 'START' };
        }
    } else {
        await msg.reply(currentState.fallback_message + '\n\n' + currentState.message);
    }
});
// --- FIM DA LÓGICA DE AUTOMAÇÃO DE CONVERSA ---

// Inicialização
client.initialize().catch(err => {
    console.error('Erro durante a inicialização do cliente:', err);
});

// --- API Endpoints ---
app.get('/api/status', (req, res) => {
    res.json({ connected: clientConnected, qrCode: qrCodeBase64 });
});

app.post('/api/send-message', async (req, res) => {
    const { number, message } = req.body;
    if (!clientConnected) return res.status(400).json({ success: false, error: 'O bot não está conectado ao WhatsApp.' });
    try {
        await client.sendMessage(number, message);
        res.json({ success: true, message: `Mensagem enviada para ${number}` });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Falha ao enviar mensagem.', details: error.message });
    }
});

app.post('/api/reconnect', async (req, res) => {
    try {
        await client.logout(); 
        clientConnected = false;
        qrCodeBase64 = null;
        res.json({ success: true, message: 'Tentativa de logout e reconexão iniciada.' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Falha na tentativa de reconexão.' });
    }
});

// NOVO ENDPOINT: LISTAR CONTATOS
app.get('/api/contacts', async (req, res) => {
    if (!clientConnected) return res.status(400).json({ success: false, error: 'Bot desconectado.' });
    try {
        const contacts = await client.getContacts();
        const simplifiedContacts = contacts
            .filter(c => !c.isGroup && c.name) // Filtra apenas contatos com nome e que não são grupos
            .map(c => ({ 
                id: c.id._serialized, 
                name: c.name || c.pushname || c.number 
            }));
        res.json({ success: true, data: simplifiedContacts });
    } catch (error) {
        console.error('Erro ao listar contatos:', error);
        res.status(500).json({ success: false, error: 'Falha ao obter lista de contatos.' });
    }
});

// NOVO ENDPOINT: LISTAR GRUPOS
app.get('/api/groups', async (req, res) => {
    if (!clientConnected) return res.status(400).json({ success: false, error: 'Bot desconectado.' });
    try {
        const chats = await client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(chat => ({ 
                id: chat.id._serialized, 
                name: chat.name
            }));
        res.json({ success: true, data: groups });
    } catch (error) {
        console.error('Erro ao listar grupos:', error);
        res.status(500).json({ success: false, error: 'Falha ao obter lista de grupos.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Node.js rodando na porta ${PORT}`);
});


