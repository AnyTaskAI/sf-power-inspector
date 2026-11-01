import { sfConn, apiVersion, updateNavbarOrgBadge, resolveSfHost } from "./sf-connection.js";
import { CometD } from "./lib/cometd/cometd.js";

const sfHost = resolveSfHost();
let cometd = null;
let currentSubscription = null;
let eventCount = 0;

async function init() {
  if (!sfHost) {
    alert("Salesforce host not found.");
    return;
  }

  // Pre-render immediately with cached info
  let orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  await sfConn.getSession(sfHost);

  // Re-render with live org session details
  orgInfo = JSON.parse(localStorage.getItem(sfHost + "_orgInfo") || "{}");
  updateNavbarOrgBadge(sfHost, orgInfo);

  setupEvents();
  loadCustomPlatformEvents();
}

async function loadCustomPlatformEvents() {
  try {
    const q = `SELECT QualifiedApiName, Label FROM EntityDefinition WHERE QualifiedApiName LIKE '%__e' ORDER BY Label ASC LIMIT 50`;
    const res = await sfConn.query(q);
    const select = document.getElementById("select-channel-preset");
    (res.records || []).forEach(r => {
      const opt = document.createElement("option");
      opt.value = `/event/${r.QualifiedApiName}`;
      opt.textContent = `Event: ${r.Label} (/event/${r.QualifiedApiName})`;
      select.appendChild(opt);
    });
  } catch (e) {
    console.warn("Could not load custom platform events:", e);
  }
}

function setupEvents() {
  document.getElementById("btn-subscribe").addEventListener("click", connectAndSubscribe);
  document.getElementById("btn-disconnect").addEventListener("click", disconnectCometD);

  document.getElementById("btn-clear-events").addEventListener("click", () => {
    document.getElementById("events-body").innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:#6b7280;">Listening for events...</td></tr>`;
    eventCount = 0;
    document.getElementById("event-count").textContent = 0;
  });

  document.getElementById("btn-publish-test").addEventListener("click", publishEvent);

  document.getElementById("select-channel-preset").addEventListener("change", (e) => {
    if (e.target.value !== "custom") {
      document.getElementById("event-channel").value = e.target.value;
    }
  });
}

function updateStatus(state, msg) {
  const pill = document.getElementById("stream-status-pill");
  const subBtn = document.getElementById("btn-subscribe");
  const disBtn = document.getElementById("btn-disconnect");

  if (state === "CONNECTED") {
    pill.style.background = "#dcfce7";
    pill.style.color = "#15803d";
    pill.textContent = msg || "● Connected & Listening";
    subBtn.style.display = "none";
    disBtn.style.display = "inline-flex";
  } else if (state === "CONNECTING") {
    pill.style.background = "#fef3c7";
    pill.style.color = "#b45309";
    pill.textContent = "⏳ Connecting / Handshaking...";
  } else {
    pill.style.background = "#fee2e2";
    pill.style.color = "#b91c1c";
    pill.textContent = msg || "○ Disconnected";
    subBtn.style.display = "inline-flex";
    disBtn.style.display = "none";
  }
}

function connectAndSubscribe() {
  const channel = document.getElementById("event-channel").value.trim();
  const replayId = parseInt(document.getElementById("select-replay").value, 10);

  if (!channel) {
    alert("Please provide a channel path.");
    return;
  }

  updateStatus("CONNECTING");

  try {
    cometd = new CometD();
    const cometdUrl = `https://${sfHost}/cometd/${apiVersion}`;

    cometd.configure({
      url: cometdUrl,
      requestHeaders: {
        Authorization: "Bearer " + sfConn.sessionId
      },
      appendMessageTypeToURL: false
    });
    cometd.websocketEnabled = false;

    // Register Salesforce Replay Extension
    cometd.registerExtension("SalesforceReplayExtension", {
      outgoing: function(message) {
        if (message.channel === "/meta/subscribe") {
          if (!message.ext) message.ext = {};
          const replayMap = {};
          replayMap[channel] = replayId;
          message.ext["replay"] = replayMap;
        }
      }
    });

    cometd.handshake((handshakeReply) => {
      if (handshakeReply.successful) {
        currentSubscription = cometd.subscribe(
          channel,
          (message) => {
            addEventRow(channel, message.data);
          },
          (subscribeReply) => {
            if (subscribeReply.successful) {
              updateStatus("CONNECTED", `● Listening to ${channel}`);
            } else {
              updateStatus("ERROR", `Subscription error: ${subscribeReply.error}`);
            }
          }
        );
      } else {
        updateStatus("ERROR", `Handshake failed: ${handshakeReply.error || "Verify active session"}`);
      }
    });
  } catch (err) {
    updateStatus("ERROR", err.message);
  }
}

function disconnectCometD() {
  if (cometd) {
    try {
      if (currentSubscription) {
        cometd.unsubscribe(currentSubscription);
        currentSubscription = null;
      }
      cometd.disconnect();
    } catch (e) {
      console.warn("Disconnect note:", e);
    }
  }
  updateStatus("DISCONNECTED");
}

function addEventRow(channel, data) {
  const tbody = document.getElementById("events-body");
  if (eventCount === 0) tbody.innerHTML = "";

  eventCount++;
  document.getElementById("event-count").textContent = eventCount;

  const time = new Date().toLocaleTimeString();
  const replayId = data?.event?.replayId || "—";
  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td><strong>${time}</strong></td>
    <td><code style="color:#0176d3; font-weight:700;">${channel}</code></td>
    <td><span style="font-family:var(--font-mono); font-size:11px; background:#f1f5f9; padding:2px 6px; border-radius:3px;">${replayId}</span></td>
    <td>
      <pre style="font-family: var(--font-mono); font-size: 11px; max-height:120px; overflow-y:auto; white-space:pre-wrap; word-break:break-all;">${JSON.stringify(data, null, 2)}</pre>
    </td>
  `;
  tbody.prepend(tr);
}

async function publishEvent() {
  const channel = document.getElementById("event-channel").value.trim();
  const eventName = channel.replace("/event/", "");
  const payloadStr = prompt(`Enter JSON payload to publish to ${eventName}:`, '{"Status__c": "Active", "Message__c": "Test message from SF Power Inspector"}');
  if (!payloadStr) return;

  try {
    const payload = JSON.parse(payloadStr);
    const res = await sfConn.rest(`/services/data/v${apiVersion}/sobjects/${eventName}`, {
      method: "POST",
      body: payload
    });
    alert(`✓ Event published successfully!\nRecord ID: ${res.id}`);
  } catch (e) {
    alert("❌ Publish failed: " + e.message);
  }
}

init();
