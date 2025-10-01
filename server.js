const express = require('express');
const qrcode = require('qrcode');
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

app.use(express.json());

// Permite que o frontend (o HTML) em um domínio diferente acesse esta API
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// --- Lógica do WhatsApp Client ---

// Evento: Recebe o QR Code (o armazena como Base64)
client.on('qr', (qr) => {
    console.log('QR CODE RECEBIDO. Escaneie no console do servidor ou veja na interface web.');
    // Converte o QR string para um formato de imagem Base64
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

// Evento: Falha na autenticação (pode ser necessário um novo QR)
client.on('auth_failure', (msg) => {
    console.error('FALHA NA AUTENTICAÇÃO:', msg);
    clientConnected = false;
});

// Evento: Cliente desconectado
client.on('disconnected', (reason) => {
    console.log('Cliente desconectado', reason);
    clientConnected = false;
    // O cliente tentará reconectar, o evento 'qr' será disparado se necessário
});

// Inicialização
client.initialize().catch(err => {
    console.error('Erro durante a inicialização do cliente:', err);
});

// --- API Endpoints ---

// 0. NOVO ENDPOINT: Rota Raiz (Resolvendo o "Cannot GET /")
app.get('/', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Servidor Bot do WhatsApp está online e rodando. Use a rota /api/status para o status do bot.' });
});

// 1. Status e QR Code
app.get('/api/status', (req, res) => {
    res.json({
        connected: clientConnected,
        // Envia o Base64 do QR Code, se disponível
        qrCode: qrCodeBase64 
    });
});

// 2. Enviar Mensagem (Para demonstração via painel)
app.post('/api/send-message', async (req, res) => {
    const { number, message } = req.body;
    
    if (!clientConnected) {
        return res.status(400).json({ success: false, error: 'O bot não está conectado ao WhatsApp.' });
    }

    try {
        // Envia a mensagem (o número deve incluir o @c.us ou @g.us)
        await client.sendMessage(number, message);
        res.json({ success: true, message: `Mensagem enviada para ${number}` });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ success: false, error: 'Falha ao enviar mensagem.', details: error.message });
    }
});

// 3. Reconectar (Limpa a sessão atual, forçando o login ou novo QR Code)
app.post('/api/reconnect', async (req, res) => {
    try {
        // Isso forçará um logout e um novo ciclo de login (potencialmente um novo QR Code)
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
