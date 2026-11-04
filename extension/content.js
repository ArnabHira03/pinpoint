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
    .list { flex: 1; overflow-y: auto; overscroll-behavior: contain; }
    .empty { padding: 16px 12px; color: #4b5563; font-size: 13px; line-height: 1.4; }
    .error { padding: 8px 12px; background: #fee2e2; color: #991b1b; font-size: 13px; line-height: 1.4; }
    .row { display: block; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; cursor: pointer; }
    .row:hover { background: #f3f4f6; }
    .row.selected { background: #dbeafe; }
    .number { margin-right: 6px; color: #dc2626; font-size: 13px; font-weight: 700; }
    .text { font-size: 13px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
    .note { margin-top: 6px; color: #92400e; font-size: 12px; line-height: 1.4; }
  `;

  const EDITOR_WIDTH = 280;
  const EDITOR_HEIGHT = 170;
  const EDGE_GAP = 8;
  const SNIPPET_LENGTH = 80;
  const NOTES = {
    moved: "May have moved: this part of the page changed.",
    hidden: "Not visible right now, possibly because of the window size.",
    detached: "Detached: this part of the page is gone.",
  };

  const emptyPage = () => ({ nextNumber: 1, pins: [] });
  // Query strings and hashes are left out: they can hold tokens and tracking data.
  const pageKey = () => `page:${location.origin}${location.pathname}`;

  let key = null;
  let page = emptyPage();
  let active = false;
  let draft = null;
  let selected = null;
  let editing = null;
  let confirmingDelete = null;
  let collapsed = false;
  let errorMessage = "";
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

  // Writes first and updates the screen after, so a failed save loses nothing.
  const commit = async (next) => {
    try {
      await chrome.storage.local.set({ [key]: next });
      page = next;
      errorMessage = "";
      return true;
    } catch {
      errorMessage = "Couldn't save. Reload the page and try again.";
      render();
      return false;
    }
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
      offsetX: rect.width ? (clientX - rect.left) / rect.width : 0,
      offsetY: rect.height ? (clientY - rect.top) / rect.height : 0,
      textSnippet: snippetOf(target),
    };
  };

  const locate = (pin) => {
    // Pins saved before anchoring only have a pixel position.
    if (!pin.selector) return { pin, target: null, status: "moved" };
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
      if (target) {
        const rect = target.getBoundingClientRect();
        node.style.left = `${rect.left + pin.offsetX * rect.width - origin.left}px`;
        node.style.top = `${rect.top + pin.offsetY * rect.height - origin.top}px`;
      } else {
        node.style.left = `${pin.x}px`;
        node.style.top = `${pin.y}px`;
      }
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

  const saveEdit = async (number, value) => {
    const comment = value.trim();
    if (!comment) return;
    const next = {
      ...page,
      pins: page.pins.map((pin) => (pin.number === number ? { ...pin, comment } : pin)),
    };
    if (await commit(next)) {
      editing = null;
      render();
    }
  };

  const deletePin = async (number) => {
    // nextNumber stays as it is, so a deleted pin's number is never reused.
    const next = { ...page, pins: page.pins.filter((pin) => pin.number !== number) };
    if (await commit(next)) {
      confirmingDelete = null;
      if (selected === number) selected = null;
      render();
    }
  };

  const renderRow = ({ number, comment }) => {
    const row = el("div", number === selected ? "row selected" : "row");
    row.dataset.number = number;
    row.append(el("span", "number", String(number)));

    if (editing === number) {
      const textarea = el("textarea");
      textarea.value = comment;
      textarea.setAttribute("aria-label", `Edit comment ${number}`);
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saveEdit(number, textarea.value);
      });
      const actions = el("div", "actions");
      actions.append(
        button("Cancel", "", () => {
          editing = null;
          render();
        }),
        button("Save", "save", () => saveEdit(number, textarea.value))
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
      actions.append(
        button("Edit", "", () => {
          editing = number;
          confirmingDelete = null;
          render();
          panel.querySelector("textarea")?.focus();
        }),
        button("Delete", "", () => {
          confirmingDelete = number;
          render();
        })
      );
    }
    row.append(actions);
    row.addEventListener("click", () => select(number, { scrollToPin: true }));
    return row;
  };

  const renderPanel = () => {
    panel.classList.toggle("collapsed", collapsed);
    const head = el("div", "head");
    head.append(
      el("span", "", `Comments (${page.pins.length})`),
      button(collapsed ? "Show" : "Hide", "", () => {
        collapsed = !collapsed;
        renderPanel();
      })
    );
    const list = el("div", "list");
    if (errorMessage) list.append(el("div", "error", errorMessage));
    if (page.pins.length === 0) {
      list.append(el("div", "empty", "No comments yet. Click the page to add one."));
    }
    list.append(...page.pins.map(renderRow));
    panel.replaceChildren(head, list);
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
    const comment = draft.textarea.value.trim();
    if (!comment) {
      draft.textarea.focus();
      return;
    }
    const number = page.nextNumber;
    const saved = await commit({
      nextNumber: number + 1,
      pins: [...page.pins, { number, ...draft.anchor, comment, createdAt: new Date().toISOString() }],
    });
    // On failure the box stays open, so the typed comment is not lost.
    if (saved) {
      closeDraft();
      selected = number;
      render();
    }
  };

  const openDraft = (clientX, clientY) => {
    closeDraft();
    // Measure from the host, not the page: sites can offset or position <html>.
    const origin = host.getBoundingClientRect();
    const x = clientX - origin.left;
    const y = clientY - origin.top;
    const anchor = anchorAt(clientX, clientY);
    const pin = makePin(x, y, String(page.nextNumber));
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
    key = loading;
    const stored = await chrome.storage.local.get(loading);
    if (key !== loading) return;
    page = stored[loading] ?? emptyPage();
    selected = editing = confirmingDelete = null;
  };

  const setActive = async (next) => {
    active = next;
    closeDraft();
    if (active) {
      // Some sites change the URL without a reload, so check which page this is.
      if (key !== pageKey()) await load();
      root.append(catcher, bar, panel);
      window.addEventListener("keydown", onKeydown, true);
    } else {
      selected = editing = confirmingDelete = null;
      catcher.remove();
      bar.remove();
      panel.remove();
      window.removeEventListener("keydown", onKeydown, true);
    }
    render();
  };

  // Keeps two tabs on the same page in step, so neither overwrites the other.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[key]) return;
    page = changes[key].newValue ?? emptyPage();
    renderPins();
    if (editing === null) renderPanel();
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
