import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupMockEnvironment } from "./mocks.js";

setupMockEnvironment();

const {
  getOrCreateInstallId,
  getTelemetryStats,
  recordHeartbeat,
  recordInstallEvent,
  recordSubscription,
  getSubscriptionStatus,
  isExperienceDue,
  recordExperienceFeedback,
  enableExperiencePreviewMode,
  getUserRequirements,
  submitUserRequirement,
  upvoteRequirement,
  isRunningInExtension
} = await import("../addon/telemetry-service.js");

describe("telemetry-service.js Comprehensive Test Suite", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("Anonymous Device Identification & Live Counters", () => {
    it("should generate and persist unique install ID without PII", () => {
      const id1 = getOrCreateInstallId();
      assert.ok(id1.startsWith("sfpi_"));

      const id2 = getOrCreateInstallId();
      assert.strictEqual(id1, id2);
    });

    it("should compute realistic live active users and total installs", () => {
      const stats = getTelemetryStats();
      assert.ok(stats.totalInstalls >= 15280);
      assert.ok(stats.liveActiveUsers >= 100);
      assert.ok(stats.lastHeartbeat > 0);
      assert.ok(stats.totalQueriesExecuted > 2000000);
    });

    it("should update query count and timestamp on heartbeat", () => {
      const initial = getTelemetryStats();
      const updated = recordHeartbeat();
      assert.strictEqual(updated.totalQueriesExecuted, initial.totalQueriesExecuted + 1);
    });

    it("should record install event and trigger 2-hour post-install alarm", () => {
      let alarmCreated = null;
      globalThis.chrome.alarms = {
        create: (name, options) => {
          alarmCreated = { name, options };
        }
      };

      const result = recordInstallEvent();
      assert.ok(result.installId);
      assert.ok(localStorage.getItem("sfpi_install_time"));
      assert.strictEqual(alarmCreated.name, "sfpi_post_install_experience_2h");
      assert.strictEqual(alarmCreated.options.delayInMinutes, 120);
    });
  });

  describe("Subscription Engine (Both Ways: With Login & Without Login)", () => {
    it("should allow subscription without login using an email", () => {
      const res = recordSubscription({
        method: "without_login",
        email: "architect@example.com"
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.message.includes("No login required"));
      assert.strictEqual(res.subscription.method, "without_login");
      assert.strictEqual(res.subscription.email, "architect@example.com");
      assert.strictEqual(res.subscription.loginMandatory, false);
    });

    it("should allow 100% anonymous subscription without email or login", () => {
      const res = recordSubscription({
        method: "without_login",
        email: ""
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.message.includes("Subscribed anonymously"));
      assert.strictEqual(res.subscription.loginMandatory, false);
    });

    it("should allow subscription with Salesforce login identity", () => {
      const res = recordSubscription({
        method: "with_login",
        email: "cta@salesforce-org.com",
        orgMetadata: {
          orgName: "Acme Global Org",
          edition: "Developer Edition",
          isSandbox: false
        }
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.subscription.method, "with_login");
      assert.strictEqual(res.subscription.orgMetadata.orgName, "Acme Global Org");
      assert.strictEqual(res.subscription.loginMandatory, false);
    });

    it("should return correct status when checking subscription", () => {
      const initial = getSubscriptionStatus();
      assert.strictEqual(initial.subscribed, false);
      assert.strictEqual(initial.loginMandatory, false);

      recordSubscription({ method: "without_login", email: "dev@company.com" });
      const active = getSubscriptionStatus();
      assert.strictEqual(active.subscribed, true);
      assert.strictEqual(active.email, "dev@company.com");

      // Corrupted JSON storage check
      localStorage.setItem("sfpi_subscription", "not-json");
      const fallback = getSubscriptionStatus();
      assert.strictEqual(fallback.subscribed, false);
    });
  });

  describe("2-Hour Post-Installation Experience Evaluator", () => {
    it("should not be due immediately after installation", () => {
      const now = Date.now();
      localStorage.setItem("sfpi_install_time", now.toString());
      assert.strictEqual(isExperienceDue(), false);
    });

    it("should become due after 2 hours (120 minutes) have elapsed", () => {
      const twoHoursOneMinAgo = Date.now() - (121 * 60 * 1000);
      localStorage.setItem("sfpi_install_time", twoHoursOneMinAgo.toString());
      assert.strictEqual(isExperienceDue(), true);
    });

    it("should support instant preview mode for review & testing", () => {
      const now = Date.now();
      localStorage.setItem("sfpi_install_time", now.toString());
      assert.strictEqual(isExperienceDue(), false);

      enableExperiencePreviewMode();
      assert.strictEqual(isExperienceDue(), true);
    });

    it("should record experience feedback and mark milestone as completed", () => {
      enableExperiencePreviewMode();
      assert.strictEqual(isExperienceDue(), true);

      const res = recordExperienceFeedback({
        rating: 5,
        likedFeatures: ["incognito", "storage_cleaner", "ai_assistant"],
        feedbackText: "Super fast storage cleaning and incognito impersonation!",
        wantsSubscription: true,
        email: "pro@company.com"
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record.rating, 5);
      assert.strictEqual(localStorage.getItem("sfpi_experience_completed"), "true");

      // Once completed, it should no longer be due
      assert.strictEqual(isExperienceDue(), false);

      // Verify auto-subscription on review feedback
      const sub = getSubscriptionStatus();
      assert.strictEqual(sub.subscribed, true);
      assert.strictEqual(sub.email, "pro@company.com");
    });
  });

  describe("User Requirements & Community Roadmap Engine", () => {
    it("should return default community requirements ordered by votes", () => {
      const reqs = getUserRequirements();
      assert.ok(reqs.length >= 4);
      assert.ok(reqs[0].votes >= reqs[1].votes);
      assert.ok(reqs[0].title);
      assert.ok(reqs[0].category);
    });

    it("should allow users to submit a new requirement without login", () => {
      const res = submitUserRequirement({
        title: "Export SOQL Plan to JSON Graph",
        description: "Allow exporting the raw execution plan to visual diagram.",
        category: "Schema & SOQL",
        priority: "High",
        email: "dev@company.com"
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.requirement.title, "Export SOQL Plan to JSON Graph");
      assert.strictEqual(res.requirement.author, "dev");

      // Verify requirement appears in list
      const list = getUserRequirements();
      const found = list.find(r => r.id === res.requirement.id);
      assert.ok(found);
      assert.strictEqual(found.title, "Export SOQL Plan to JSON Graph");
    });

    it("should reject requirement submission if title is empty or missing", () => {
      assert.throws(() => {
        submitUserRequirement({ title: "" });
      }, /Requirement title is mandatory/);

      assert.throws(() => {
        submitUserRequirement({});
      }, /Requirement title is mandatory/);
    });

    it("should allow upvoting requirements and prevent duplicate upvotes", () => {
      const initialReqs = getUserRequirements();
      const target = initialReqs[0];
      const initialVotes = target.votes;

      const upvoteRes = upvoteRequirement(target.id);
      assert.strictEqual(upvoteRes.success, true);

      // Attempt duplicate upvote
      const duplicateRes = upvoteRequirement(target.id);
      assert.strictEqual(duplicateRes.success, false);
      assert.strictEqual(duplicateRes.alreadyVoted, true);

      // Test null requirement upvote
      const nullRes = upvoteRequirement(null);
      assert.strictEqual(nullRes.success, false);
    });

    it("should detect whether running in extension context", () => {
      const inExt = isRunningInExtension();
      assert.strictEqual(inExt, true);
    });
  });

  describe("Service Worker Resilience (When localStorage is undefined)", () => {
    it("should execute recordInstallEvent without throwing ReferenceError when localStorage is undefined", () => {
      const origLocalStorage = globalThis.localStorage;
      try {
        // Temporarily delete or hide localStorage to simulate MV3 Service Worker
        delete globalThis.localStorage;

        const res = recordInstallEvent();
        assert.ok(res.installId);
        assert.ok(res.installTime > 0);

        const stats = getTelemetryStats();
        assert.ok(stats.totalInstalls >= 15280);

        const sub = recordSubscription({ email: "sw-tester@example.com" });
        assert.strictEqual(sub.success, true);
        assert.strictEqual(sub.subscription.email, "sw-tester@example.com");

        const status = getSubscriptionStatus();
        assert.strictEqual(status.subscribed, true);

        const due = isExperienceDue();
        assert.strictEqual(typeof due, "boolean");
      } finally {
        globalThis.localStorage = origLocalStorage;
      }
    });
  });
});

