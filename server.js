const express = require('express');
const qrcode = require('qrcode');
const path = require('path'); 
const { Client, LocalAuth } = require('whatsapp-web.js');

// --- CONTATOS E GRUPOS IGNORADOS ---
// O bot não responderá a mensagens destes IDs de chat.
// Formato: '5511999998888@c.us' para contatos, ou '5511999998888-123456@g.us' para grupos.
const IGNORED_CONTACTS = [
    // Adicione os IDs de contato que você quer IGNORAR aqui.
    // Exemplo: '5511987654321@c.us',
    // Exemplo: '1234567890-987654@g.us'
];

// --- 1. CONFIGURAÇÃO DA CONVERSA (SEU MENU) ---
// Defina aqui todas as etapas da sua conversa.
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
        // Esta é uma mensagem final, ela deve incluir uma forma de voltar.
        message: "As informações sobre roupas e estoque estão no link: www.suaempresa.com/roupas.\n\nDigite #MENU para voltar ao início.",
        is_final: true, // Indica que este estado não espera um número, mas sim o comando de retorno.
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },
    
    // Adicionando um novo estado para Calçados (exemplo)
    INFO_CALCADOS: {
        message: "Informações sobre calçados: Estamos com promoções de tênis! Acesse: www.suaempresa.com/calcados.\n\nDigite #MENU para voltar ao início.",
        is_final: true,
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },

    // Passo 1.2: Transferência para Humano
    HUMAN_TRANSFER: {
        message: "Entendido! Um atendente humano será notificado. Por favor, aguarde alguns instantes. Digite #MENU para cancelar e voltar.",
        is_final: true,
        // Em um sistema real, aqui você faria a integração com uma ferramenta de CRM.
        fallback_message: "Seu atendimento foi concluído. Digite #MENU para voltar ao Menu Principal."
    },

    // Passo Final: Encerramento da conversa
    END: {
        message: "Obrigado por usar nosso serviço! Digite qualquer coisa para recomeçar.",
        is_final: true,
        // Quando o usuário está no estado 'END', qualquer mensagem o retorna ao START
    }
};

// --- 2. GERENCIAMENTO DE SESSÃO E CLIENTE ---

// Objeto global para rastrear o estado de cada usuário { 'chatId': { state: 'current_state' } }
const SESSION_STATE = {}; 

// Configuração da Sessão Persistente
const SESSION_PATH = path.join(process.cwd(), '/data/.wwebjs_auth');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }), 
    puppeteer: {
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
    // 1. Ignorar mensagens de status ou enviadas pelo próprio bot
    if (msg.fromMe || msg.isStatus) return;

    const chatId = msg.from;
    
    // NOVO: Verifica se o contato está na lista de ignorados (Contatos Pessoais)
    if (IGNORED_CONTACTS.includes(chatId)) {
        console.log(`Mensagem de ${chatId} ignorada (Contato Pessoal/Excluído).`);
        return; 
    }
    
    const userMessage = msg.body.trim().toUpperCase(); // Normaliza a entrada
    let currentStateKey = SESSION_STATE[chatId] ? SESSION_STATE[chatId].state : 'START';

    // Se o usuário digitar #MENU em qualquer lugar, volta para o START
    if (userMessage === '#MENU') {
        currentStateKey = 'START';
        SESSION_STATE[chatId] = { state: currentStateKey };
        console.log(`Usuário ${chatId} resetou para o menu START.`);
    }

    const currentState = CONVERSATION_FLOW[currentStateKey];

    // Se o estado for 'END', qualquer mensagem reinicia o ciclo
    if (currentStateKey === 'END') {
        currentStateKey = 'START';
        SESSION_STATE[chatId] = { state: currentStateKey };
        await msg.reply(CONVERSATION_FLOW['START'].message);
        return;
    }

    // Se o estado for final (não espera opções numeradas, ex: INFO_ROUPAS)
    if (currentState.is_final) {
        // O bot apenas envia a mensagem de fallback (instrução de retorno)
        await msg.reply(currentState.fallback_message);
        return;
    }

    // 2. Processamento da opção
    const nextStateData = currentState.options ? currentState.options[userMessage] : null;

    if (nextStateData) {
        // Opção Válida: Atualiza o estado e envia a próxima mensagem
        const nextStateKey = nextStateData.next_state;
        const nextState = CONVERSATION_FLOW[nextStateKey];

        if (nextState) {
            SESSION_STATE[chatId] = { state: nextStateKey };
            
            // Envia a mensagem do próximo estado
            await msg.reply(nextState.message);
        } else {
            // Caso de erro na definição do FLOW
            await msg.reply('Erro de configuração: Estado seguinte não encontrado.');
            SESSION_STATE[chatId] = { state: 'START' };
        }
    } else {
        // Opção Inválida: Repete o menu atual
        await msg.reply(currentState.fallback_message + '\n\n' + currentState.message);
    }
});
// --- FIM DA LÓGICA DE AUTOMAÇÃO DE CONVERSA ---


// Inicialização
client.initialize().catch(err => {
    console.error('Erro durante a inicialização do cliente:', err);
});

// --- API Endpoints (os endpoints para o painel continuam os mesmos) ---

// 1. Status e QR Code
app.get('/api/status', (req, res) => {
    res.json({
        connected: clientConnected,
        qrCode: qrCodeBase64 
    });
});

// 2. Enviar Mensagem (Apenas para demonstração via painel)
app.post('/api/send-message', async (req, res) => {
    const { number, message } = req.body;
    
    if (!clientConnected) {
        return res.status(400).json({ success: false, error: 'O bot não está conectado ao WhatsApp.' });
    }

    try {
        await client.sendMessage(number, message);
        res.json({ success: true, message: `Mensagem enviada para ${number}` });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ success: false, error: 'Falha ao enviar mensagem.', details: error.message });
    }
});

// 3. Reconectar (Força o cliente a tentar um novo login, mas mantém a sessão salva)
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

// 4. Listar Contatos (Simplificado)
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

// 5. Listar Grupos
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
