require('dotenv').config();
const { Bot, InlineKeyboard, Keyboard } = require('grammy');
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
    console.error('Ошибка: BOT_TOKEN не задан в .env файле');
    process.exit(1);
}
const bot = new Bot(botToken);
const webAppUrl = process.env.WEBAPP_URL;

// ID администраторов (из .env через запятую)
const envAdmins = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
const ADMIN_IDS = envAdmins.length > 0 ? envAdmins : [];

// ── Гарантируем существование директорий ──────────────────────────────────────
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });

// ── База данных товаров ───────────────────────────────────────────────────────
const DB_FILE = path.join(__dirname, 'data', 'products.json');

let products = [];
try {
    if (fs.existsSync(DB_FILE)) {
        products = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
        products = [
            {
                id: 1,
                name: "Красная роза",
                description: "Классическая красная роза — символ любви и страсти. Свежая срезка, насыщенный цвет.",
                image: "https://images.unsplash.com/photo-1562690868-60bbe7293e94?auto=format&fit=crop&w=600&q=80",
                variants: [
                    { qty: 1, price: 350 },
                    { qty: 5, price: 1650 },
                    { qty: 11, price: 3500 },
                    { qty: 25, price: 7500 }
                ],
                stock: 100
            },
            {
                id: 2,
                name: "Розовый пион",
                description: "Пышный розовый пион с тонким ароматом. Идеально для букетов и подарков.",
                image: "https://images.unsplash.com/photo-1582794543139-8ac9cb0f7b11?auto=format&fit=crop&w=600&q=80",
                variants: [
                    { qty: 1, price: 500 },
                    { qty: 3, price: 1400 },
                    { qty: 5, price: 2300 },
                    { qty: 9, price: 4000 }
                ],
                stock: 50
            },
            {
                id: 3,
                name: "Тюльпан",
                description: "Яркие весенние тюльпаны. Свежие, объёмные, создают настроение.",
                image: "https://images.unsplash.com/photo-1520763185298-1b434c919102?auto=format&fit=crop&w=600&q=80",
                variants: [
                    { qty: 5, price: 1000 },
                    { qty: 11, price: 2000 },
                    { qty: 25, price: 4500 }
                ],
                stock: 200
            },
            {
                id: 4,
                name: "Гортензия",
                description: "Объёмная гортензия — воздушные лепестки, богатый вид. Отлично смотрится в любом интерьере.",
                image: "https://images.unsplash.com/photo-1628704499120-1a7421808e00?auto=format&fit=crop&w=600&q=80",
                variants: [
                    { qty: 1, price: 1500 },
                    { qty: 3, price: 4000 }
                ],
                stock: 20
            }
        ];
        fs.writeFileSync(DB_FILE, JSON.stringify(products, null, 2), 'utf8');
    }
} catch(e) {
    console.error("Ошибка загрузки БД:", e);
    products = [];
}

function saveDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(products, null, 2), 'utf8');
    } catch(e) {
        console.error("Ошибка сохранения БД:", e);
    }
}

// ── База данных пользователей (для рассылки) ──────────────────────────────────
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

let users = [];
try {
    if (fs.existsSync(USERS_FILE)) {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
} catch(e) {
    console.error('Ошибка загрузки списка пользователей:', e);
    users = [];
}

function saveUsersDb() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch(e) {
        console.error('Ошибка сохранения списка пользователей:', e);
    }
}

function trackUser(from) {
    if (!from || !from.id) return;
    if (users.some(u => u.id === from.id)) return;
    users.push({
        id: from.id,
        username: from.username || null,
        firstName: from.first_name || null,
    });
    saveUsersDb();
}

// ── Рассылка о новом товаре ───────────────────────────────────────────────────
//
// TODO (точки роста):
//   1. Генерация текста через AI (разные формулировки при каждой рассылке)
//   2. Отправка фото товара — заменить sendMessage на sendPhoto с caption
//   3. Персонализация по истории заказов / предпочтениям пользователя
//   4. Батчинг и rate-limit: Telegram допускает ~30 сообщений/сек на бота
//   5. Inline-кнопка "Открыть магазин" прямо в сообщении рассылки
//
async function broadcastNewProduct(product) {
    if (users.length === 0) {
        console.log('Рассылка: список пользователей пуст, пропускаем.');
        return;
    }

    const minPrice = product.variants && product.variants.length > 0
        ? Math.min(...product.variants.map(v => v.price))
        : 0;

    // Шаблонное сообщение — заменить на AI-генерацию в будущем
    const text =
        `🌷 <b>Новинка в RF-lovers!</b>\n\n` +
        `<b>${product.name}</b>\n` +
        `${product.description}\n\n` +
        `💰 От <b>${minPrice} ₽</b>\n\n` +
        `Загляните в магазин — заказать можно прямо в боте!`;

    console.log(`Рассылка: "${product.name}" → ${users.length} пользователей`);

    for (const user of users) {
        await bot.api
            .sendMessage(user.id, text, { parse_mode: 'HTML' })
            .catch(e => console.error(`Broadcast error [user ${user.id}]: ${e.message}`));
    }
}

// ── Настройка загрузки файлов ─────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'public', 'uploads'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('photo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

// ── API для фронтенда ─────────────────────────────────────────────────────────
app.get('/api/products', (req, res) => res.json(products));

app.post('/api/products', (req, res) => {
    const newProduct = { id: Date.now(), ...req.body };
    products.push(newProduct);
    saveDb();
    broadcastNewProduct(newProduct).catch(e => console.error('Broadcast failed:', e));
    res.json({ success: true, product: newProduct });
});

app.put('/api/products/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const index = products.findIndex(p => p.id === id);
    if (index !== -1) {
        products[index] = { ...products[index], ...req.body, id };
        saveDb();
        res.json({ success: true, product: products[index] });
    } else {
        res.status(404).json({ success: false });
    }
});

app.delete('/api/products/:id', (req, res) => {
    const id = parseInt(req.params.id);
    products = products.filter(p => p.id !== id);
    saveDb();
    res.json({ success: true });
});

// Обработка заказа через HTTP POST API (не закрывая WebApp)
app.post('/api/order', async (req, res) => {
    try {
        const { items, total, address, phone, fullname, userId, username, firstName } = req.body;

        for (const item of items) {
            const product = products.find(p => p.id === item.id);
            if (!product || product.stock < item.quantity) {
                return res.status(400).json({ success: false, error: `Недостаточно товара: ${item.name}` });
            }
        }

        for (const item of items) {
            const product = products.find(p => p.id === item.id);
            if (product) product.stock -= item.quantity;
        }

        saveDb();

        const itemsText = items.map(item =>
            `🌷 <b>${item.name}</b>\nКол-во: ${item.quantity} шт.\nСумма: ${item.price} ₽`
        ).join('\n\n');

        if (userId) {
            const userMessage =
                `✅ <b>Спасибо за заказ, ${fullname || 'дорогой клиент'}!</b>\n\n` +
                `<b>Ваш заказ:</b>\n${itemsText}\n\n` +
                `<b>Итого к оплате:</b> ${total} ₽\n\n` +
                `📍 <b>Адрес:</b> ${address}\n` +
                `📞 <b>Телефон:</b> ${phone}\n\n` +
                `Менеджер RF-lovers свяжется с вами в ближайшее время!`;
            await bot.api.sendMessage(userId, userMessage, { parse_mode: 'HTML' });
        }

        const adminMessage =
            `🚨 <b>Новый заказ RF-lovers!</b>\n\n` +
            `👤 <b>Клиент:</b> ${fullname || 'Не указано'}\n` +
            `🔗 <b>Профиль:</b> <a href="tg://user?id=${userId}">${firstName || 'Без имени'}</a> (@${username || 'нет'})\n` +
            `📞 <b>Телефон:</b> <code>${phone}</code>\n` +
            `📍 <b>Адрес:</b> <code>${address}</code>\n\n` +
            `<b>Состав заказа:</b>\n${itemsText}\n\n` +
            `💰 <b>Общая сумма:</b> ${total} ₽`;

        for (const adminId of ADMIN_IDS) {
            await bot.api
                .sendMessage(adminId, adminMessage, { parse_mode: 'HTML' })
                .catch(e => console.error(`Error sending to admin ${adminId}:`, e));
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Ошибка при обработке заказа:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Обработка команд бота ─────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
    trackUser(ctx.from);

    const userId = ctx.from.id;

    const replyKeyboard = new Keyboard()
        .webApp('🌷 RF-lovers', `${webAppUrl}/client.html`)
        .resized();

    await ctx.reply('Добро пожаловать в *RF-lovers*! 🌷\nСвежие цветы с доставкой.', {
        reply_markup: replyKeyboard,
        parse_mode: 'Markdown'
    });

    let inlineKeyboard = new InlineKeyboard()
        .webApp('🌷 Открыть магазин', `${webAppUrl}/client.html`);

    if (ADMIN_IDS.includes(userId)) {
        inlineKeyboard = inlineKeyboard.row()
            .webApp('⚙️ Управление магазином', `${webAppUrl}/admin.html`);
    }

    await ctx.reply('Нажмите кнопку ниже, чтобы выбрать цветы и оформить заказ.', {
        reply_markup: inlineKeyboard,
    });
});

bot.on('message:web_app_data', async (ctx) => {
    trackUser(ctx.from);

    try {
        const data = JSON.parse(ctx.message.web_app_data.data);
        const { items, total, address, phone, fullname } = data;
        const userId = ctx.from.id;

        const itemsText = items.map(item =>
            `🌷 <b>${item.name}</b>\nКол-во: ${item.quantity} шт.\nСумма: ${item.price} ₽`
        ).join('\n\n');

        const userMessage =
            `✅ <b>Спасибо за заказ, ${fullname || 'дорогой клиент'}!</b>\n\n` +
            `<b>Ваш заказ:</b>\n${itemsText}\n\n` +
            `<b>Итого к оплате:</b> ${total} ₽\n\n` +
            `📍 <b>Адрес:</b> ${address}\n` +
            `📞 <b>Телефон:</b> ${phone}\n\n` +
            `Менеджер RF-lovers свяжется с вами в ближайшее время!`;
        await ctx.reply(userMessage, { parse_mode: 'HTML' });

        const adminMessage =
            `🚨 <b>Новый заказ RF-lovers!</b>\n\n` +
            `👤 <b>Клиент:</b> ${fullname || 'Не указано'}\n` +
            `🔗 <b>Профиль:</b> <a href="tg://user?id=${userId}">${ctx.from.first_name || 'Без имени'}</a> (@${ctx.from.username || 'нет'})\n` +
            `📞 <b>Телефон:</b> <code>${phone}</code>\n` +
            `📍 <b>Адрес:</b> <code>${address}</code>\n\n` +
            `<b>Состав заказа:</b>\n${itemsText}\n\n` +
            `💰 <b>Общая сумма:</b> ${total} ₽`;

        for (const adminId of ADMIN_IDS) {
            await bot.api
                .sendMessage(adminId, adminMessage, { parse_mode: 'HTML' })
                .catch(e => console.error(`Error sending to admin ${adminId}:`, e));
        }
    } catch (e) {
        console.error('Web App Data Error:', e);
        await ctx.reply('Произошла ошибка при обработке заказа. Пожалуйста, попробуйте ещё раз.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ RF-lovers сервер запущен на порту ${PORT}`);
    bot.start({ onStart: (botInfo) => console.log(`🤖 Бот @${botInfo.username} запущен!`) });
});
