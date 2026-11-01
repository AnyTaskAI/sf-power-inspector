/**
 * SF Power Inspector PRO — 2-Hour Experience & Review Script
 */

import { recordExperienceFeedback } from "./telemetry-service.js";
import { syncTheme } from "./sf-connection.js";

syncTheme();

// ─── 1. Elapsed Time Calculation ─────────────────────────────────────
const elapsedBadge = document.getElementById("install-elapsed-badge");
const installTime = parseInt(localStorage.getItem("sfpi_install_time") || "0", 10);
const now = Date.now();

if (installTime) {
  const elapsedMs = Math.max(0, now - installTime);
  const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
  const mins = Math.floor((elapsedMs % (60 * 60 * 1000)) / (60 * 1000));

  if (elapsedBadge) {
    elapsedBadge.textContent = hours >= 2
      ? `⏱️ Installed ${hours}h ${mins}m ago`
      : `⏱️ Installed ${hours}h ${mins}m ago (Evaluation Preview)`;
  }
} else {
  if (elapsedBadge) elapsedBadge.textContent = "⏱️ Installed recently (Preview Mode)";
}

// ─── 2. Interactive Star Rating ──────────────────────────────────────
let selectedRating = 5;
const stars = document.querySelectorAll(".star");
const ratingLabel = document.getElementById("rating-label");

const ratingTexts = {
  1: "1 Star — Needs Improvement",
  2: "2 Stars — Fair",
  3: "3 Stars — Good",
  4: "4 Stars — Very Good",
  5: "5 Stars — Outstanding (CTA Architect Grade)!"
};

function setRating(rating) {
  selectedRating = rating;
  stars.forEach((s) => {
    const starVal = parseInt(s.dataset.rating, 10);
    if (starVal <= rating) {
      s.classList.add("active");
    } else {
      s.classList.remove("active");
    }
  });
  if (ratingLabel) ratingLabel.textContent = ratingTexts[rating] || `${rating} Stars`;
}

// Default to 5 stars
setRating(5);

stars.forEach((star) => {
  star.addEventListener("click", () => {
    const val = parseInt(star.dataset.rating, 10);
    setRating(val);
  });
  star.addEventListener("mouseenter", () => {
    const val = parseInt(star.dataset.rating, 10);
    stars.forEach((s) => {
      const starVal = parseInt(s.dataset.rating, 10);
      s.style.color = starVal <= val ? "#fbbf24" : "#475569";
    });
  });
  star.addEventListener("mouseleave", () => {
    stars.forEach((s) => {
      s.style.color = "";
    });
  });
});

// ─── 3. Submit Review & Record Experience ────────────────────────────
document.getElementById("btn-submit-review")?.addEventListener("click", () => {
  const checkedFeatures = Array.from(document.querySelectorAll('input[name="feat"]:checked')).map(el => el.value);
  const feedbackText = document.getElementById("feedback-text")?.value || "";
  const wantsSub = document.getElementById("chk-subscribe-feedback")?.checked || false;
  const email = document.getElementById("feedback-email")?.value || "";

  recordExperienceFeedback({
    rating: selectedRating,
    likedFeatures: checkedFeatures,
    feedbackText,
    wantsSubscription: wantsSub,
    email
  });

  const reviewCard = document.getElementById("review-card");
  const successCard = document.getElementById("success-card");

  if (reviewCard) reviewCard.style.display = "none";
  if (successCard) successCard.style.display = "block";
});

