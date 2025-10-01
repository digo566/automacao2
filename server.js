const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors'); // NOVIDADE: Importação do pacote CORS para melhor compatibilidade
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// O Puppeteer requer essas flags para rodar em ambientes como Render/Hostinger VPS
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Necessário em alguns ambientes como Render
            '--disable-gpu'
        ],
    }
});

const app = express();
const PORT = process.env.PORT || 3001;

// Variável para armazenar o QR Code em formato Base64
let qrCodeBase64 = null;
let clientConnected = false;

// 1. Configuração do CORS (Cross-Origin Resource Sharing)
// Usamos o pacote 'cors' para permitir acesso de qualquer origem ('*'), 
// essencial para o teste do HTML local contra o servidor na Render.
app.use(cors());

app.use(express.json());

// --- Lógica do WhatsApp Client ---

client.on('qr', (qr) => {
    // Quando o QR Code é gerado, o convertemos para Base64 para envio ao Frontend
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Erro ao gerar QR Code:', err);
            qrCodeBase64 = null;
        } else {
            qrCodeBase64 = url.split(',')[1]; // Captura apenas a string Base64
        }
    });
    console.log('QR CODE RECEBIDO. Escaneie na interface web.');
});

client.on('ready', () => {
    console.log('CLIENTE CONECTADO E PRONTO!');
    clientConnected = true;
    qrCodeBase64 = null; // Limpa o QR Code quando conectado
});

client.on('authenticated', () => {
    console.log('CLIENTE AUTENTICADO!');
});

client.on('auth_failure', (msg) => {
    // Fired if session restore was unsuccessful
    console.error('FALHA NA AUTENTICAÇÃO', msg);
    clientConnected = false;
});

client.on('disconnected', (reason) => {
    console.log('CLIENTE DESCONECTADO', reason);
    clientConnected = false;
    // Tenta inicializar novamente se desconectado
    client.initialize();
});

// Implementação básica de resposta (opcional, apenas para testar a funcionalidade do bot)
client.on('message_create', msg => {
    // Ignora mensagens enviadas pelo próprio bot
    if (msg.fromMe) {
        return;
    }

    if (msg.body === '!ping') {
        msg.reply('pong');
    }
});

// Inicia o cliente
client.initialize().catch(err => {
    console.error('Erro na inicialização do cliente:', err);
});

// --- Rotas da API ---

// 1. Rota de Status (para o Frontend)
app.get('/api/status', (req, res) => {
    res.json({ 
        connected: clientConnected,
        qrCode: clientConnected ? null : qrCodeBase64 // Envia o QR code apenas se não estiver conectado
    });
});

// 2. Rota para Enviar Mensagem
app.post('/api/send-message', async (req, res) => {
    if (!clientConnected) {
        return res.status(400).json({ success: false, error: 'O bot não está conectado ao WhatsApp.' });
    }

    const { number, message } = req.body;
    
    // A API do whatsapp-web.js requer o número no formato serializado
    // Ex: 5511999998888@c.us
    const chatId = number.endsWith('@c.us') || number.endsWith('@g.us') ? number : `${number}@c.us`;

    if (!chatId || !message) {
        return res.status(400).json({ success: false, error: 'Número e/ou mensagem inválidos.' });
    }

    try {
        await client.sendMessage(chatId, message);
        res.json({ success: true, message: 'Mensagem enviada com sucesso!' });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error.message);
        res.status(500).json({ success: false, error: 'Falha ao enviar mensagem.', details: error.message });
    }
});

// 3. Rota para Reconectar/Reinicializar (Logout)
app.post('/api/reconnect', async (req, res) => {
    try {
        if (clientConnected) {
            await client.logout();
            console.log('CLIENTE DESCONECTADO (Logout forçado).');
        }
        
        // Re-inicializar o cliente para tentar obter um novo QR Code ou sessão.
        // O handler client.on('disconnected') já tenta inicializar, mas fazemos aqui para garantir o fluxo.
        client.initialize();

        res.json({ success: true, message: 'Comando de reconexão/logout enviado. Aguarde o novo status.' });
    } catch (error) {
        console.error('Erro em /api/reconnect (logout):', error);
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
                name: chat.name || 'Grupo Sem Nome',
                participantsCount: chat.participants ? chat.participants.length : 'N/A'
            }));
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar grupos.' });
    }
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
