import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------
// 1. Функция для скачивания страницы ZOE
// ---------------------------
async function updateZoePage() {
    try {
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        const response = await axios.get("https://www.zoe.com.ua/outage/", {
            httpsAgent,
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "uk-UA,uk;q=0.9"
            },
            timeout: 20000
        });

        fs.writeFileSync("latest.html", response.data, "utf-8");
        console.log("✅ latest.html обновлён", new Date().toISOString());
    } catch (e) {
        console.error("❌ Ошибка при загрузке ZOE:", e.message);
    }
}

// ---------------------------
// 2. Чтение локальной страницы
// ---------------------------
function fetchZoePage() {
    if (!fs.existsSync("latest.html")) {
        throw new Error("Файл latest.html не найден");
    }
    return fs.readFileSync("latest.html", "utf-8");
}

// ---------------------------
// 3. Парсер статьи
// ---------------------------
function parseLatestArticle(html) {
    const $ = cheerio.load(html);
    let found = null;

    $("article").each((_, el) => {
        const title = $(el).find("h2").text().trim();
        const contentText = $(el).find(".content").text().trim();
        if (/\d\.\d/.test(contentText)) {
            found = { title, contentText };
            return false; // break
        }
    });

    if (!found) throw new Error("No article with queue data found");
    return found;
}

function parseQueues(text) {
    const queues = {};
    const regex = /(\d\.\d)[^\d]*(\d{2}:\d{2}[\s\S]*?)(?=\n\d\.\d|\n*$)/g;

    let match;
    while ((match = regex.exec(text)) !== null) {
        const queue = match[1];
        const times = match[2]
            .replace(/\n/g, " ")
            .split(",")
            .map(t => t.replace("–", "-").trim())
            .filter(Boolean);
        queues[queue] = times;
    }

    return queues;
}

// ---------------------------
// 4. API
// ---------------------------
app.get("/api/outage", async (req, res) => {
    try {
        const html = fetchZoePage();
        const article = parseLatestArticle(html);
        const queues = parseQueues(article.contentText);

        res.json({
            title: article.title,
            queues,
            updated_at: new Date().toISOString()
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        res.status(500).json({ error: "Failed to load outage data", details: error.message });
    }
});

app.get("/api/outage/queue/:queue", async (req, res) => {
    try {
        const queue = req.params.queue;
        const html = fetchZoePage();
        const article = parseLatestArticle(html);
        const queues = parseQueues(article.contentText);

        if (!queues[queue]) return res.status(404).json({ error: "Queue not found" });

        // проверка текущего состояния
        function timeToMinutes(time) {
            const [h, m] = time.split(":").map(Number);
            return h * 60 + m;
        }

        function getQueueStatus(periods) {
            const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
            let status = "ON", nextOff = null, nextOn = null;

            for (const period of periods) {
                const [from, to] = period.split("-").map(s => s.trim());
                const fromMin = timeToMinutes(from);
                const toMin = to === "24:00" ? 1440 : timeToMinutes(to);

                if (nowMin >= fromMin && nowMin < toMin) status = "OFF", nextOn = to;
                else if (nowMin < fromMin && !nextOff) nextOff = from;
            }
            return { status, nextOff, nextOn };
        }

        const periods = queues[queue];
        const { status, nextOff, nextOn } = getQueueStatus(periods);
        const nowStr = new Date().toTimeString().slice(0, 5);
        const today = new Date().toLocaleDateString("uk-UA");

        res.json({ queue, title: article.title, status, now: nowStr, today, periods, nextOff, nextOn, updated_at: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ error: "Failed to load queue data" });
    }
});

// ---------------------------
// 5. Автообновление каждые 3 часа
// ---------------------------
updateZoePage(); // сразу при старте
setInterval(updateZoePage, 1000 * 60 * 60 * 3); // каждые 3 часа

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
