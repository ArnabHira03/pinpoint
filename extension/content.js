(() => {
  // Already injected on this page: the icon click means "toggle".
  if (window.__pinpointToggle) {
    window.__pinpointToggle();
    return;
  }

  const STYLES = `
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .catcher { position: fixed; inset: 0; z-index: 1; cursor: crosshair; background: transparent; }
    .bar {
      position: fixed; top: 12px; left: 50%; z-index: 3; transform: translateX(-50%);
      padding: 6px 12px; border-radius: 6px; background: #1f2937; color: #fff;
      font-size: 13px; line-height: 1.4; white-space: nowrap; pointer-events: none;
    }
    .pin {
      position: absolute; z-index: 2; width: 26px; height: 26px; margin: -13px 0 0 -13px;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; border-radius: 50%; background: #dc2626; color: #fff;
      font-size: 12px; font-weight: 700; line-height: 1; cursor: pointer;
      box-shadow: 0 1px 4px rgba(0, 0, 0, .5);
    }
    .pin.moved { background: #b45309; }
    .pin.selected { background: #1d4ed8; outline: 3px solid #93c5fd; }
    .editor {
      position: absolute; z-index: 4; width: 280px; padding: 10px; border: 1px solid #d1d5db;
      border-radius: 8px; background: #fff; color: #111827;
      box-shadow: 0 4px 16px rgba(0, 0, 0, .3);
    }
    textarea {
      display: block; width: 100%; height: 80px; padding: 6px; resize: vertical;
      border: 1px solid #9ca3af; border-radius: 4px; background: #fff; color: #111827;
      font-size: 13px; line-height: 1.4;
    }
    .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    button {
      padding: 4px 10px; border: 1px solid #9ca3af; border-radius: 4px;
      background: #fff; color: #111827; font-size: 13px; cursor: pointer;
    }
    button.save, button.danger { border-color: #dc2626; background: #dc2626; color: #fff; }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 3; width: 300px;
      display: flex; flex-direction: column; border-left: 1px solid #d1d5db;
      background: #fff; color: #111827; box-shadow: -2px 0 12px rgba(0, 0, 0, .2);
    }
    .panel.collapsed { bottom: auto; width: auto; border: 1px solid #d1d5db; border-radius: 0 0 0 8px; }
    .panel.collapsed .list { display: none; }
    .head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600;
    }
    .panel.collapsed .head { border-bottom: 0; }
    .panel.collapsed .error { max-width: 300px; }
    .list { flex: 1; overflow-y: auto; overscroll-behavior: contain; }
    .empty { padding: 16px 12px; color: #4b5563; font-size: 13px; line-height: 1.4; }
    .error { padding: 8px 12px; background: #fee2e2; color: #991b1b; font-size: 13px; line-height: 1.4; }
    .error button { display: block; margin-top: 6px; }
    .row { display: block; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; cursor: pointer; }
    .row:hover { background: #f3f4f6; }
    .row.selected { background: #dbeafe; }
    .number { margin-right: 6px; color: #dc2626; font-size: 13px; font-weight: 700; }
    .author { font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
    .review { margin-top: 2px; color: #4b5563; font-size: 12px; font-weight: 400; overflow-wrap: anywhere; }
    .text { display: block; margin-top: 4px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
    .pages { padding: 10px 12px; font-size: 12px; line-height: 1.4; }
    .pages-title { margin-bottom: 4px; color: #4b5563; font-weight: 600; }
    .page-link { display: block; padding: 2px 0; color: #1d4ed8; overflow-wrap: anywhere; }
    .note { margin-top: 6px; color: #92400e; font-size: 12px; line-height: 1.4; }
  `;

  const EDITOR_WIDTH = 280;
  const EDITOR_HEIGHT = 170;
  const EDGE_GAP = 8;
  const SNIPPET_LENGTH = 80;
  const COMMENT_LIMIT = 2000;
  const NOTES = {
    moved: "May have moved: this part of the page changed.",
    hidden: "Not visible right now, possibly because of the window size.",
    detached: "Detached: this part of the page is gone.",
  };

  const emptyPage = () => ({ pins: [] });
  // Query strings and hashes are left out: they can hold tokens and tracking data.
  const REFRESH_MS = 5000;
  const pageKey = () => `${location.origin}${location.pathname}`;

  let key = null;
  let page = emptyPage();
  let active = false;
  let draft = null;
  let selected = null;
  let editing = null;
  let editingText = "";
  let loadFailed = false;
  let reviewName = "";
  let confirmingDelete = null;
  let collapsed = false;
  let errorMessage = "";
  let otherPages = [];
  // For telling whether a refresh started before something else changed the list.
  let apiCalls = 0;
  let apiCallsRunning = 0;
  let refreshing = false;
  // Pin number -> { pin, target, status }, worked out from the live page.
  let located = new Map();
  const pinNodes = new Map();

  // Reloading the extension leaves its old overlay behind on open pages.
  document.querySelectorAll("pinpoint-root").forEach((old) => old.remove());

  // A custom tag avoids page rules aimed at div, and !important beats the rest.
  // Style properties and adopted sheets are also allowed by strict page CSPs.
  const host = document.createElement("pinpoint-root");
  for (const [name, value] of Object.entries({
    all: "initial",
    display: "block",
    position: "absolute",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    "z-index": "2147483647",
  })) {
    host.style.setProperty(name, value, "important");
  }
  const root = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLES);
  root.adoptedStyleSheets = [sheet];

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const button = (label, className, onClick) => {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return node;
  };

  // Stop clicks and typing reaching the page, so site shortcuts don't fire.
  const shield = (node) => {
    for (const type of ["click", "mousedown", "mouseup", "keydown", "keypress", "keyup"]) {
      node.addEventListener(type, (event) => event.stopPropagation());
    }
  };

  // Everything clicked in comment mode lands here, so the page never sees it.
  const catcher = el("div", "catcher");
  const bar = el("div", "bar", "Comment mode: click to add a pin. Esc to exit.");
  const pinLayer = el("div");
  const panel = el("div", "panel");
  shield(panel);
  catcher.addEventListener("click", (event) => {
    event.stopPropagation();
    selected = null;
    render();
    openDraft(event.clientX, event.clientY);
  });

  // All server calls go through the service worker. On failure the caller leaves
  // its comment box open, so nothing typed is lost.
  const api = async (request) => {
    let result;
    apiCalls += 1;
    apiCallsRunning += 1;
    // A sleeping server takes a while to answer, which shouldn't look like a hang.
    const slowNotice = setTimeout(() => {
      errorMessage = "Waking the server. This can take about a minute.";
      renderPanel();
    }, 3000);
    try {
      result = await chrome.runtime.sendMessage(request);
    } catch {
      errorMessage = "Pinpoint was updated. Reload the page and try again.";
      render();
      return null;
    } finally {
      apiCallsRunning -= 1;
      clearTimeout(slowNotice);
    }
    if (result?.ok) {
      errorMessage = "";
      return result;
    }
    if (result?.status === 404 && ["updateComment", "deleteComment"].includes(request.action)) {
      // Someone else removed it, so this list is out of date.
      await load();
    }
    errorMessage = result?.message ?? "Something went wrong. Try again.";
    render();
    return null;
  };

  const select = (number, { scrollToPin = false } = {}) => {
    selected = number;
    render();
    if (scrollToPin) {
      // Bring the element into view first, in case it sits in a scrolling panel.
      located.get(number)?.target?.scrollIntoView({ block: "nearest" });
      positionPins();
      pinLayer.querySelector(`[data-number="${number}"]`)?.scrollIntoView({ block: "center" });
    } else {
      panel.querySelector(`[data-number="${number}"]`)?.scrollIntoView({ block: "nearest" });
    }
  };

  const makePin = (x, y, label) => {
    const pin = el("div", "pin", label);
    pin.style.left = `${x}px`;
    pin.style.top = `${y}px`;
    return pin;
  };

  const clamp = (value) => Math.min(1, Math.max(0, value));

  const snippetOf = (node) =>
    (node.textContent || node.getAttribute("alt") || node.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SNIPPET_LENGTH);

  // Skips ids that look generated, since those change between page loads.
  const hasStableId = (node) =>
    node.id &&
    !/\d{3,}|:/.test(node.id) &&
    document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1;

  const selectorFor = (target) => {
    const parts = [];
    let node = target;
    while (node.parentElement) {
      if (hasStableId(node)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        return parts.join(" > ");
      }
      const tag = CSS.escape(node.localName);
      if (node.localName === "body") {
        parts.unshift(tag);
      } else {
        const sameTag = [...node.parentElement.children].filter((c) => c.localName === node.localName);
        parts.unshift(`${tag}:nth-of-type(${sameTag.indexOf(node) + 1})`);
      }
      node = node.parentElement;
    }
    return parts.join(" > ") || "html";
  };

  // The page element under the click, looking through our own overlay.
  const anchorAt = (clientX, clientY) => {
    const target = document.elementsFromPoint(clientX, clientY).find((node) => node !== host);
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      selector: selectorFor(target),
      // Whole-pixel clicks can land just outside an element's fractional edges.
      offsetX: rect.width ? clamp((clientX - rect.left) / rect.width) : 0,
      offsetY: rect.height ? clamp((clientY - rect.top) / rect.height) : 0,
      textSnippet: snippetOf(target),
    };
  };

  const locate = (pin) => {
    let target = null;
    try {
      target = document.querySelector(pin.selector);
    } catch {
      // An unusable selector is treated the same as a missing element.
    }
    if (!target) return { pin, target: null, status: "detached" };
    const rect = target.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && target.checkVisibility({ visibilityProperty: true });
    if (!visible) return { pin, target, status: "hidden" };
    return { pin, target, status: snippetOf(target) === pin.textSnippet ? "ok" : "moved" };
  };

  const locateAll = () => {
    located = new Map(page.pins.map((pin) => [pin.number, locate(pin)]));
  };

  const positionPins = () => {
    const origin = host.getBoundingClientRect();
    for (const [number, node] of pinNodes) {
      const { pin, target } = located.get(number);
      const rect = target.getBoundingClientRect();
      node.style.left = `${rect.left + pin.offsetX * rect.width - origin.left}px`;
      node.style.top = `${rect.top + pin.offsetY * rect.height - origin.top}px`;
    }
  };

  const renderPins = () => {
    locateAll();
    pinNodes.clear();
    pinLayer.replaceChildren();
    for (const { pin, status } of located.values()) {
      // No pin at all is better than one placed somewhere misleading.
      if (status === "hidden" || status === "detached") continue;
      const { number, comment } = pin;
      const node = makePin(0, 0, String(number));
      node.dataset.number = number;
      node.title = status === "moved" ? `${NOTES.moved}\n${comment}` : comment;
      if (status === "moved") node.classList.add("moved");
      if (number === selected) node.classList.add("selected");
      // Pins never pass clicks to the page, even outside comment mode.
      node.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!active) await setActive(true);
        select(number);
      });
      pinNodes.set(number, node);
      pinLayer.append(node);
    }
    positionPins();
  };

  const saveEdit = async (number) => {
    const comment = editingText.trim();
    if (!comment) return;
    const { id } = page.pins.find((pin) => pin.number === number);
    const result = await api({ action: "updateComment", id, comment });
    if (result) {
      page.pins = page.pins.map((pin) => (pin.number === number ? result.pin : pin));
      editing = null;
      render();
    }
  };

  const deletePin = async (number) => {
    const { id } = page.pins.find((pin) => pin.number === number);
    if (await api({ action: "deleteComment", id })) {
      page.pins = page.pins.filter((pin) => pin.number !== number);
      confirmingDelete = null;
      if (selected === number) selected = null;
      render();
    }
  };

  const renderRow = ({ number, comment, authorName, canEdit, canDelete }) => {
    const row = el("div", number === selected ? "row selected" : "row");
    row.dataset.number = number;
    row.append(el("span", "number", String(number)), el("span", "author", authorName || "Unknown"));

    if (editing === number) {
      const textarea = el("textarea");
      textarea.value = editingText;
      textarea.maxLength = COMMENT_LIMIT;
      textarea.addEventListener("input", () => {
        editingText = textarea.value;
      });
      textarea.setAttribute("aria-label", `Edit comment ${number}`);
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saveEdit(number);
      });
      const actions = el("div", "actions");
      actions.append(
        button("Cancel", "", () => {
          editing = null;
          render();
        }),
        button("Save", "save", () => saveEdit(number))
      );
      row.append(textarea, actions);
      return row;
    }

    row.append(el("span", "text", comment));
    const note = NOTES[located.get(number)?.status];
    if (note) row.append(el("div", "note", note));
    const actions = el("div", "actions");
    if (confirmingDelete === number) {
      actions.append(
        button("Keep", "", () => {
          confirmingDelete = null;
          render();
        }),
        button("Confirm delete", "danger", () => deletePin(number))
      );
    } else {
      // Only offer what the server allows this person to do.
      if (canEdit) {
        actions.append(
          button("Edit", "", () => {
            editing = number;
            editingText = comment;
            confirmingDelete = null;
            render();
            panel.querySelector("textarea")?.focus();
          })
        );
      }
      if (canDelete) {
        actions.append(
          button("Delete", "", () => {
            confirmingDelete = number;
            render();
          })
        );
      }
    }
    row.append(actions);
    row.addEventListener("click", () => select(number, { scrollToPin: true }));
    return row;
  };

  const renderOtherPages = () => {
    const section = el("div", "pages");
    section.append(el("div", "pages-title", "Other pages in this review"));
    for (const { url, commentCount } of otherPages) {
      // The server only keeps http and https addresses, but pages are never trusted.
      if (!/^https?:\/\//.test(url)) continue;
      const link = el("a", "page-link", `${url.replace(/^https?:\/\//, "")} (${commentCount})`);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      section.append(link);
    }
    return section;
  };

  const renderPanel = () => {
    panel.classList.toggle("collapsed", collapsed);
    const head = el("div", "head");
    const title = el("div", "", `Comments (${page.pins.length})`);
    if (reviewName) title.append(el("div", "review", reviewName));
    head.append(
      title,
      button(collapsed ? "Show" : "Hide", "", () => {
        collapsed = !collapsed;
        renderPanel();
      })
    );
    const parts = [head];
    if (errorMessage) {
      // Outside the list, so errors still show when the panel is collapsed.
      const error = el("div", "error", errorMessage);
      if (loadFailed) {
        error.append(
          button("Retry", "", async () => {
            await load();
            render();
          })
        );
      }
      parts.push(error);
    }
    const list = el("div", "list");
    if (page.pins.length === 0 && !loadFailed) {
      list.append(el("div", "empty", "No comments yet. Click the page to add one."));
    }
    list.append(...page.pins.map(renderRow));
    if (otherPages.length > 0) list.append(renderOtherPages());
    panel.replaceChildren(...parts, list);
  };

  const render = () => {
    renderPins();
    renderPanel();
  };

  const closeDraft = () => {
    if (!draft) return;
    draft.pin.remove();
    draft.editor.remove();
    draft = null;
  };

  const saveDraft = async () => {
    // A slow save must not be sent twice by a second click.
    if (!draft || draft.saving) return;
    const current = draft;
    const comment = current.textarea.value.trim();
    if (!comment) {
      current.textarea.focus();
      return;
    }
    const url = key;
    current.saving = true;
    const result = await api({ action: "createComment", url, anchor: current.anchor, comment });
    current.saving = false;
    if (!result) return;
    if (draft === current) closeDraft();
    if (key === url) {
      page.pins = [...page.pins, result.pin];
      selected = result.pin.number;
    }
    render();
  };

  const openDraft = (clientX, clientY) => {
    closeDraft();
    // Measure from the host, not the page: sites can offset or position <html>.
    const origin = host.getBoundingClientRect();
    const x = clientX - origin.left;
    const y = clientY - origin.top;
    const anchor = anchorAt(clientX, clientY);
    const pin = makePin(x, y, "+");
    const editor = el("div", "editor");
    // Keep the box inside the visible part of the page and clear of the panel.
    const panelWidth = panel.getBoundingClientRect().width;
    const maxLeft = window.innerWidth - panelWidth - EDITOR_WIDTH - EDGE_GAP;
    const maxTop = window.innerHeight - EDITOR_HEIGHT - EDGE_GAP;
    const left = Math.max(EDGE_GAP, Math.min(clientX + 18, maxLeft));
    const top = Math.max(EDGE_GAP, Math.min(clientY + 18, maxTop));
    editor.style.left = `${left - origin.left}px`;
    editor.style.top = `${top - origin.top}px`;

    const textarea = el("textarea");
    textarea.placeholder = "Write your comment";
    textarea.maxLength = COMMENT_LIMIT;
    textarea.setAttribute("aria-label", "Comment");
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saveDraft();
    });

    const actions = el("div", "actions");
    actions.append(button("Cancel", "", closeDraft), button("Save", "save", saveDraft));
    editor.append(textarea, actions);
    shield(editor);

    root.append(pin, editor);
    draft = { anchor, pin, editor, textarea };
    textarea.focus({ preventScroll: true });
  };

  // Runs in the capture phase on window, so Esc works from any comment box too.
  const onKeydown = (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    if (editing !== null) {
      editing = null;
      render();
    } else if (draft) {
      closeDraft();
    } else {
      setActive(false);
    }
  };

  const load = async () => {
    const loading = pageKey();
    if (key !== loading) {
      page = emptyPage();
      otherPages = [];
    }
    key = loading;
    const result = await api({ action: "listComments", url: loading });
    if (key !== loading) return;
    loadFailed = !result;
    if (result) {
      page = { pins: result.pins };
      otherPages = result.otherPages;
      reviewName = result.reviewName;
      selected = editing = confirmingDelete = null;
    }
  };

  const busyInPanel = () => editing !== null || confirmingDelete !== null;

  // Picks up other people's comments. Failures stay quiet and the next try may succeed,
  // and anything being typed or confirmed is left alone until it's finished.
  const refreshComments = async () => {
    if (!host.isConnected) {
      clearInterval(refreshTimer); // The extension was reloaded, and a new overlay took over.
      return;
    }
    // Skipped in background tabs, so the free server can sleep when nobody is looking.
    if (!active || document.hidden || refreshing || apiCallsRunning > 0 || busyInPanel()) return;
    const asked = { key, calls: apiCalls };
    let result;
    refreshing = true;
    try {
      result = await chrome.runtime.sendMessage({ action: "listComments", url: key });
    } catch {
      return;
    } finally {
      refreshing = false;
    }
    // Something else changed the list while this was on its way, so this answer may be old.
    if (!result?.ok || !active || busyInPanel() || asked.key !== key || asked.calls !== apiCalls) return;
    const changed =
      JSON.stringify([result.pins, result.otherPages]) !== JSON.stringify([page.pins, otherPages]);
    if (!changed && !loadFailed) return;
    page = { pins: result.pins };
    otherPages = result.otherPages;
    reviewName = result.reviewName;
    if (loadFailed) {
      loadFailed = false;
      errorMessage = "";
    }
    if (!page.pins.some((pin) => pin.number === selected)) selected = null;
    const scrollTop = panel.querySelector(".list")?.scrollTop ?? 0;
    render();
    const list = panel.querySelector(".list");
    if (list) list.scrollTop = scrollTop;
  };
  const refreshTimer = setInterval(refreshComments, REFRESH_MS);

  const setActive = async (next) => {
    active = next;
    closeDraft();
    if (active) {
      root.append(catcher, bar, panel);
      window.addEventListener("keydown", onKeydown, true);
      render();
      // Always ask the server, since other people may have commented meanwhile.
      await load();
    } else {
      selected = editing = confirmingDelete = null;
      catcher.remove();
      bar.remove();
      panel.remove();
      window.removeEventListener("keydown", onKeydown, true);
    }
    render();
  };

  // The review can be switched in the popup while comment mode is on.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.activeReviewId) {
      closeDraft();
      load().then(render);
    }
  });

  const statusesOf = () => [...located.values()].map(({ status }) => status).join();

  // Scrolling only moves pins. Anything else may have changed which element they belong to.
  const refresh = (recheck) => {
    if (recheck) {
      // Some sites change the URL without a reload.
      if (key !== pageKey()) {
        closeDraft();
        load().then(render);
        return;
      }
      const before = statusesOf();
      locateAll();
      if (statusesOf() !== before) {
        renderPins();
        // Rebuilding the panel mid-edit would throw away what's being typed.
        if (editing === null) renderPanel();
        return;
      }
    }
    positionPins();
  };

  // At most one update per frame, however many changes a page makes.
  let frameQueued = false;
  let recheckQueued = false;
  const schedule = (recheck) => {
    recheckQueued ||= recheck;
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      const recheck = recheckQueued;
      frameQueued = recheckQueued = false;
      refresh(recheck);
    });
  };

  const watchPage = () => {
    const recheck = () => schedule(true);
    // Capture also catches scrolling inside panels, which doesn't bubble.
    window.addEventListener("scroll", () => schedule(false), { capture: true, passive: true });
    for (const type of ["resize", "load", "transitionend", "animationend"]) {
      window.addEventListener(type, recheck, true);
    }
    document.fonts.ready.then(recheck);
    const resizes = new ResizeObserver(recheck);
    resizes.observe(document.documentElement);
    resizes.observe(document.body);
    new MutationObserver(recheck).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    });
  };

  window.__pinpointToggle = () => setActive(!active);
  root.append(pinLayer);
  document.documentElement.append(host);
  setActive(true);
  watchPage();
})();
