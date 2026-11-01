# 🛡️ Security Policy — SF Power Inspector PRO

**SF Power Inspector PRO** is an enterprise-grade developer and architect suite designed with security, privacy, and zero data retention as core pillars.

---

## 🔒 Security Architecture

1. **Client-Side Only Sandbox**:
   - The extension runs 100% locally in the browser sandbox.
   - All SOQL queries, Tooling API calls, and metadata describes execute strictly between your browser and your authoritative Salesforce domain (`*.my.salesforce.com`).
   - Salesforce session cookies (`sid`) are never stored on external databases, telemetry proxies, or logged in plain text.

2. **Web Crypto (SubtleCrypto) 256-bit AES-GCM Key Vault**:
   - User-supplied API keys for third-party AI providers (OpenAI, Anthropic Claude, Google Gemini) are encrypted at rest with hardware-backed AES-GCM encryption before storing in browser `localStorage`.
   - Keys are never dispatched to AnyTaskAI or ParrotRakhy servers.

3. **Einstein Trust Layer Dynamic PII Masking**:
   - All prompt payloads pass through an automated client-side regex scrubber that masks Social Security Numbers (SSN), credit card numbers, email addresses, and phone numbers before dispatching to LLM providers.

4. **Principle of Least Privilege**:
   - Extension permissions are strictly restricted to Salesforce domains and standard WebExtension APIs (`cookies`, `storage`, `clipboardWrite`, `notifications`, `alarms`).
   - Broad `<all_urls>` host permissions are avoided.

---

## 🚨 Reporting a Vulnerability

We welcome security researchers and community developers to report any security vulnerabilities responsibly.

If you believe you have discovered a security issue in SF Power Inspector PRO:
1. **Do not disclose the issue publicly** in GitHub issues or public forums.
2. Email the Developer & Founder directly:  
   📧 **[anythingxearn@gmail.com](mailto:anythingxearn@gmail.com)**
3. Please include:
   - Detailed description of the vulnerability.
   - Steps or proof of concept to reproduce.
   - Potential security impact.
4. We acknowledge receipt within **24 hours** and aim to deploy patches within **48–72 hours**.

---

© 2026 **ParrotRakhy** (Developer & Founder). All rights reserved.
