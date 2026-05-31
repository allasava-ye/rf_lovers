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
                name: "Розовая хризантема",
                description: "Пышная хризантема в нежно-розовом обрамлении. Говорит о тепле и любви — именно то, что нужно для самого близкого человека.",
                image: "/rflovers_buket1.jpg",
                category: "mama",
                variants: [{ qty: 1, price: 3499 }],
                stock: 50
            },
            {
                id: 2,
                name: "Розы фуксия",
                description: "Яркие розы насыщенного цвета фуксия в кремовой упаковке. Дерзкий и романтичный выбор — такой букет не останется незамеченным.",
                image: "/rflovers_buket2.jpg",
                category: "date",
                variants: [{ qty: 1, price: 3199 }],
                stock: 50
            },
            {
                id: 3,
                name: "Персиковые розы Джульетта",
                description: "Пионовидные розы сорта Джульетта в оттенке персика. Нежный и изысканный букет для особенного дня — когда хочется сказать что-то большее.",
                image: "/rflovers_buket3.jpg",
                category: "anniversary",
                variants: [{ qty: 1, price: 3799 }],
                stock: 30
            },
            {
                id: 4,
                name: "Облако ромашек",
                description: "Лёгкий и живой букет из свежих ромашек в белоснежной упаковке. Летний, солнечный — для тех, кто умеет радоваться мелочам.",
                image: "/rflovers_buket4.jpg",
                category: "justbecause",
                variants: [{ qty: 1, price: 2999 }],
                stock: 40
            },
            {
                id: 5,
                name: "Кораллово-розовые розы",
                description: "Крупные розы кораллово-розового оттенка в фирменной упаковке с кружевной лентой. Пышный и праздничный — именно такой букет запоминается.",
                image: "/rflovers_buket5.jpg",
                category: "birthday",
                variants: [{ qty: 1, price: 3599 }],
                stock: 40
            },
            {
                id: 6,
                name: "Ирисы",
                description: "Благородные ирисы глубокого фиолетового цвета в графитовой упаковке. Стильный и сдержанный букет — для торжественного случая без лишней сентиментальности.",
                image: "/rflovers_buket6.jpg",
                category: "colleague",
                variants: [{ qty: 1, price: 2799 }],
                stock: 35
            },
            {
                id: 7,
                name: "Красные розы",
                description: "Классические красные розы в матовой упаковке с алой лентой. Когда слова лишние — говорят только цветы.",
                image: "/rflovers_buket7.jpg",
                category: "love",
                variants: [{ qty: 1, price: 3299 }],
                stock: 50
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
        const { items, total, address, phone, fullname, userId, username, firstName,
                deliveryDate, deliverySlot, isGift, recipientName, recipientPhone } = req.body;

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

        const recipientBlock = isGift
            ? `\n🎁 <b>Получатель:</b> ${recipientName || '—'}\n📞 <b>Тел. получателя:</b> <code>${recipientPhone || '—'}</code>`
            : '';

        const adminMessage =
            `🚨 <b>Новый заказ RF-lovers!</b>\n\n` +
            `👤 <b>Клиент:</b> ${fullname || 'Не указано'}\n` +
            `🔗 <b>Профиль:</b> <a href="tg://user?id=${userId}">${firstName || 'Без имени'}</a> (@${username || 'нет'})\n` +
            `📞 <b>Телефон:</b> <code>${phone}</code>\n` +
            `📍 <b>Адрес:</b> <code>${address}</code>\n` +
            `📅 <b>Доставка:</b> ${deliveryDate || '—'} · ⏰ ${deliverySlot || '—'}` +
            `${recipientBlock}\n\n` +
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

async function startBot() {
    try {
        await bot.start({ onStart: (botInfo) => console.log(`🤖 Бот @${botInfo.username} запущен!`) });
    } catch (e) {
        if (e.error_code === 409) {
            console.log('⚠️ 409 Conflict: повтор через 35 сек...');
            await new Promise(r => setTimeout(r, 35000));
            return startBot();
        }
        console.error('Критическая ошибка бота:', e);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ RF-lovers сервер запущен на порту ${PORT}`);
    startBot();
});
