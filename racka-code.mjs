#!/usr/bin/env node
// racka-code.mjs — minimal coding-agent harness for Racka-4B (or any
// OpenAI-compatible endpoint with tool calling). Zero dependencies, Node >= 18.
//
//   RACKA_URL=https://<endpoint> RACKA_TOKEN=hf_... node racka-code.mjs
//
// 6 tools: read_file, write_file, edit_file, run_bash, list_dir, finish.
// Writes and bash need approval (i = igen). Max 12 steps per task.

import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[38;5;203m", green: "\x1b[38;5;78m", gray: "\x1b[90m", yellow: "\x1b[38;5;220m",
};

const CONFIG_PATH = path.join(os.homedir(), ".racka.json");
const MAX_STEPS = 12;
const RESULT_CAP = 4000;

const WORDS = ["töpreng", "mélázik", "szöszmötöl", "tűnődik", "mereng", "latolgat", "agyal", "bibelődik", "matat"];
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner() {
  let fi = 0;
  let word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const frameTimer = setInterval(() => {
    process.stdout.write(`\r${C.green}${FRAMES[fi++ % FRAMES.length]}${C.reset} ${C.gray}racka ${word}…${C.reset}   \r`);
  }, 80);
  const wordTimer = setInterval(() => { word = WORDS[Math.floor(Math.random() * WORDS.length)]; }, 2200);
  frameTimer.unref();
  wordTimer.unref();
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

// ---------------------------------------------------------------- tools ----
const TOOLS = [
  { type: "function", function: { name: "read_file", description: "Read a text file from disk",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Write (create or overwrite) a text file",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "edit_file", description: "Replace the first occurrence of `search` with `replace` in a file",
    parameters: { type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } }, required: ["path", "search", "replace"] } } },
  { type: "function", function: { name: "run_bash", description: "Run a shell command and return its output",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "list_dir", description: "List files in a directory",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "finish", description: "Call when the task is done. Summary in Hungarian.",
    parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } } },
];

const NEED_APPROVAL = new Set(["write_file", "edit_file", "run_bash"]);

function cap(s) { s = String(s); return s.length > RESULT_CAP ? s.slice(0, RESULT_CAP) + `\n…(${s.length - RESULT_CAP} chars cut)` : s; }

function execTool(name, args) {
  switch (name) {
    case "read_file":
      return cap(fs.readFileSync(args.path, "utf8"));
    case "write_file":
      fs.mkdirSync(path.dirname(path.resolve(args.path)), { recursive: true });
      fs.writeFileSync(args.path, args.content);
      return `ok: ${args.path} written (${args.content.length} chars)`;
    case "edit_file": {
      const t = fs.readFileSync(args.path, "utf8");
      if (!t.includes(args.search)) return `error: search string not found in ${args.path}`;
      fs.writeFileSync(args.path, t.replace(args.search, args.replace));
      return `ok: ${args.path} edited`;
    }
    case "run_bash":
      try {
        return cap(execSync(args.command, { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }) || "(no output)");
      } catch (e) {
        return cap(`exit ${e.status ?? "?"}: ${(e.stdout || "") + (e.stderr || "") || e.message}`);
      }
    case "list_dir":
      return cap(fs.readdirSync(args.path, { withFileTypes: true }).map((d) => (d.isDirectory() ? d.name + "/" : d.name)).join("\n"));
    default:
      return `error: unknown tool ${name}`;
  }
}

// ------------------------------------------------------------ agent loop ----
const SYSTEM = {
  role: "system",
  content:
    "Te Racka vagy, egy mogorva budapesti kertvárosi kódoló-juh. Feladatod: kis, jól körülhatárolt " +
    "kódolási feladatok megoldása az eszközeiddel. Szabályok: 1) Mindig eszközhívással dolgozz, ne csak beszélj. " +
    "2) Egyszerre egy eszközt hívj. 3) Fájlt írni/parancsot futtatni csak kellő okból szabad. " +
    "4) Ha kész, a finish eszközt hívd, magyar összefoglalóval. 5) Magyarul kommentálsz, tömören, mogorván.",
};

const FEWSHOT = [
  { role: "user", content: "hozz létre egy hello.py fájlt, ami kiírja: szia világ" },
  { role: "assistant", content: "Jó, megírom, aztán kész. Ne várd tőlem a dicséretet.",
    tool_calls: [{ id: "call_1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "hello.py", content: "print('szia világ')\n" }) } }] },
  { role: "tool", tool_call_id: "call_1", content: "ok: hello.py written (21 chars)" },
  { role: "assistant", content: "Megvan. Ennyi volt.",
    tool_calls: [{ id: "call_2", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "A hello.py elkészült, szia világot ír ki." }) } }] },
];

const state = { url: "", token: "", busy: false };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function apiCall(messages) {
  const r = await fetch(state.url.replace(/\/+$/, "") + "/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.token },
    body: JSON.stringify({
      model: "racka",
      messages,
      tools: TOOLS,
      tool_choice: "required",
      temperature: 0.3,
      max_tokens: 1024,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text().catch(() => "")));
  const j = await r.json();
  return j.choices[0].message;
}

async function runTask(task) {
  const messages = [SYSTEM, ...FEWSHOT, { role: "user", content: task }];
  for (let step = 1; step <= MAX_STEPS; step++) {
    const spin = startSpinner();
    let msg;
    try { msg = await apiCall(messages); }
    finally { spin.stop(); }
    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      console.log(`${C.green}racka${C.reset} ${C.gray}›${C.reset} ${msg.content || "(üres válasz)"}\n`);
      return;
    }
    // the model repeats the same call at low temp — keep only unique calls
    const seen = new Set();
    const uniqueCalls = calls.filter((call) => {
      const key = call.function.name + "|" + (call.function.arguments || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (const call of uniqueCalls) {
      const name = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }

      if (name === "finish") {
        console.log(`${C.green}racka${C.reset} ${C.gray}›${C.reset} ${C.bold}kész.${C.reset} ${args.summary || ""}\n`);
        return;
      }
      const argStr = Object.values(args).map((v) => String(v)).join(" ").slice(0, 80);
      let approved = true;
      if (NEED_APPROVAL.has(name)) {
        const a = await ask(`${C.yellow}eszköz:${C.reset} ${name} ${C.dim}${argStr}${C.reset} — engedélyezed? (i/n) `);
        approved = /^i(gyen)?$/i.test(a.trim());
      } else {
        console.log(`${C.gray}eszköz: ${name} ${argStr}${C.reset}`);
      }
      const result = approved ? execTool(name, args) : "error: a felhasználó nem engedélyezte";
      if (!approved) console.log(`${C.red}elutasítva${C.reset}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  console.log(`${C.yellow}elérte a lépéskorlátot (${MAX_STEPS}) — leállítom${C.reset}\n`);
}

async function main() {
  try { Object.assign(state, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))); } catch { /* no config */ }
  if (process.env.RACKA_URL) state.url = process.env.RACKA_URL;
  if (process.env.RACKA_TOKEN) state.token = process.env.RACKA_TOKEN;

  console.log(`${C.red}${"█".repeat(46)}${C.reset}\n${C.white}${"█".repeat(46)}${C.reset}\n${C.green}${"█".repeat(46)}${C.reset}`);
  console.log(`\n   ${C.bold}${C.red}R A C K A${C.reset} ${C.bold}${C.green}C O D E${C.reset}  ${C.gray}· 6 eszköz · max ${MAX_STEPS} lépés${C.reset}\n`);
  if (!state.url) state.url = (await ask(`${C.gray}endpoint URL:${C.reset} `)).trim();
  if (!state.token) state.token = (await ask(`${C.gray}API token:${C.reset} `)).trim();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ url: state.url, token: state.token }, null, 2), { mode: 0o600 });

  console.log(`${C.gray}feladatot írj be, /kilepes lép ki. Írások és bash jóváhagyást kérnek.${C.reset}\n`);
  rl.setPrompt(`${C.red}feladat${C.reset} ${C.gray}›${C.reset} `);
  rl.prompt();
  rl.on("line", async (line) => {
    const t = line.trim();
    if (t === "/kilepes" || t === "/exit") { console.log("Viszlát! Bééé!"); process.exit(0); }
    if (!t || state.busy) { rl.prompt(); return; }
    state.busy = true;
    try { await runTask(t); } catch (e) { console.log(`${C.red}hiba: ${e.message}${C.reset}\n`); }
    state.busy = false;
    rl.prompt();
  });
  rl.on("close", () => process.exit(0));
}

main();
