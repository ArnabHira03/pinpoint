const $ = (id) => document.getElementById(id);
const OFFLINE_FALLBACK = "Something went wrong. Try again.";

let reviews = [];
let activeReviewId = null;

const showMessage = (text) => {
  $("message").textContent = text;
};

// A sleeping server takes a while to answer, which shouldn't look like a hang.
const ask = async (request) => {
  const slowNotice = setTimeout(() => showMessage("Waking the server. This can take about a minute."), 3000);
  try {
    return await chrome.runtime.sendMessage(request);
  } finally {
    clearTimeout(slowNotice);
    showMessage("");
  }
};

const render = () => {
  const active = reviews.find((review) => review.id === activeReviewId);
  $("review").replaceChildren(
    ...reviews.map((review) => {
      const option = document.createElement("option");
      option.value = review.id;
      option.textContent = review.name;
      return option;
    })
  );
  if (active) $("review").value = active.id;
  $("review").hidden = !active;
  $("no-reviews").hidden = Boolean(active);
  // Only the owner gets a share code from the server.
  $("share").hidden = !active?.shareCode;
  $("identity").hidden = !active;
  $("identity").textContent = active ? `You comment here as ${active.displayName}. Your role: ${active.role}.` : "";
  $("code").textContent = active?.shareCode ?? "";
  $("start").disabled = !active;
  $("start").title = active ? "" : "Choose a review first";
};

const saveReviews = () => chrome.storage.local.set({ reviews, activeReviewId });

// Adds or refreshes a review from the server, then makes it the active one.
const useReview = async (review) => {
  reviews = [...reviews.filter((known) => known.id !== review.id), review];
  activeReviewId = review.id;
  await saveReviews();
  render();
};

const submitReview = async (action, field, value) => {
  const input = $(field);
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  const displayName = $("name").value.trim();
  if (!displayName) {
    showMessage("Enter your name first. It's shown on your comments in this review.");
    $("name").focus();
    return;
  }
  showMessage("");
  const result = await ask({ action, [value]: text, displayName });
  if (!result?.ok) {
    // What was typed stays in the box, ready to try again.
    showMessage(result?.message ?? OFFLINE_FALLBACK);
    return;
  }
  input.value = "";
  await useReview(result.review);
};

$("name").addEventListener("input", () => {
  chrome.storage.local.set({ displayName: $("name").value.trim() });
  render();
});

$("review").addEventListener("change", async () => {
  activeReviewId = Number($("review").value);
  await saveReviews();
  render();
});

$("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitReview("createReview", "new-name", "name");
});

$("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitReview("joinReview", "join-code", "shareCode");
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("code").textContent);
    $("copy").textContent = "Copied";
  } catch {
    showMessage("Couldn't copy. Select the code and copy it by hand.");
  }
});

$("new-code").addEventListener("click", async () => {
  showMessage("");
  const result = await ask({ action: "replaceShareCode", reviewId: activeReviewId });
  if (!result?.ok) {
    showMessage(result?.message ?? OFFLINE_FALLBACK);
    return;
  }
  $("copy").textContent = "Copy";
  await useReview(result.review);
});

$("start").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    // A repeat injection toggles comment mode, because the script keeps its state on the page.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    window.close();
  } catch {
    // Chrome blocks extensions on pages such as chrome:// and the Web Store.
    showMessage("Pinpoint can't run on this page. Try a regular website.");
  }
});

(async () => {
  const stored = await chrome.storage.local.get(["displayName", "reviews", "activeReviewId"]);
  $("name").value = stored.displayName ?? "";
  reviews = stored.reviews ?? [];
  activeReviewId = stored.activeReviewId ?? null;
  render();
})();
