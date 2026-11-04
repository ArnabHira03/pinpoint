const API = "http://localhost:8000/api";
const TIMEOUT_MS = 10000;
const OFFLINE = "Can't reach the server at localhost:8000. Start the backend, then try again. Nothing was lost.";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COMMENT_GONE = "That comment no longer exists. The list has been refreshed.";
const REVIEW_GONE = "This review no longer exists. Open the Pinpoint icon and choose another.";
const BAD_CODE = "No review has that share code. Check it and try again.";
const NEEDS_SETUP = "Open the Pinpoint icon, enter your name, and choose a review first.";

const MESSAGES = {
  404: COMMENT_GONE,
  422: "The server couldn't accept this. Comments can't be saved on this kind of page or element.",
};

const request = async (path, { method = "GET", body } = {}) => {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  if (!response.ok) {
    throw new ApiError(response.status, MESSAGES[response.status] ?? "The server had a problem. Try again.");
  }
  return response.status === 204 ? null : response.json();
};

// Reviews joined in this browser, kept with the display name. The popup chooses the active one.
const currentSetup = async () => {
  const { reviews = [], activeReviewId, displayName = "" } = await chrome.storage.local.get([
    "reviews",
    "activeReviewId",
    "displayName",
  ]);
  const review = reviews.find((known) => known.id === activeReviewId);
  if (!review) throw new ApiError(409, NEEDS_SETUP);
  return { review, displayName };
};

const withReviewMessage = async (call) => {
  try {
    return await call();
  } catch (error) {
    if (error.status === 404) throw new ApiError(404, REVIEW_GONE);
    throw error;
  }
};

const toReview = (review) => ({ id: review.id, name: review.name, shareCode: review.share_code });

const toPin = (comment) => ({
  id: comment.id,
  number: comment.number,
  authorName: comment.author_name,
  selector: comment.selector,
  offsetX: comment.offset_x,
  offsetY: comment.offset_y,
  textSnippet: comment.text_snippet,
  comment: comment.comment,
});

// Fixed lists of actions: callers can't send arbitrary requests to the API.
const PAGE_ACTIONS = {
  async listComments({ url }) {
    const { review } = await currentSetup();
    const query = new URLSearchParams({ url });
    const comments = await withReviewMessage(() => request(`/reviews/${review.id}/comments?${query}`));
    return { pins: comments.map(toPin), reviewName: review.name };
  },
  async createComment({ url, anchor, comment }) {
    const { review, displayName } = await currentSetup();
    if (!displayName) throw new ApiError(409, NEEDS_SETUP);
    const created = await withReviewMessage(() =>
      request(`/reviews/${review.id}/comments`, {
        method: "POST",
        body: {
          url,
          author_name: displayName,
          selector: anchor.selector,
          offset_x: anchor.offsetX,
          offset_y: anchor.offsetY,
          text_snippet: anchor.textSnippet,
          comment,
        },
      })
    );
    return { pin: toPin(created) };
  },
  async updateComment({ id, comment }) {
    const updated = await request(`/comments/${Number(id)}`, { method: "PATCH", body: { comment } });
    return { pin: toPin(updated) };
  },
  async deleteComment({ id }) {
    await request(`/comments/${Number(id)}`, { method: "DELETE" });
    return {};
  },
};

// Only the extension's own popup can create or join reviews, never a script on a website.
const POPUP_ACTIONS = {
  async createReview({ name }) {
    return { review: toReview(await request("/reviews", { method: "POST", body: { name } })) };
  },
  async joinReview({ shareCode }) {
    try {
      const review = await request("/reviews/join", { method: "POST", body: { share_code: shareCode } });
      return { review: toReview(review) };
    } catch (error) {
      if (error.status === 404 || error.status === 422) throw new ApiError(error.status, BAD_CODE);
      throw error;
    }
  },
};

const handle = async (message, actions) => {
  if (!Object.hasOwn(actions, message?.action)) {
    return { ok: false, status: 400, message: "Unknown request." };
  }
  try {
    return { ok: true, ...(await actions[message.action](message)) };
  } catch (error) {
    return { ok: false, status: error.status ?? 0, message: error.message };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  // Content scripts report the website's URL; extension pages report their own.
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL(""));
  handle(message, fromExtensionPage ? POPUP_ACTIONS : PAGE_ACTIONS).then(sendResponse);
  return true; // The response arrives after the network call.
});
