# Racka Chat

Magyar pixel-art chat felület és pehelykönnyű terminál-kliens a Racka-4B modellhez
(és bármilyen OpenAI-kompatibilis végponthoz).

*A Hungarian pixel-art web chat and a lightweight terminal harness for the
Racka-4B LLM (and any OpenAI-compatible endpoint).*

![Racka — a magyar juhfajta spirálszarvú báránya](https://img.shields.io/badge/racka-b%C3%A9%C3%A9%C3%A9-green)

## Mi ez? / What is this?

Az [elte-nlp/Racka-4B](https://huggingface.co/elte-nlp/Racka-4B) (ELTE, Qwen3-4B
alapú magyar nyelvmodell) két kliensfelülete:

- **`index.html`** — egyetlen fájl, nulla build. Pixel-art, magyar zászlószínek,
  CRT scanlines, streaming válaszok, thinking-megjelenítés, helyi
  tárolású beállítások (localStorage). Csak nyisd meg böngészőben.
- **`racka.mjs`** — nulla függőség, Node ≥ 18 TUI. Streaming, magyar
  parancsok, ANSI zászlóbanner, és egy spinner régies magyar igékkel
  (töpreng, mélázik, szöszmötöl… — az első négyet maga Racka választotta).

A Racka juhfajta Magyarország nemzeti kincse — a modell nevéhez méltóan a
felület is büszkén magyar.

## Gyors indítás / Quickstart

### Web (index.html)

Nyisd meg a fájlt böngészőben (vagy szerváld: `npx serve .`), majd a
**BEÁLLÍTÁSOK** alatt add meg:

- **Endpoint URL** — pl. egy Hugging Face Inference Endpoint címe
  (`https://....endpoints.huggingface.cloud`)
- **API token** — `hf_...` (a böngésződben marad, localStorage)

### TUI (racka.mjs)

```bash
RACKA_URL="https://<endpoint>" RACKA_TOKEN="hf_..." node racka.mjs
```

Első induláskor interaktívan is megadhatod; a konfig a `~/.racka.json`-ba
kerül (600-as joggal).

Parancsok:

| Parancs | Hatás |
|---|---|
| `/gondolkodas on\|off` | thinking ki/be (`chat_template_kwargs.enable_thinking`) |
| `/gondolatok` | reasoning szöveg mutatása/elrejtése |
| `/hofok <0-2>` | temperature |
| `/max <n>` | max output tokenek |
| `/torles` | előzmények törlése |
| `/kilepes` | kilépés |

## Saját Racka endpoint / Deploy your own

A Racka-4B gated modell — fogadd el a feltételeket a
[modelloldalon](https://huggingface.co/elte-nlp/Racka-4B), majd deployold
HF Inference Endpointsra. Bevált konfig (OpenAI-kompatibilis):

- Image: `vllm/vllm-openai:latest`, port 80, health `/health`
- Args: `--model /repository --port 80 --enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser qwen3`
- Hardver: `nvidia-l4` x1 (a T4 15 GB RAM-ja kevés)
- A kérésekben a modell neve: `/repository`

(TGI-s image-szel a `chat_template.jinja` nem töltődik be ebből a repóból —
ezért vLLM.)

Bármilyen más OpenAI-kompatibilis végpont is működik — a kliens csak
`/v1/chat/completions`-t és `/v1/models`-t hív.

## Licenc / License

MIT — lásd `LICENSE`. A modell licenci külön: CC-BY-NC-SA-4.0 (elte-nlp).

Készült sok szeretettel, paprikával és egy DGX Sparkkal. Bééé!
