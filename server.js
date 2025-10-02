const express = require('express');
const qrcode = require('qrcode');
const path = require('path'); 
const { Client, LocalAuth } = require('whatsapp-web.js');

// --- CONTATOS E GRUPOS IGNORADOS ---
const IGNORED_CONTACTS = [
    // Adicione os IDs de contato que você quer IGNORAR aqui.
];

// --- 1. CONFIGURAÇÃO DA CONVERSA (SEU MENU) ---
const CONVERSATION_FLOW = {
    // Passo Inicial: Define a mensagem de boas-vindas e as opções do menu principal.
    START: {
        message: "Olá! Seja bem-vindo ao Atendimento Automático.\nEscolha uma opção digitando o número correspondente:",
        options: {
            '1': {
                text: "1. Informações sobre Produtos",
                next_state: "PRODUCTS_MENU"
            },
            '2': {
                text: "2. Falar com um Atendente (Humano)",
                next_state: "HUMAN_TRANSFER"
            },
            '3': {
                text: "3. Encerrar Atendimento",
                next_state: "END"
            }
        },
        fallback_message: "Opção inválida. Por favor, digite 1, 2 ou 3."
    },

    // Passo 1.1: Menu de Produtos.
    PRODUCTS_MENU: {
        message: "Ótimo! Temos estas categorias:\n\n1. Roupas\n2. Calçados\n3. Voltar ao Menu Principal",
        options: {
            '1': {
                text: "1. Roupas",
                next_state: "INFO_ROUPAS"
            },
            '2': {
                text: "2. Calçados",
                next_state: "INFO_CALCADOS"
            },
            '3': {
                text: "3. Voltar ao Menu Principal",
                next_state: "START" // Volta ao menu inicial
            }
        },
        fallback_message: "Opção inválida. Digite 1, 2 ou 3 para navegar."
    },

    // Passo 1.1.1: Informações de Roupas
    INFO_ROUPAS: {
        message: "As informações sobre roupas e estoque estão no link: www.suaempresa.com/roupas.\n\nDigite #MENU para voltar ao início.",
        is_final: true, 
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },
    
    // Novo estado para Calçados (exemplo)
    INFO_CALCADOS: {
        message: "Informações sobre calçados: Estamos com promoções de tênis! Acesse: www.suaempresa.com/calcados.\n\nDigite #MENU para voltar ao início.",
        is_final: true,
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },

    // Passo 1.2: Transferência para Humano
    HUMAN_TRANSFER: {
        message: "Entendido! Um atendente humano será notificado. Por favor, aguarde alguns instantes. Digite #MENU para cancelar e voltar.",
        is_final: true,
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },

    // Passo Final: Encerramento da conversa
    END: {
        message: "Obrigado por usar nosso serviço! Digite qualquer coisa para recomeçar.",
        is_final: true,
    }
};

// --- 2. GERENCIAMENTO DE SESSÃO E CLIENTE ---

const SESSION_STATE = {}; 
const SESSION_PATH = path.join(process.cwd(), '/data/.wwebjs_auth');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }), 
    puppeteer: {
        // --- SEGUNDA CORREÇÃO DE ERRO CRÍTICO NA RENDER ---
        // Força o caminho executável para o local mais provável do Chrome em ambientes Linux.
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ],
    }
});

const app = express();
const PORT = process.env.PORT || 3001;

let qrCodeBase64 = null;
let clientConnected = false;

app.use(express.json());

// Configuração CORS 
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
        console.log(`Mensagem de ${chatId} ignorada.`);
        return; 
    }
    
    const userMessage = msg.body.trim().toUpperCase(); 
    let currentStateKey = SESSION_STATE[chatId] ? SESSION_STATE[chatId].state : 'START';

    if (userMessage === '#MENU') {
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
        await msg.reply(currentState.fallback_message);
        return;
    }

    const nextStateData = currentState.options ? currentState.options[userMessage] : null;

    if (nextStateData) {
        const nextStateKey = nextStateData.next_state;
        const nextState = CONVERSATION_FLOW[nextStateKey];

        if (nextState) {
            SESSION_STATE[chatId] = { state: nextStateKey };
            await msg.reply(nextState.message);
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
    res.json({
        connected: clientConnected,
        qrCode: qrCodeBase64 
    });
});

app.post('/api/send-message', async (req, res) => {
    const { number, message } = req.body;
    
    if (!clientConnected) {
        return res.status(400).json({ success: false, error: 'O bot não está conectado ao WhatsApp.' });
    }

    try {
        const targetId = number.includes('@') ? number : number.replace(/[^0-9]/g, '') + '@c.us';
        await client.sendMessage(targetId, message);
        res.json({ success: true, message: `Mensagem enviada para ${number}` });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
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
        console.error('Erro ao tentar reconectar/logout:', error);
        res.status(500).json({ success: false, error: 'Falha na tentativa de reconexão.' });
    }
});

app.get('/api/contacts', async (req, res) => {
    if (!clientConnected) {
        return res.status(400).json({ success: false, error: 'O bot não está conectado ao WhatsApp.' });
    }
    try {
        const chats = await client.getChats();
        const contacts = chats
            .filter(chat => !chat.isGroup)
            .map(chat => ({ 
                id: chat.id._serialized, 
                name: chat.name || chat.id.user, 
                number: chat.id.user 
            }));
        res.json(contacts);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar contatos.' });
    }
});

app.get('/api/groups', async (req, res) => {
    if (!clientConnected) {
        return res.status(400).json({ success: false, error: 'O bot não está conectado ao WhatsApp.' });
    }
    try {
        const chats = await client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(chat => ({ 
                id: chat.id._serialized, 
                name: chat.name 
            }));
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar grupos.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Node.js rodando na porta ${PORT}`);
});

