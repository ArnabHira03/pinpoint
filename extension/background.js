const API = "https://pinpoint-fv8n.onrender.com/api";
// A hosted server asleep on its free plan takes about a minute to wake.
const TIMEOUT_MS = 90000;
const OFFLINE = "Can't reach the server. Check your connection and try again. Nothing was lost.";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COMMENT_GONE = "That comment no longer exists. The list has been refreshed.";
const REVIEW_GONE = "This review no longer exists. Open the Pinpoint icon and choose another.";
const BAD_CODE = "No review has that share code. Check it and try again.";
const NEEDS_SETUP = "Open the Pinpoint icon and choose a review first.";
const NO_ACCESS = "You no longer have access to this review. Ask its owner for the share code and join again.";
const NOT_ALLOWED = "You don't have permission to do that. People can change only their own comments.";

const MESSAGES = {
  401: NO_ACCESS,
  403: NOT_ALLOWED,
  404: COMMENT_GONE,
  422: "The server couldn't accept this. Comments can't be saved on this kind of page or element.",
};

const request = async (path, { method = "GET", body, key } = {}) => {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
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
  const { reviews = [], activeReviewId, memberKeys = {} } = await chrome.storage.local.get([
    "reviews",
    "activeReviewId",
    "memberKeys",
  ]);
  const review = reviews.find((known) => known.id === activeReviewId);
  const key = memberKeys[activeReviewId];
  if (!review || !key) throw new ApiError(409, NEEDS_SETUP);
  return { review, key };
};

const keyFor = async (reviewId) => {
  const { memberKeys = {} } = await chrome.storage.local.get("memberKeys");
  return memberKeys[reviewId];
};

// Keys are written only here and never returned to the popup or the page.
const saveKey = async (reviewId, key) => {
  const { memberKeys = {} } = await chrome.storage.local.get("memberKeys");
  await chrome.storage.local.set({ memberKeys: { ...memberKeys, [reviewId]: key } });
};

const withReviewMessage = async (call) => {
  try {
    return await call();
  } catch (error) {
    if (error.status === 404) throw new ApiError(404, REVIEW_GONE);
    throw error;
  }
};

const toReview = (review) => ({
  id: review.id,
  name: review.name,
  role: review.role,
  displayName: review.display_name,
  shareCode: review.share_code,
});

const toOtherPage = (page) => ({ url: page.url, commentCount: page.comment_count });

const toPin = (comment) => ({
  id: comment.id,
  number: comment.number,
  authorName: comment.author_name,
  selector: comment.selector,
  offsetX: comment.offset_x,
  offsetY: comment.offset_y,
  textSnippet: comment.text_snippet,
  comment: comment.comment,
  canEdit: comment.can_edit,
  canDelete: comment.can_delete,
});

// Fixed lists of actions: callers can't send arbitrary requests to the API.
const PAGE_ACTIONS = {
  async listComments({ url }) {
    const { review, key } = await currentSetup();
    const query = new URLSearchParams({ url });
    const [comments, pages] = await withReviewMessage(() =>
      Promise.all([request(`/reviews/${review.id}/comments?${query}`, { key }), request(`/reviews/${review.id}/pages`, { key })])
    );
    return {
      pins: comments.map(toPin),
      otherPages: pages.filter((page) => page.url !== url).map(toOtherPage),
      reviewName: review.name,
    };
  },
  async createComment({ url, anchor, comment }) {
    const { review, key } = await currentSetup();
    const created = await withReviewMessage(() =>
      request(`/reviews/${review.id}/comments`, {
        method: "POST",
        key,
        body: {
          url,
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
    const { key } = await currentSetup();
    const updated = await request(`/comments/${Number(id)}`, { method: "PATCH", key, body: { comment } });
    return { pin: toPin(updated) };
  },
  async deleteComment({ id }) {
    const { key } = await currentSetup();
    await request(`/comments/${Number(id)}`, { method: "DELETE", key });
    return {};
  },
};

// Only the extension's own popup can create or join reviews, never a script on a website.
const POPUP_ACTIONS = {
  async createReview({ name, displayName }) {
    const review = await request("/reviews", { method: "POST", body: { name, display_name: displayName } });
    await saveKey(review.id, review.member_key);
    return { review: toReview(review) };
  },
  async joinReview({ shareCode, displayName }) {
    let joined;
    try {
      joined = await request("/reviews/join", {
        method: "POST",
        body: { share_code: shareCode, display_name: displayName },
      });
    } catch (error) {
      if (error.status === 404 || error.status === 422) throw new ApiError(error.status, BAD_CODE);
      throw error;
    }
    // Already in this review: keep the old key, which owns this person's comments and role.
    const existingKey = await keyFor(joined.id);
    if (existingKey) {
      try {
        return { review: toReview(await request(`/reviews/${joined.id}`, { key: existingKey })) };
      } catch (error) {
        if (error.status !== 401 && error.status !== 404) throw error;
        // The old key stopped working, so the new one takes its place.
      }
    }
    await saveKey(joined.id, joined.member_key);
    return { review: toReview(joined) };
  },
  async replaceShareCode({ reviewId }) {
    const key = await keyFor(reviewId);
    if (!key) throw new ApiError(409, NEEDS_SETUP);
    const review = await request(`/reviews/${Number(reviewId)}/share-code`, { method: "POST", key });
    return { review: toReview(review) };
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
