require('dotenv').config();
const { Bot, InlineKeyboard, Keyboard } = require('grammy');
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

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

// ── Профили клиентов ──────────────────────────────────────────────────────────
const PROFILES_FILE = path.join(__dirname, 'data', 'profiles.json');
let profiles = [];
try { if (fs.existsSync(PROFILES_FILE)) profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); } catch(e) { profiles = []; }
function saveProfiles() { try { fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8'); } catch(e) { console.error('profiles save error', e); } }

// ── Важные даты клиентов ──────────────────────────────────────────────────────
const DATES_FILE = path.join(__dirname, 'data', 'dates.json');
let importantDates = [];
try { if (fs.existsSync(DATES_FILE)) importantDates = JSON.parse(fs.readFileSync(DATES_FILE, 'utf8')); } catch(e) { importantDates = []; }
function saveDates() { try { fs.writeFileSync(DATES_FILE, JSON.stringify(importantDates, null, 2), 'utf8'); } catch(e) { console.error('dates save error', e); } }

// ── История заказов ───────────────────────────────────────────────────────────
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
let orderHistory = [];
try { if (fs.existsSync(HISTORY_FILE)) orderHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch(e) { orderHistory = []; }
function saveHistory() { try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(orderHistory, null, 2), 'utf8'); } catch(e) { console.error('history save error', e); } }

// ── Хэширование паролей (PBKDF2, без зависимостей) ───────────────────────────
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
    return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex') === hash;
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

        if (userId) {
            orderHistory.push({
                id: Date.now().toString(),
                telegramId: userId,
                items: items.map(i => ({ id: i.id, name: i.name, price: i.price })),
                date: new Date().toISOString()
            });
            saveHistory();
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Ошибка при обработке заказа:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Авторизация профилей ──────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
    const { firstName, phone, password, telegramId } = req.body;
    if (!firstName || !phone || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (profiles.find(p => p.phone === phone)) return res.status(400).json({ error: 'Номер уже зарегистрирован. Войдите в аккаунт.' });
    const token = crypto.randomBytes(32).toString('hex');
    const profile = { id: Date.now().toString(), firstName, phone, passwordHash: hashPassword(password), token, telegramId: telegramId || null, createdAt: new Date().toISOString() };
    profiles.push(profile);
    saveProfiles();
    res.json({ success: true, token, profile: { id: profile.id, firstName, phone } });
});

app.post('/api/auth/login', (req, res) => {
    const { phone, password, telegramId } = req.body;
    const profile = profiles.find(p => p.phone === phone);
    if (!profile || !verifyPassword(password, profile.passwordHash)) return res.status(401).json({ error: 'Неверный номер или пароль' });
    if (telegramId && !profile.telegramId) { profile.telegramId = telegramId; saveProfiles(); }
    res.json({ success: true, token: profile.token, profile: { id: profile.id, firstName: profile.firstName, phone: profile.phone } });
});

app.post('/api/auth/tg', (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'no telegramId' });
    const profile = profiles.find(p => String(p.telegramId) === String(telegramId));
    if (!profile) return res.status(404).json({ notFound: true });
    res.json({ success: true, token: profile.token, profile: { id: profile.id, firstName: profile.firstName, phone: profile.phone } });
});

// ── Важные даты ───────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const token = req.headers['x-auth-token'];
    const profile = profiles.find(p => p.token === token);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });
    req.profile = profile;
    next();
}

app.get('/api/dates', authMiddleware, (req, res) => {
    res.json(importantDates.filter(d => d.userId === req.profile.id));
});

app.post('/api/dates', authMiddleware, (req, res) => {
    const { label, month, day } = req.body;
    if (!label || !month || !day) return res.status(400).json({ error: 'Missing fields' });
    const entry = { id: Date.now().toString(), userId: req.profile.id, label, month, day, notifiedYears: [] };
    importantDates.push(entry);
    saveDates();
    res.json({ success: true, date: entry });
});

app.delete('/api/dates/:id', authMiddleware, (req, res) => {
    importantDates = importantDates.filter(d => !(d.id === req.params.id && d.userId === req.profile.id));
    saveDates();
    res.json({ success: true });
});

// ── Напоминания о важных датах (проверка каждый час) ─────────────────────────
const DAY_NAMES_RU = ['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];

async function checkReminders() {
    const now    = new Date();
    const target = new Date(now);
    target.setDate(now.getDate() + 3);
    const tMonth   = String(target.getMonth() + 1).padStart(2, '0');
    const tDay     = String(target.getDate()).padStart(2, '0');
    const thisYear = now.getFullYear();
    const dayName  = DAY_NAMES_RU[target.getDay()];

    for (const entry of importantDates) {
        if (entry.month !== tMonth || entry.day !== tDay) continue;
        if ((entry.notifiedYears || []).includes(thisYear)) continue;

        const profile = profiles.find(p => p.id === entry.userId);
        if (!profile?.telegramId) continue;

        const pastOrders = orderHistory.filter(o => String(o.telegramId) === String(profile.telegramId));
        const pastItems  = pastOrders.flatMap(o => o.items).slice(-5);
        const pastText   = pastItems.length > 0
            ? `\n\nМы помним, что раньше ты заказывал${pastItems.slice(0,2).map(i => ` <b>${i.name}</b>`).join(',')} — повторим или попробуем что-то новое?`
            : '';

        const available = products.filter(p => !p.hidden && p.stock > 0);
        const picks = [...available].sort(() => 0.5 - Math.random()).slice(0, 3);
        const picksText = picks.map((p, i) => {
            const minPrice = p.variants && p.variants.length > 0 ? Math.min(...p.variants.map(v => v.price)) : 0;
            return `${i + 1}. 🌷 <b>${p.name}</b> — от ${minPrice.toLocaleString('ru-RU')} ₽`;
        }).join('\n');

        const text =
            `🌷 <b>${profile.firstName}, привет!</b>\n\n` +
            `В <b>${dayName}</b> — <b>${entry.label}</b>. Не забудь порадовать цветами!` +
            `${pastText}\n\n` +
            `<b>Варианты специально для тебя:</b>\n${picksText}`;

        const keyboard = { inline_keyboard: [[{ text: '🌷 Открыть RF-lovers', web_app: { url: `${webAppUrl}/client.html` } }]] };

        await bot.api.sendMessage(profile.telegramId, text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(e => console.error(`Reminder error [tg ${profile.telegramId}]:`, e.message));

        entry.notifiedYears = [...(entry.notifiedYears || []), thisYear];
        saveDates();
    }
}

setInterval(checkReminders, 60 * 60 * 1000);

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
