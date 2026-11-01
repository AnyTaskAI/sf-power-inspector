import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockEnvironment } from "./mocks.js";

setupMockEnvironment();

const {
  saveEncryptedKey,
  getDecryptedKey,
  maskSensitiveData,
  executeAiQuery
} = await import("../addon/ai-service.js");

describe("ai-service.js Comprehensive Test Suite", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("Web Crypto Key Vault Encryption", () => {
    it("should encrypt, store, and decrypt an API key successfully", async () => {
      const originalKey = "sk-test-secret-key-1234567890abcdef";
      await saveEncryptedKey("openai", originalKey);

      const storedRaw = localStorage.getItem("sfpi_key_openai");
      assert.ok(storedRaw);
      assert.ok(!storedRaw.includes(originalKey)); // Must not be plaintext

      const decrypted = await getDecryptedKey("openai");
      assert.strictEqual(decrypted, originalKey);
    });

    it("should remove key from storage when empty or null is passed", async () => {
      await saveEncryptedKey("anthropic", "ant-secret-key");
      assert.ok(localStorage.getItem("sfpi_key_anthropic"));

      await saveEncryptedKey("anthropic", "");
      assert.strictEqual(localStorage.getItem("sfpi_key_anthropic"), null);

      const decrypted = await getDecryptedKey("anthropic");
      assert.strictEqual(decrypted, "");
    });

    it("should gracefully handle non-existent or corrupted keys", async () => {
      const origWarn = console.warn;
      try {
        console.warn = () => {};
        const missing = await getDecryptedKey("non_existent_provider");
        assert.strictEqual(missing, "");

        localStorage.setItem("sfpi_key_corrupted", "{ malformed json ");
        const corrupted = await getDecryptedKey("corrupted");
        assert.strictEqual(corrupted, "");
      } finally {
        console.warn = origWarn;
      }
    });
  });

  describe("Einstein Trust Layer Sensitive Data Masking", () => {
    it("should mask email addresses", () => {
      const text = "Contact John at john.doe@company.com for inquiries.";
      const masked = maskSensitiveData(text);
      assert.ok(!masked.includes("john.doe@company.com"));
      assert.ok(masked.includes("***"));
    });

    it("should mask phone numbers", () => {
      const text = "Call me at (555) 123-4567 or 800-555-0199.";
      const masked = maskSensitiveData(text);
      assert.ok(!masked.includes("(555) 123-4567"));
      assert.ok(masked.includes("[PHONE_MASKED]"));
    });

    it("should mask SSN and national identifiers", () => {
      const text = "Tax ID: 123-45-6789 confidential.";
      const masked = maskSensitiveData(text);
      assert.ok(!masked.includes("123-45-6789"));
      assert.ok(masked.includes("[SSN_MASKED]"));
    });

    it("should mask credit card numbers", () => {
      const text = "Payment card: 4111-2222-3333-4444 on file.";
      const masked = maskSensitiveData(text);
      assert.ok(!masked.includes("4111-2222-3333-4444"));
      assert.ok(masked.includes("[CREDIT_CARD_MASKED]"));
    });

    it("should redact currency values when strict mode is active", () => {
      const text = "Expected total revenue: $ 150,000.00 for Q4.";
      const unmasked = maskSensitiveData(text, false);
      assert.ok(unmasked.includes("$ 150,000.00"));

      const strictMasked = maskSensitiveData(text, true);
      assert.ok(!strictMasked.includes("$ 150,000.00"));
      assert.ok(strictMasked.includes("[CURRENCY_REDACTED]"));
    });

    it("should handle null, undefined, and non-string inputs safely", () => {
      assert.strictEqual(maskSensitiveData(null), null);
      assert.strictEqual(maskSensitiveData(undefined), undefined);
      assert.strictEqual(maskSensitiveData(12345), 12345);
    });
  });

  describe("Multi-Provider AI Execution Engine", () => {
    it("should generate local SOQL query recommendations for Contacts & Accounts", async () => {
      const res = await executeAiQuery({
        prompt: "Show me soql query for contacts and accounts",
        provider: "local"
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.isLocal, true);
      assert.ok(res.content.includes("Contact"));
      assert.ok(res.content.includes("Account.Name"));
    });

    it("should generate local SOQL query recommendations for Opportunities", async () => {
      const res = await executeAiQuery({
        prompt: "Find all won opportunities",
        provider: "local"
      });
      assert.strictEqual(res.success, true);
      assert.ok(res.content.includes("Opportunity"));
      assert.ok(res.content.includes("IsWon = true"));
    });

    it("should generate local validation rule formulas", async () => {
      const res = await executeAiQuery({
        prompt: "Create a validation rule formula for closed deals",
        provider: "local"
      });
      assert.strictEqual(res.success, true);
      assert.ok(res.content.includes("ISPICKVAL"));
      assert.ok(res.content.includes("Closed Won"));
    });

    it("should generate general architecture guidance when no specific pattern matches", async () => {
      const res = await executeAiQuery({
        prompt: "How to architect high performance integration in Salesforce?",
        provider: "local"
      });
      assert.strictEqual(res.success, true);
      assert.ok(res.content.includes("Salesforce Architect Analysis & Guidance"));
    });

    it("should return helpful error message if provider is chosen without API key", async () => {
      const res = await executeAiQuery({
        prompt: "Write a batch apex class",
        provider: "openai"
      });
      assert.strictEqual(res.success, false);
      assert.ok(res.error.includes("No API key configured"));
      assert.ok(res.content); // Provides fallback content
    });

    it("should call OpenAI provider when API key is present", async () => {
      await saveEncryptedKey("openai", "sk-mock-valid-key");
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url, opts) => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "Mock OpenAI response: public class AccountService {}" } }]
          })
        });

        const res = await executeAiQuery({
          prompt: "Write Apex class",
          provider: "openai"
        });
        assert.strictEqual(res.success, true);
        assert.ok(res.content.includes("AccountService"));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("should call Anthropic provider when API key is present", async () => {
      await saveEncryptedKey("anthropic", "ant-mock-valid-key");
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url, opts) => ({
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ text: "Mock Anthropic response: TriggerHandler framework" }]
          })
        });

        const res = await executeAiQuery({
          prompt: "Suggest trigger framework",
          provider: "anthropic"
        });
        assert.strictEqual(res.success, true);
        assert.ok(res.content.includes("TriggerHandler"));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("should call Gemini provider when API key is present", async () => {
      await saveEncryptedKey("gemini", "gemini-mock-valid-key");
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url, opts) => ({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Mock Gemini response: Lightning Web Component" }] } }]
          })
        });

        const res = await executeAiQuery({
          prompt: "Create LWC component",
          provider: "gemini"
        });
        assert.strictEqual(res.success, true);
        assert.ok(res.content.includes("Lightning Web Component"));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("should call Ollama provider for local LLMs", async () => {
      await saveEncryptedKey("ollama", "local-ollama");
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url, opts) => ({
          ok: true,
          status: 200,
          json: async () => ({ response: "Mock Ollama response: Llama 3.2 output" })
        });

        const res = await executeAiQuery({
          prompt: "Test Ollama",
          provider: "ollama"
        });
        assert.strictEqual(res.success, true);
        assert.ok(res.content.includes("Llama 3.2"));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("should generate local SOQL query recommendations for Accounts", async () => {
      const res = await executeAiQuery({
        prompt: "Show me soql query for account records created this year",
        provider: "local"
      });
      assert.strictEqual(res.success, true);
      assert.ok(res.content.includes("Account"));
      assert.ok(res.content.includes("CreatedDate"));
    });

    it("should handle provider API HTTP errors gracefully", async () => {
      await saveEncryptedKey("openai", "sk-mock-error-key");
      const origFetch = globalThis.fetch;
      const origError = console.error;
      try {
        console.error = () => {};
        globalThis.fetch = async () => ({
          ok: false,
          status: 429,
          text: async () => "Rate limit exceeded"
        });

        const res = await executeAiQuery({
          prompt: "Write Apex class",
          provider: "openai"
        });
        assert.strictEqual(res.success, false);
        assert.ok(res.error.includes("429"));
      } finally {
        globalThis.fetch = origFetch;
        console.error = origError;
      }
    });
  });
});
