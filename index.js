import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";

const app = express();
const PORT = process.env.PORT || 3000;

async function fetchZoePage() {
    const httpsAgent = new https.Agent({
        rejectUnauthorized: false
    });

    const response = await axios.get(
        "https://www.zoe.com.ua/outage/",
        {
            timeout: 20000,
            httpsAgent,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
                "Accept-Language": "uk-UA,uk;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Referer": "https://www.zoe.com.ua/"
              }
        }
    );

    return response.data;
}

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

    if (!found) {
        throw new Error("No article with queue data found");
    }

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

function timeToMinutes(time) {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
}

function isNowInPeriod(period) {
    const [from, to] = period.split("-").map(s => s.trim());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const fromMin = timeToMinutes(from);
    const toMin = to === "24:00" ? 1440 : timeToMinutes(to);

    return nowMin >= fromMin && nowMin < toMin;
}

function getQueueStatus(periods) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    let status = "ON";
    let nextOff = null;
    let nextOn = null;

    for (const period of periods) {
        const [from, to] = period.split("-").map(s => s.trim());
        const fromMin = timeToMinutes(from);
        const toMin = to === "24:00" ? 1440 : timeToMinutes(to);

        if (nowMin >= fromMin && nowMin < toMin) {
            status = "OFF";
            nextOn = to;
        } else if (nowMin < fromMin && !nextOff) {
            nextOff = from;
        }
    }

    return { status, nextOff, nextOn };
}

app.get("/api/outage", async (req, res) => {
    try {
        const html = await fetchZoePage();
        console.log("HTML length:", html.length);
        const article = parseLatestArticle(html);
        const queues = parseQueues(article.contentText);

        res.json({
            title: article.title,
            queues,
            updated_at: new Date().toISOString()
        });
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        res.status(500).json({
            error: "Failed to load outage data",
            details: error.message
        });
    }
});

app.get("/api/test", async (req, res) => {
    try {
      const html = await fetchZoePage();
      console.log("HTML:", html.slice(0, 500)); // первые 500 символов
      res.send("Check logs");
    } catch (e) {
      console.error(e);
      res.status(500).send(e.message);
    }
  });
  

app.get("/api/outage/queue/:queue", async (req, res) => {
    try {
        const queue = req.params.queue;

        const html = await fetchZoePage();
        console.log("HTML length:", html.length);
        const article = parseLatestArticle(html);
        const queues = parseQueues(article.contentText);

        if (!queues[queue]) {
            return res.status(404).json({ error: "Queue not found" });
        }

        const periods = queues[queue];
        const { status, nextOff, nextOn } = getQueueStatus(periods);

        const now = new Date();
        const nowStr = now.toTimeString().slice(0, 5);
        const today = now.toLocaleDateString("uk-UA");

        res.json({
            queue,
            title: article.title,
            status,
            now: nowStr,
            today,
            periods,
            nextOff,
            nextOn,
            updated_at: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: "Failed to load queue data" });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
