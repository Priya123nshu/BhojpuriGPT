/* ═══════════════════════════════════════════════════════════════════════
   GPT-2 Tuned — Frontend Logic
   ═══════════════════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const chatArea = $("#chat-area");
const promptInput = $("#prompt-input");
const sendBtn = $("#send-btn");
const settingsToggle = $("#settings-toggle");
const settingsPanel = $("#settings-panel");
const clearBtn = $("#clear-btn");
const statusIndicator = $("#status-indicator");

// ── Settings sliders ──
const sliders = {
    maxLength: { el: $("#max-length"), valEl: $("#max-length-val"), parse: (v) => parseInt(v), fmt: (v) => v },
    temperature: { el: $("#temperature"), valEl: $("#temperature-val"), parse: (v) => parseInt(v) / 100, fmt: (v) => (v / 100).toFixed(2) },
    topP: { el: $("#top-p"), valEl: $("#top-p-val"), parse: (v) => parseInt(v) / 100, fmt: (v) => (v / 100).toFixed(2) },
    topK: { el: $("#top-k"), valEl: $("#top-k-val"), parse: (v) => parseInt(v), fmt: (v) => v },
};

Object.values(sliders).forEach(({ el, valEl, fmt }) => {
    el.addEventListener("input", () => { valEl.textContent = fmt(el.value); });
});

function getSettings() {
    return {
        max_length: sliders.maxLength.parse(sliders.maxLength.el.value),
        temperature: sliders.temperature.parse(sliders.temperature.el.value),
        top_p: sliders.topP.parse(sliders.topP.el.value),
        top_k: sliders.topK.parse(sliders.topK.el.value),
    };
}

// ── Settings toggle ──
settingsToggle.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
    settingsToggle.classList.toggle("active");
});


// ── Clear chat ──
clearBtn.addEventListener("click", () => {
    chatArea.innerHTML = "";
    addWelcomeCard();
});

// ── Health check ──
async function checkHealth() {
    try {
        const res = await fetch("/api/health");
        const data = await res.json();
        if (data.status === "ok" && data.model_loaded) {
            setStatus("online", `Online · ${data.device.toUpperCase()}`);
        } else {
            setStatus("loading", "Model loading…");
        }
    } catch {
        setStatus("offline", "Offline");
    }
}

function setStatus(state, text) {
    statusIndicator.className = `status-badge status-${state}`;
    statusIndicator.querySelector(".status-text").textContent = text;
}

// ── Auto-resize textarea ──
promptInput.addEventListener("input", () => {
    promptInput.style.height = "auto";
    promptInput.style.height = Math.min(promptInput.scrollHeight, 150) + "px";
    sendBtn.disabled = promptInput.value.trim().length === 0;
});

// ── Keyboard shortcuts ──
promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) handleSend();
    }
});

// ── Example buttons ──
document.addEventListener("click", (e) => {
    if (e.target.closest(".example-btn")) {
        const prompt = e.target.closest(".example-btn").dataset.prompt;
        promptInput.value = prompt;
        promptInput.dispatchEvent(new Event("input"));
        handleSend();
    }
});

// ── Add welcome card ──
function addWelcomeCard() {
    chatArea.innerHTML = `
        <div class="welcome-card">
            <div class="welcome-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="url(#grad)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#ea580c"/><stop offset="100%" style="stop-color:#f59e0b"/></linearGradient></defs>
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
            </div>
            <h2>Welcome to Bhojpuri GPT</h2>
            <p>An AI assistant trained on Bhojpuri language aesthetics and songs. Type a prompt below to start.</p>
            <div class="example-prompts">
                <button class="example-btn" data-prompt="Lollipop Lagelu">🎵 Lollipop Lagelu</button>
                <button class="example-btn" data-prompt="Pyaar ke ekaise kahania">✍️ Pyar ke kahania</button>
                <button class="example-btn" data-prompt="Goriya chand ke anjoriya">🚀 Goriya chand ke</button>
            </div>
        </div>
    `;
}

// ── Create message element ──
function addMessage(role, content, meta = "") {
    // Remove welcome card if present
    const welcome = chatArea.querySelector(".welcome-card");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = `message ${role}-msg`;

    const avatarText = role === "user" ? "You" : "AI";
    div.innerHTML = `
        <div class="msg-avatar">${avatarText}</div>
        <div>
            <div class="msg-bubble">${role === 'bot' ? formatResponse(content) : escapeHtml(content)}</div>
            ${meta ? `<div class="msg-meta">${meta}</div>` : ""}
        </div>
    `;
    chatArea.appendChild(div);
    scrollToBottom();
    return div;
}

// ── Typing indicator ──
function addTypingIndicator() {
    const welcome = chatArea.querySelector(".welcome-card");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = "message bot-msg";
    div.id = "typing-msg";
    div.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div>
            <div class="msg-bubble">
                <div class="typing-indicator"><span></span><span></span><span></span></div>
            </div>
        </div>
    `;
    chatArea.appendChild(div);
    scrollToBottom();
}

function removeTypingIndicator() {
    const el = document.getElementById("typing-msg");
    if (el) el.remove();
}

// ── Typewriter effect ──
function typewriterMessage(text, meta = "") {
    const welcome = chatArea.querySelector(".welcome-card");
    if (welcome) welcome.remove();

    const div = document.createElement("div");
    div.className = "message bot-msg";
    div.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div>
            <div class="msg-bubble"></div>
            ${meta ? `<div class="msg-meta">${meta}</div>` : ""}
        </div>
    `;
    chatArea.appendChild(div);

    const bubble = div.querySelector(".msg-bubble");
    let i = 0;
    const speed = Math.max(8, Math.min(30, 1500 / text.length)); // adaptive speed

    function type() {
        if (i <= text.length) {
            bubble.innerHTML = formatResponse(text.substring(0, i));
            i++;
            scrollToBottom();
            setTimeout(type, speed);
        }
    }
    type();
}

// ── Send handler ──
let isGenerating = false;

async function handleSend() {
    if (isGenerating) return;

    const prompt = promptInput.value.trim();
    if (!prompt) return;

    addMessage("user", prompt);
    promptInput.value = "";
    promptInput.style.height = "auto";
    sendBtn.disabled = true;
    isGenerating = true;

    addTypingIndicator();

    try {
        const settings = getSettings();
        const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, ...settings }),
        });

        removeTypingIndicator();

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Unknown error" }));
            addMessage("bot", `⚠️ Error: ${err.detail || res.statusText}`);
            return;
        }

        const data = await res.json();
        const meta = `${data.tokens_generated} tokens`;
        typewriterMessage(data.generated_text || "(empty response)", meta);
    } catch (err) {
        removeTypingIndicator();
        addMessage("bot", `⚠️ Network error: ${err.message}`);
    } finally {
        isGenerating = false;
        sendBtn.disabled = promptInput.value.trim().length === 0;
    }
}

sendBtn.addEventListener("click", handleSend);

// ── Helpers ──
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatResponse(text) {
    let escaped = escapeHtml(text);
    // Replace newlines with <br> tags
    escaped = escaped.replace(/\n/g, '<br>');
    // Identify numbering (e.g. "1. ") at the start of line and wrap the number in a styled marking
    escaped = escaped.replace(/(^|<br>)(\d+)\.(?=\s)/g, '$1<span class="number-mark">$2</span>');
    return escaped;
}

function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
}

// ── Init ──
checkHealth();
setInterval(checkHealth, 15000);
