const express = require('express');
const qrcode = require('qrcode');
const path = require('path'); 
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// --- Configuração da Sessão Persistente ---
// Define o caminho para salvar os dados de autenticação. 
// O '/data' deve ser mapeado como um Volume Persistente no seu provedor Cloud (ex: Render).
const SESSION_PATH = path.join(process.cwd(), '/data/.wwebjs_auth');
// --- Fim da Configuração da Sessão ---


const client = new Client({
    // Usa LocalAuth com o caminho persistente
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

// Variável para armazenar o QR Code em formato Base64
let qrCodeBase64 = null;
let clientConnected = false;

app.use(express.json());

// Permite que o frontend (o HTML) em um domínio diferente acesse esta API
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// --- Lógica do WhatsApp Client ---

// Evento: Recebe o QR Code (agora o armazenamos como Base64)
client.on('qr', (qr) => {
    console.log('QR CODE RECEBIDO. Escaneie na interface web.');
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Erro ao gerar QR Code Base64:', err);
            qrCodeBase64 = null;
        } else {
            // Guarda apenas a parte Base64 do URL de dados
            qrCodeBase64 = url.split(',')[1]; 
        }
    });
});

// Evento: Cliente pronto (Conectado)
client.on('ready', () => {
    console.log('CLIENTE PRONTO E CONECTADO!');
    clientConnected = true;
    qrCodeBase64 = null; // Limpa o QR Code quando a conexão é estabelecida
});

// Evento: Cliente desconectado
client.on('disconnected', (reason) => {
    console.log('Cliente desconectado', reason);
    clientConnected = false;
});

// Inicialização
client.initialize().catch(err => {
    console.error('Erro durante a inicialização do cliente:', err);
});

// --- API Endpoints ---

// 1. Status e QR Code
app.get('/api/status', (req, res) => {
    res.json({
        connected: clientConnected,
        qrCode: qrCodeBase64 
    });
});

// 2. Enviar Mensagem 
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

