const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');

const app = express();
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

    // Desconectado
    client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp desconectado. Motivo:', reason);
        isReady = false;
        // Tente inicializar novamente após um tempo (opcional)
        // setTimeout(() => initializeWhatsApp(), 5000); 
    });

    // Manipulador de Mensagens (Onde você coloca suas automações!)
    client.on('message', async message => {
        // Ignora mensagens enviadas pelo próprio bot (COMENTADO PARA FACILITAR O TESTE LOCAL)
        // Se você for usar em produção, é recomendável descomentar esta linha.
        // if (message.fromMe) return; 

        const command = message.body.toLowerCase().trim();
        const chat = await message.getChat();

        // Lógica de Comandos usando switch/case
        switch (command) {
            case '!olá':
                message.reply('Olá! Sou seu bot de automação. Digite `!ajuda` para ver os comandos disponíveis.');
                break;
            
            case '!ajuda':
                const helpMessage = `🤖 *Comandos de Automação*\n\n` +
                                    `*!olá*: Mensagem de boas-vindas.\n` +
                                    `*!ajuda*: Mostra esta lista de comandos.\n` +
                                    `*!status-bot*: Verifica se o bot está conectado.\n` +
                                    `*!meu-id*: Mostra o ID do seu chat (útil para a API).\n` +
                                    `*!grupo-nome*: Se estiver em um grupo, mostra o nome do grupo.`;
                message.reply(helpMessage);
                break;
                
            case '!status-bot':
                message.reply(isReady ? '✅ Estou conectado e pronto!' : '⚠️ Estou desconectado. Verifique o console.');
                break;

            case '!meu-id':
                // message.from é o ID do chat/contato
                message.reply(`Seu ID de Chat é:\n\`${message.from}\``);
                break;
            
            case '!grupo-nome':
                if (chat.isGroup) {
                    message.reply(`O nome deste grupo é: *${chat.name}*`);
                } else {
                    message.reply('Este comando só funciona em grupos!');
                }
                break;

            // Se a mensagem não for um comando, você pode adicionar uma resposta padrão
            // default:
            //     if (command.startsWith('!')) { // Se for um comando desconhecido
            //         message.reply('Comando desconhecido. Digite `!ajuda` para ver a lista de comandos.');
            //     }
        }
    });
    
    // Inicia a tentativa de conexão
    client.initialize();
}

// ---------------------------------------------------
// ENDPOINTS DA API EXPRESS
// ---------------------------------------------------

// Rota de Boas-vindas (FIX para o "Cannot GET /" )
app.get('/', (req, res) => {
    res.send(`
        <h1>Servidor de Automação WhatsApp Rodando! 🚀</h1>
        <p>Acesse o endpoint <code>/api/status</code> para verificar a conexão.</p>
        <p>Use clientes HTTP (Postman/Insomnia/cURL) para interagir com os outros endpoints:</p>
        <ul>
            <li><strong>GET /api/status</strong>: Verifica o status da conexão.</li>
            <li><strong>POST /api/send-message</strong>: Envia mensagens.</li>
            <li><strong>GET /api/contacts</strong>: Lista seus contatos.</li>
            <li><strong>POST /api/reconnect</strong>: Destrói e reinicializa a sessão.</li>
        </ul>
    `);
});

// Status da conexão
app.get('/api/status', (req, res) => {
    res.json({ 
        connected: isReady,
        qrCode: !isReady && qrCodeData ? qrCodeData : null, // Retorna o QR code apenas se não estiver pronto
        statusMessage: isReady ? 'Conectado' : (qrCodeData ? 'Aguardando QR Scan' : 'Inicializando...')
    });
});

// Enviar mensagem
app.post('/api/send-message', async (req, res) => {
    try {
        if (!isReady) {
            return res.status(400).json({ error: 'WhatsApp não está conectado' });
        }

        const { number, message } = req.body;
        
        // Formata o número (adiciona @c.us para contatos individuais)
        const chatId = number.includes('@g.us') ? number : `${number}@c.us`;
        
        const result = await client.sendMessage(chatId, message);
        
        res.json({ 
            success: true, 
            message: 'Mensagem enviada com sucesso',
            id: result.id._serialized, // Retorna o ID da mensagem enviada
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ 
            error: 'Erro ao enviar mensagem', 
            details: error.message 
        });
    }
});

// Listar contatos
app.get('/api/contacts', async (req, res) => {
    try {
        if (!isReady) {
            return res.status(400).json({ error: 'WhatsApp não está conectado' });
        }

        const contacts = await client.getContacts();
        res.json(contacts.map(c => ({
            id: c.id._serialized,
            name: c.name || c.pushname || 'Sem Nome',
            number: c.number
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

// Inicia o servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Acesse http://localhost:${PORT}`);
    initializeWhatsApp();
});

