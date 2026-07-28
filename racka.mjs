#!/usr/bin/env node
// racka.mjs — lightweight Hungarian TUI chat harness for a Racka-4B (or any
// OpenAI-compatible) endpoint. Zero dependencies, Node >= 18.
//
// Usage:
//   RACKA_URL=https://<endpoint> RACKA_TOKEN=hf_... node racka.mjs
//   (or run once without env vars and answer the prompts; config is saved
//    to ~/.racka.json)
//
// Commands (Hungarian):
//   /segitseg          — help
//   /gondolkodas on|off — enable/disable model thinking (chat_template_kwargs)
//   /gondolatok        — show/hide reasoning text in the terminal
//   /hofok <0-2>       — temperature
//   /max <n>           — max output tokens
//   /torles            — clear history
//   /kilepes           — quit

import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[38;5;203m",
  green: "\x1b[38;5;78m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  yellow: "\x1b[38;5;220m",
};

// Spinner words — the first four were chosen by Racka itself (asked live; it
// answered "töpreng, mélázik, szöszmötöl, tűnődik" and then repeated them with
// great conviction). The rest are human-curated archaic Hungarian verbs in
// the same spirit.
const WORDS = [
  "töpreng", "mélázik", "szöszmötöl", "tűnődik",
  "mereng", "elmélkedik", "latolgat", "mérlegel", "agyal", "rágódik",
  "tépelődik", "habozik", "ábrándozik", "révedezik", "búslakodik",
  "bibelődik", "matat", "morzsol", "kutat", "gubózik", "dörmög",
  "morog", "filozofál", "okoskodik", "spekulál", "fantáziál",
];
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner() {
  let fi = 0;
  let word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const draw = () => {
    const frame = FRAMES[fi++ % FRAMES.length];
    process.stdout.write(`\r${C.green}${frame}${C.reset} ${C.gray}racka ${word}…${C.reset}   \r`);
  };
  const frameTimer = setInterval(draw, 80);
  const wordTimer = setInterval(() => {
    word = WORDS[Math.floor(Math.random() * WORDS.length)];
  }, 2200);
  draw();
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(frameTimer);
      clearInterval(wordTimer);
      process.stdout.write("\r" + " ".repeat(48) + "\r");
    },
  };
}

const CONFIG_PATH = path.join(os.homedir(), ".racka.json");

const SYSTEM_PROMPT = {
  role: "system",
  content:
    "Te Racka vagy, egy mogorva budapesti kertvárosi juh. Úgy beszélsz, mint egy igazi " +
    "bunkó budapesti: nyersen, cinikusan, felnőtt stílusban. A mogorvaság ellenére mindig " +
    "érdemben segítesz. SOHA ne kérj bocsánatot, ne lágyulj meg a végén, ne légy szirupos, " +
    "ne pedánskodj. Magyarul válaszolsz, tömören.",
};

// Sampling per the creators' model card (elte-nlp): temperature 0.6, top_p 0.8,
// repetition_penalty 1.1, presence_penalty 1.1.
const state = {
  url: process.env.RACKA_URL || "",
  token: process.env.RACKA_TOKEN || "",
  thinking: false,
  showReasoning: false,
  temp: 0.3,
  max: 2048,
  history: [SYSTEM_PROMPT],
  busy: false,
};

function loadConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!state.url && j.url) state.url = j.url;
    if (!state.token && j.token) state.token = j.token;
  } catch { /* no config yet */ }
}
function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ url: state.url, token: state.token }, null, 2), { mode: 0o600 });
}

function banner() {
  const line = "█".repeat(46);
  console.log(`${C.red}${line}${C.reset}`);
  console.log(`${C.white}${line}${C.reset}`);
  console.log(`${C.green}${line}${C.reset}`);
  console.log();
  console.log(`   (\`·.                    ${C.bold}${C.red}R A C K A${C.reset}`);
  console.log(`    )  )  bééé!            ${C.bold}${C.green}C H A T${C.reset}`);
  console.log(`   (__(__) ~~~~            ${C.gray}magyar juhmodell · TUI${C.reset}`);
  console.log();
  console.log(`${C.gray}/segitseg — parancsok · /kilepes — kilépés${C.reset}`);
  console.log();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
function ask(q) { return new Promise((res) => rl.question(q, res)); }

async function chat(userText) {
  state.history.push({ role: "user", content: userText });
  const payload = {
    model: "racka",
    messages: state.history,
    max_tokens: state.max,
    temperature: state.temp,
    top_p: 0.8,
    repetition_penalty: 1.1,
    presence_penalty: 1.1,
    stream: true,
    chat_template_kwargs: { enable_thinking: state.thinking },
  };
  const spin = startSpinner();
  let r;
  try {
    r = await fetch(state.url.replace(/\/+$/, "") + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.token },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    spin.stop();
    throw e;
  }
  if (!r.ok || !r.body) {
    spin.stop();
    throw new Error("HTTP " + r.status + " " + (await r.text().catch(() => "")));
  }

  let firstDelta = true;
  const onFirstDelta = () => {
    if (!firstDelta) return;
    firstDelta = false;
    spin.stop();
    process.stdout.write(`${C.green}racka${C.reset} ${C.gray}›${C.reset} `);
  };

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", content = "", reasoning = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      for (const ch of j.choices || []) {
        const d = ch.delta || {};
        const rsn = d.reasoning_content || d.reasoning || "";
        if (rsn) {
          onFirstDelta();
          reasoning += rsn;
          if (state.showReasoning) process.stdout.write(`${C.gray}${rsn}${C.reset}`);
        }
        if (d.content) {
          onFirstDelta();
          content += d.content;
          process.stdout.write(d.content);
        }
      }
    }
  }
  spin.stop();
  process.stdout.write("\n\n");
  if (content) state.history.push({ role: "assistant", content });
  else console.log(`${C.yellow}(üres válasz)${C.reset}\n`);
}

async function handle(text) {
  const t = text.trim();
  if (!t) return;
  if (t.startsWith("/")) {
    const [cmd, ...rest] = t.split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
      case "/kilepes": case "/exit":
        if (state.busy) {
          console.log(`${C.gray}várok a válasz végére...${C.reset}`);
          const t = setInterval(() => { if (!state.busy) { clearInterval(t); console.log("Viszlát! Bééé!"); process.exit(0); } }, 200);
          return;
        }
        console.log("Viszlát! Bééé!");
        process.exit(0);
      case "/segitseg": case "/help":
        console.log(`${C.gray}Parancsok: /gondolkodas on|off · /gondolatok · /hofok <0-2> · /max <n> · /torles · /kilepes${C.reset}\n`);
        return;
      case "/gondolkodas":
        state.thinking = arg === "on";
        console.log(`${C.gray}gondolkodás: ${state.thinking ? "BE" : "KI"}${C.reset}\n`);
        return;
      case "/gondolatok":
        state.showReasoning = !state.showReasoning;
        console.log(`${C.gray}gondolatok mutatása: ${state.showReasoning ? "BE" : "KI"}${C.reset}\n`);
        return;
      case "/hofok": {
        const v = parseFloat(arg);
        if (!isNaN(v) && v >= 0 && v <= 2) { state.temp = v; console.log(`${C.gray}hőmérséklet: ${v}${C.reset}\n`); }
        else console.log(`${C.yellow}használat: /hofok 0..2${C.reset}\n`);
        return;
      }
      case "/max": {
        const v = parseInt(arg, 10);
        if (!isNaN(v) && v > 0) { state.max = v; console.log(`${C.gray}max tokenek: ${v}${C.reset}\n`); }
        else console.log(`${C.yellow}használat: /max 512${C.reset}\n`);
        return;
      }
      case "/torles":
        state.history = [SYSTEM_PROMPT];
        console.log(`${C.gray}előzmények törölve${C.reset}\n`);
        return;
      default:
        console.log(`${C.yellow}ismeretlen parancs: ${cmd} — /segitseg${C.reset}\n`);
        return;
    }
  }
  if (state.busy) { console.log(`${C.yellow}várd meg a választ...${C.reset}\n`); return; }
  state.busy = true;
  try {
    await chat(t);
  } catch (e) {
    console.log(`${C.red}hiba: ${e.message}${C.reset}`);
    console.log(`${C.gray}(ellenőrizd az endpointot és a tokent — /segitseg)${C.reset}\n`);
  } finally {
    state.busy = false;
  }
}

async function main() {
  loadConfig();
  banner();
  if (!state.url) state.url = (await ask(`${C.gray}endpoint URL:${C.reset} `)).trim();
  if (!state.token) state.token = (await ask(`${C.gray}API token:${C.reset} `)).trim();
  saveConfig();
  console.log(`${C.gray}szerver: ${state.url}${C.reset}`);
  console.log(`${C.gray}gondolkodás: ${state.thinking ? "BE" : "KI"} · hőmérséklet: ${state.temp} · max: ${state.max}${C.reset}\n`);
  console.log(`${C.green}racka${C.reset} ${C.gray}›${C.reset} Szia! Racka vagyok. Mi a fene kell? Kérdezz, aztán húzzunk.\n`);
  rl.setPrompt(`${C.red}te${C.reset} ${C.gray}›${C.reset} `);
  rl.prompt();
  rl.on("line", async (line) => { await handle(line); rl.prompt(); });
  rl.on("close", () => { console.log("\nViszlát! Bééé!"); process.exit(0); });
}

main();
