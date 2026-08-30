// Can an agent join a room from the cloud?
//
// WebMCP lives in a document, so a cloud agent needs a browser. Cloudflare
// Browser Rendering is a browser. Whether it is a browser that has WebMCP is
// a question about its Chrome version and about whether our origin trial
// token counts there, and neither is answerable by reading documentation.
//
// So this measures it. Kept in the repo because a negative answer is worth
// publishing too.

import puppeteer from '@cloudflare/puppeteer'

export async function handleCloudProbe(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url).searchParams.get('url') ?? new URL(req.url).origin + '/room.html'
  const browser = await puppeteer.launch(env.BROWSER)
  try {
    const page = await browser.newPage()
    const ua = await browser.userAgent()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
    // The surface is registered after the room connects, so give it a moment.
    let out: unknown = null
    for (let i = 0; i < 20; i++) {
      out = await page.evaluate(`(async () => {
        const mc = (self.document && document.modelContext) || (self.navigator && navigator.modelContext) || null
        if (!mc) return { namespace: null, tools: 0, keys: Object.getOwnPropertyNames(document).filter(k => /model/i.test(k)) }
        let names = []
        try { names = (await mc.getTools()).map(t => t.name) } catch (e) { return { namespace: 'yes', error: String(e) } }
        return { namespace: document.modelContext ? 'document' : 'navigator', tools: names.length, names: names.slice(0, 6) }
      })()`)
      if ((out as { tools?: number } | null)?.tools) break
      await new Promise(r => setTimeout(r, 750))
    }
    return Response.json({ ua, url, probe: out })
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 })
  } finally {
    await browser.close()
  }
}
