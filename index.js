import express from "express";
import fs from "fs";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 10000;

function fetchZoePage() {
    if (!fs.existsSync("latest.html")) {
        throw new Error("latest.html not found");
    }
    return fs.readFileSync("latest.html", "utf-8");
}

function parseLatestArticle(html) {
    const $ = cheerio.load(html);
    let found = null;

    $("article").each((_, el) => {
        const title = $(el).find("h2").text().trim();
        const contentText = $(el).find(".content").text().trim();
        if (/\d\.\d/.test(contentText)) {
            found = { title, contentText };
            return false;
        }
    });

    if (!found) throw new Error("No article found");
    return found;
}

function parseQueues(text) {
    const queues = {};
    const regex = /(\d\.\d)[^\d]*(\d{2}:\d{2}[\s\S]*?)(?=\n\d\.\d|\n*$)/g;

    let match;
    while ((match = regex.exec(text)) !== null) {
        queues[match[1]] = match[2]
            .replace(/\n/g, " ")
            .split(",")
            .map(t => t.trim());
    }

    return queues;
}

app.get("/api/outage", (req, res) => {
    try {
        const html = fetchZoePage();
        const article = parseLatestArticle(html);
        const queues = parseQueues(article.contentText);

        res.json({
            title: article.title,
            queues,
            updated_at: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () =>
    console.log(`✅ Server running on port ${PORT}`)
);
