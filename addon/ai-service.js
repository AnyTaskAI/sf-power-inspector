/**
 * SF Power Inspector PRO — AI & Privacy Guard Service
 * Multi-Provider AI Architecture with subtleCrypto AES-GCM Key Encryption
 * and Einstein Trust Layer Data Masking.
 */

// ─── Universal Safe Storage Adapter (Service Worker & Window Resilient) ───────
const _aiMemStore = new Map();
const safeStorage = {
  getItem: (k) => {
    try {
      if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
        return localStorage.getItem(k);
      }
    } catch (e) {}
    return _aiMemStore.has(k) ? _aiMemStore.get(k) : null;
  },
  setItem: (k, v) => {
    const s = String(v);
    _aiMemStore.set(k, s);
    try {
      if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.setItem === "function") {
        localStorage.setItem(k, s);
      }
    } catch (e) {}
  },
  removeItem: (k) => {
    _aiMemStore.delete(k);
    try {
      if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.removeItem === "function") {
        localStorage.removeItem(k);
      }
    } catch (e) {}
  }
};

// ─── 1. ENCRYPTION & KEY VAULT (Web Crypto AES-GCM) ─────────────────
const SALT = new Uint8Array([83, 70, 80, 73, 95, 65, 73, 95, 83, 69, 67, 82, 69, 84, 95, 49]);

async function getEncryptionKey() {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode("SF_POWER_INSPECTOR_BYO_KEY_VAULT_2026"),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: SALT,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function saveEncryptedKey(provider, plainKey) {
  if (!plainKey) {
    safeStorage.removeItem(`sfpi_key_${provider}`);
    return;
  }
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainKey);
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const payload = {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(cipherBuffer)),
  };
  safeStorage.setItem(`sfpi_key_${provider}`, JSON.stringify(payload));
}

export async function getDecryptedKey(provider) {
  const raw = safeStorage.getItem(`sfpi_key_${provider}`);
  if (!raw) return "";
  try {
    const payload = JSON.parse(raw);
    const key = await getEncryptionKey();
    const iv = new Uint8Array(payload.iv);
    const data = new Uint8Array(payload.data);
    const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(decryptedBuffer);
  } catch (e) {
    console.warn("[ai-service] Key decryption failed:", e);
    return "";
  }
}

// ─── 2. EINSTEIN TRUST LAYER DYNAMIC DATA MASKER ────────────────────
export function maskSensitiveData(text, strict = false) {
  if (!text || typeof text !== "string") return text;

  let masked = text;

  // Mask Emails (e.g. john.doe@acme.com -> j***e@a***e.com)
  masked = masked.replace(/([a-zA-Z0-9_\-.]{2})[a-zA-Z0-9_\-.]*@([a-zA-Z0-9_\-.]{2})[a-zA-Z0-9_\-.]*\.([a-zA-Z]{2,})/g, "$1***@$2***.$3");

  // Mask Phone numbers
  masked = masked.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[PHONE_MASKED]");

  // Mask SSN / National IDs
  masked = masked.replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[SSN_MASKED]");

  // Mask Credit Cards (13 to 16 digits)
  masked = masked.replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, "[CREDIT_CARD_MASKED]");

  // Strict: Mask exact currency values
  if (strict) {
    masked = masked.replace(/\$\s?[\d,]+(\.\d{2})?/g, "[CURRENCY_REDACTED]");
  }

  return masked;
}

// ─── 3. MULTI-PROVIDER AI EXECUTION ─────────────────────────────────
export async function executeAiQuery({ prompt, systemPrompt = "", provider = "local", strictMasking = true }) {
  // Apply Trust Layer Masking before sending
  const sanitizedPrompt = maskSensitiveData(prompt, strictMasking);
  const effectiveSystemPrompt = systemPrompt || "You are an elite Salesforce Principal Technical Architect, Certified Technical Architect (CTA), and Security Specialist. Output clean, syntactically correct code and clear architectural reasoning.";

  if (provider === "local" || !provider) {
    return generateLocalResponse(sanitizedPrompt);
  }

  const apiKey = await getDecryptedKey(provider);
  if (!apiKey) {
    return {
      success: false,
      error: `No API key configured for provider '${provider}'. Please add your API key in AI Assistant Settings or switch to Local Architecture Mode.`,
      content: generateLocalResponse(sanitizedPrompt).content
    };
  }

  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: safeStorage.getItem("sfpi_openai_model") || "gpt-4o",
          messages: [
            { role: "system", content: effectiveSystemPrompt },
            { role: "user", content: sanitizedPrompt }
          ],
          temperature: 0.2
        })
      });
      if (!res.ok) throw new Error(`OpenAI Error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      return { success: true, content: json.choices?.[0]?.message?.content || "" };
    }

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "dangerously-allow-browser": "true"
        },
        body: JSON.stringify({
          model: safeStorage.getItem("sfpi_anthropic_model") || "claude-3-5-sonnet-20241022",
          max_tokens: 2048,
          system: effectiveSystemPrompt,
          messages: [{ role: "user", content: sanitizedPrompt }]
        })
      });
      if (!res.ok) throw new Error(`Anthropic Error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      return { success: true, content: json.content?.[0]?.text || "" };
    }

    if (provider === "gemini") {
      const model = safeStorage.getItem("sfpi_gemini_model") || "gemini-1.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${effectiveSystemPrompt}\n\nTask: ${sanitizedPrompt}` }] }]
        })
      });
      if (!res.ok) throw new Error(`Gemini Error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      return { success: true, content: json.candidates?.[0]?.content?.parts?.[0]?.text || "" };
    }

    if (provider === "ollama") {
      const endpoint = safeStorage.getItem("sfpi_ollama_endpoint") || "http://localhost:11434";
      const model = safeStorage.getItem("sfpi_ollama_model") || "llama3.2";
      const res = await fetch(`${endpoint.replace(/\/+$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model,
          prompt: `${effectiveSystemPrompt}\n\nUser: ${sanitizedPrompt}\nAssistant:`,
          stream: false
        })
      });
      if (!res.ok) throw new Error(`Ollama Error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      return { success: true, content: json.response || "" };
    }

    return generateLocalResponse(sanitizedPrompt);
  } catch (err) {
    console.error("[ai-service] Provider execution error:", err);
    return {
      success: false,
      error: err.message,
      content: generateLocalResponse(sanitizedPrompt).content
    };
  }
}

// ─── 4. LOCAL RULE & ARCHITECTURE SIMULATION ENGINE ─────────────────
function generateLocalResponse(prompt) {
  const p = prompt.toLowerCase();

  // Natural Language to SOQL
  if (p.includes("soql") || p.includes("select") || p.includes("query") || p.includes("find all") || p.includes("show me")) {
    if (p.includes("contact") && p.includes("account")) {
      return {
        success: true,
        isLocal: true,
        content: `\`\`\`sql
SELECT Id, FirstName, LastName, Email, Title, Account.Name, Account.Industry 
FROM Contact 
WHERE AccountId != null 
ORDER BY LastName ASC 
LIMIT 100
\`\`\`
**Architectural Note:** Uses standard relationship query (\`Account.Name\`) avoiding extra SOQL queries. Filtered by \`AccountId != null\` to leverage parent foreign key indexing.`
      };
    }
    if (p.includes("opportunity") || p.includes("deal") || p.includes("won")) {
      return {
        success: true,
        isLocal: true,
        content: `\`\`\`sql
SELECT Id, Name, Amount, StageName, CloseDate, Account.Name, Owner.Name 
FROM Opportunity 
WHERE IsWon = true AND CloseDate = THIS_QUARTER 
ORDER BY Amount DESC 
LIMIT 50
\`\`\`
**Architectural Note:** \`IsWon\` and \`CloseDate\` are indexed standard fields ensuring high query selectivity on Large Data Volumes (LDV).`
      };
    }
    return {
      success: true,
      isLocal: true,
      content: `\`\`\`sql
SELECT Id, Name, CreatedDate, LastModifiedDate 
FROM Account 
WHERE CreatedDate = THIS_YEAR 
ORDER BY CreatedDate DESC 
LIMIT 100
\`\`\`
**Architectural Note:** \`CreatedDate\` is a standard B-Tree indexed field.`
    };
  }

  // Formula & Validation Rules
  if (p.includes("formula") || p.includes("validation") || p.includes("rule")) {
    return {
      success: true,
      isLocal: true,
      content: `\`\`\`salesforce
AND(
  ISPICKVAL(StageName, 'Closed Won'),
  ISBLANK(PoNumber__c),
  Amount > 50000,
  NOT($Permission.Bypass_Validation_Rules)
)
\`\`\`
**Logic Breakdown:**
1. Verifies the Opportunity is transitioning to \`Closed Won\`.
2. Blocks completion if Purchase Order Number (\`PoNumber__c\`) is blank for deals over \$50,000.
3. Includes an architectural best-practice bypass via \`$Permission.Bypass_Validation_Rules\` for automated integration users.`
    };
  }

  // General Salesforce Architectural Answer
  return {
    success: true,
    isLocal: true,
    content: `**Salesforce Architect Analysis & Guidance:**

Based on your prompt, here are the recommended best practices:
1. **Bulkification:** Ensure all trigger, flow, and service layers process up to 200 records in a single batch without SOQL (limit 100) or DML (limit 150) inside loops.
2. **Security & FLS:** In Apex, declare classes as \`with sharing\` or \`inherited sharing\` and add \`WITH USER_MODE\` to SOQL queries to enforce user permissions.
3. **Agentforce Integration:** If this logic is called by an Agentforce Agent, encapsulate in an Autolaunched Flow or an Apex method annotated with \`@InvocableMethod(label='...' description='...')\` with clear action-oriented descriptions.

*(Tip: To get live responses tailored specifically to your custom org code, enter your OpenAI, Anthropic, or Gemini API key in Settings).*`
  };
}

