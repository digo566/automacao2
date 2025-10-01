const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');

const app = express();
// ALTERAÇÃO CRÍTICA: Usa a variável de ambiente PORT (fornecida pelo Render/Railway) 
// ou 3001 como fallback para testar localmente.
const PORT = process.env.PORT || 3001; 

app.use(cors());
app.use(express.json());

let client;
let isReady = false;
let qrCodeData = '';

// Inicializa o cliente WhatsApp
function initializeWhatsApp() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            // Recomenda-se manter headless: true para um ambiente de servidor
            headless: true, 
            // Argumentos necessários para rodar o Puppeteer em ambientes Linux (Render/Railway)
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // ---------------------------------------------------
    // EVENTOS DO WHATSAPP CLIENT
    // ---------------------------------------------------

    // Gera QR Code
    client.on('qr', (qr) => {
        console.log('QR Code recebido, escaneie com seu WhatsApp:');
        qrcode.generate(qr, { small: true });
        qrCodeData = qr; // Armazena o QR code para ser acessível via API
        isReady = false; // Garante que o status seja falso enquanto aguarda conexão
    });

    // Cliente pronto
    client.on('ready', () => {
        console.log('✅ WhatsApp conectado com sucesso!');
        isReady = true;
        qrCodeData = ''; // Limpa o QR code ao conectar
    });

    // Cliente desconectado (pode ser útil para reconexão)
    client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp Cliente Desconectado:', reason);
        isReady = false;
        // Tenta reiniciar após desconexão
        setTimeout(initializeWhatsApp, 5000); 
    });

    client.on('auth_failure', (msg) => {
        // Dispara se a sessão não puder ser restaurada (e.g., telefone desconectado)
        console.error('Falha na Autenticação:', msg);
        isReady = false;
    });

    client.initialize();
}

initializeWhatsApp();


// ---------------------------------------------------
// ROTAS DA API
// ---------------------------------------------------

// 1. Rota de Status
app.get('/api/status', (req, res) => {
    // Retorna o status de conexão e o QR Code (se estiver pendente)
    res.json({ connected: isReady, qrCode: qrCodeData !== '' });
});

// 2. Rota para Enviar Mensagem
app.post('/api/send-message', async (req, res) => {
    if (!isReady) {
        return res.status(400).json({ error: 'WhatsApp não está conectado. Escaneie o QR Code primeiro.' });
    }

    const { number, message } = req.body;
    // O wweb.js requer o id completo (ex: 5511999998888@c.us)
    const chatId = number; 

    if (!chatId || !message) {
        return res.status(400).json({ error: 'Número/ID e mensagem são obrigatórios.' });
    }

    try {
        const result = await client.sendMessage(chatId, message);
        res.json({ success: true, id: result.id._serialized });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem', details: error.message });
    }
});

// 3. Listar contatos
app.get('/api/contacts', async (req, res) => {
    try {
        if (!isReady) {
            return res.status(400).json({ error: 'WhatsApp não está conectado' });
        }

        const chats = await client.getChats();
        const contacts = chats.filter(chat => !chat.isGroup);
        
        res.json(contacts.map(c => ({
            id: c.id._serialized,
            name: c.name || c.id.user,
            number: c.id.user
        })));
    } catch (error) {
        console.error('Erro ao listar contatos:', error);
        res.status(500).json({ error: 'Erro ao listar contatos' });
    }
});

// Listar grupos
app.get('/api/groups', async (req, res) => {
    try {
        if (!isReady) {
            return res.status(400).json({ error: 'WhatsApp não está conectado' });
        }

        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        
        res.json(groups.map(g => ({
            id: g.id._serialized,
            name: g.name
        })));
    } catch (error) {
        console.error('Erro ao listar grupos:', error);
        res.status(500).json({ error: 'Erro ao listar grupos' });
    }
});

// Reconectar
app.post('/api/reconnect', async (req, res) => {
    try {
        if (client) {
            // Destrói a sessão atual para forçar uma nova inicialização (e QR Code, se necessário)
            await client.destroy(); 
            // Espera um momento antes de reinicializar para garantir a limpeza
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        initializeWhatsApp();
        res.json({ success: true, message: 'Reconectando o WhatsApp. Verifique o console para o QR Code.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao reconectar', details: error.message });
    }
});

// Inicia o servidor Express
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
