const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
const fs = require('fs'); // Importa o módulo File System para ler o arquivo HTML

const app = express();
// O Render define a porta que deve ser usada em process.env.PORT
const PORT = process.env.PORT || 3000; 

app.use(cors());
app.use(express.json());

let client;
let isReady = false;
let qrCodeData = '';

// Inicializa o cliente WhatsApp
function initializeWhatsApp() {
    console.log('Iniciando o cliente WhatsApp...');
    
    // Se um cliente anterior existir, destrói-o antes de criar um novo
    if (client) {
        client.destroy().catch(e => console.error("Erro ao destruir cliente anterior:", e));
        client = null; // Limpa a referência
        isReady = false;
        qrCodeData = '';
    }

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            // Configurações recomendadas para ambientes Linux (Render)
            headless: true, 
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

    // Estado da conexão mudou (ex: desconectado)
    client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp Cliente Desconectado:', reason);
        isReady = false;
    });
    
    // Mensagem recebida (apenas para logging/debug - remova em produção)
    client.on('message', msg => {
        // console.log(`Mensagem recebida de ${msg.from}: ${msg.body}`);
    });

    client.initialize().catch(err => {
        console.error("Erro na inicialização do WhatsApp:", err);
    });
}

// Inicia o cliente na inicialização do servidor
initializeWhatsApp();

// ---------------------------------------------------
// ROTAS DA API
// ---------------------------------------------------

// Rota de Teste Simples (Rota raiz) - AGORA SERVE O PAINEL HTML
app.get('/', (req, res) => {
    try {
        const htmlPath = 'painel_whatsapp.html';
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        // Define o cabeçalho como HTML e envia o conteúdo do arquivo
        res.status(200).type('html').send(htmlContent);
    } catch (error) {
        console.error('Erro ao servir painel_whatsapp.html:', error);
        // Retorna uma mensagem de erro JSON se o arquivo HTML não for encontrado
        res.status(500).json({ 
            error: 'Erro interno ao carregar a interface. O servidor está rodando, mas não encontrou o arquivo painel_whatsapp.html.',
            details: error.message
        });
    }
});

// Rota de Status (Usada pelo painel HTML)
app.get('/api/status', (req, res) => {
    res.json({ 
        connected: isReady, 
        qrCode: qrCodeData // Envia o QR code (string) se estiver disponível
    });
});

// Enviar mensagem
app.post('/api/send-message', async (req, res) => {
    const { number, message } = req.body;

    if (!isReady) {
        return res.status(503).json({ error: 'WhatsApp não está conectado. Por favor, escaneie o QR Code.' });
    }

    if (!number || !message) {
        return res.status(400).json({ error: 'Número e mensagem são obrigatórios.' });
    }

    // O WhatsApp-web.js espera o ID completo (ex: 5511999998888@c.us)
    const chatId = number.includes('@') ? number : `${number}@c.us`; 

    try {
        await client.sendMessage(chatId, message);
        res.json({ success: true, message: 'Mensagem enviada com sucesso' });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Falha ao enviar mensagem', details: error.message });
    }
});

// Listar contatos (apenas o necessário)
app.get('/api/contacts', async (req, res) => {
    try {
        if (!isReady) {
            return res.status(400).json({ error: 'WhatsApp não está conectado' });
        }

        const contacts = await client.getContacts();
        // Filtra e mapeia para retornar apenas dados úteis
        const simpleContacts = contacts
            .filter(c => c.isMyContact || c.isUser) // Inclui usuários e contatos salvos
            .map(c => ({
                id: c.id._serialized,
                name: c.name || c.pushname || c.id.user, // Tenta nome salvo, depois nome de push, depois número
                number: c.number
            }));
        
        res.json(simpleContacts);
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
        console.log('Comando de reconexão recebido. Destruindo sessão atual...');
        if (client) {
            // Destrói a sessão atual para forçar uma nova inicialização (e QR Code, se necessário)
            await client.destroy(); 
            // Espera um momento antes de reinicializar para garantir a limpeza
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        initializeWhatsApp(); // Inicializa uma nova sessão
        res.json({ success: true, message: 'Reconectando o WhatsApp. Verifique o console para o QR Code.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao reconectar', details: error.message });
    }
});

// ---------------------------------------------------
// INICIALIZAÇÃO DO EXPRESS
// ---------------------------------------------------

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
