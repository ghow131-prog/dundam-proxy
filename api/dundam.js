const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * GET /api/dundam?server=cain&image=<charId>&debug=1
 *  - image 대신 charId 사용해도 됨: ...&charId=<id>
 */
module.exports = async (req, res) => {
  // CORS 허용(시트/앱스스크립트 호출용)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const image = (req.query.image || req.query.charId || "").trim();
  const server = (req.query.server || "cain").trim();
  const debug = "debug" in req.query;

  if (!image) {
    return res
      .status(400)
      .json({ error: "missing image (charId)", hint: "query: image or charId, server" });
  }

  let browser;
  try {
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8"
    });

    // 1) 캐릭터 페이지에서 세션/쿠키 생성
    const charUrl = `https://dundam.xyz/character?server=${encodeURIComponent(
      server
    )}&key=${encodeURIComponent(image)}`;

    await page.goto(charUrl, { waitUntil: "networkidle0", timeout: 60000 });
    // 약간의 안정화 대기(필요시)
    await page.waitForTimeout(800);

    // 2) 같은 컨텍스트에서 viewData.jsp 호출
    const apiPath = `/viewData.jsp?image=${encodeURIComponent(
      image
    )}&server=${encodeURIComponent(server)}&_=${Date.now()}`;

    const resData = await page.evaluate(async (path) => {
      try {
        const r = await fetch(path, { method: "GET", cache: "no-store" });
        const ct = r.headers.get("content-type") || "";
        const t = await r.text();
        return { status: r.status, contentType: ct, text: t };
      } catch (e) {
        return { error: String(e) };
      }
    }, apiPath);

    await page.close();

    if (debug) {
      return res.status(200).json({
        charUrl,
        apiPath,
        resultHead: (resData.text || "").slice(0, 300),
        contentType: resData.contentType,
        isJson: !!(resData.text && resData.text.trim().startsWith("{"))
      });
    }

    if (!resData.text || !resData.text.trim().startsWith("{")) {
      return res.status(502).json({
        error: "NOT_JSON",
        status: resData.status || null,
        contentType: resData.contentType || null,
        head: (resData.text || "").slice(0, 300)
      });
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(resData.text);
  } catch (e) {
    return res
      .status(500)
      .json({ error: "SERVER_ERROR", message: String(e), stack: e?.stack });
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
};
