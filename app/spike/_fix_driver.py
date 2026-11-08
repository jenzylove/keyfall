p = 'spike/judge-path.mjs'
s = open(p, encoding='utf8').read()
start = s.index('if (t) {\n  await click("#al-go")')
end = s.index('t = await waitText((s) => /STEP 4 OF 4/i.test(s)')
b = '''// Escape (or plain onboarding): use whichever vault form is visible.
const visible = async (sel) => { for (const h of await p.$$(sel)) { if (await h.isVisible()) return h; } return null; };
let saved = null; for (let i = 0; i < 30 && !(saved = await visible("#vf-saved")); i++) await new Promise((r) => setTimeout(r, 1000));
await saved.scrollIntoView(); await saved.click();
const go = await visible("#vf-go"); await go.click(); log("create vault (escape) clicked");
'''
s = s[:start] + b + s[end:]
s = s.replace('t = await waitText((s) => /Hit Satoshi/i.test(s), 90000);', 't = await p.waitForSelector("#bs-go", { timeout: 150000 }).catch(() => null);')
open(p, 'w', encoding='utf8').write(s)
print("ok")
