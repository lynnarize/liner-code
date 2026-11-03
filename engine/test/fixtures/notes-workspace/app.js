// Notes: every note in one storage value, saved a moment after the last change, with the one open.
const $ = (id) => document.getElementById(id);
const page = $("page"), list = $("list"), search = $("search"), saved = $("saved");
document.execCommand("defaultParagraphSeparator", false, "p");

let notes = (await liner.storage.get("notes")) ?? [];
const lastOpen = await liner.storage.get("current");
let current = notes.find((n) => n.id === lastOpen) ?? [...notes].sort((a, b) => b.updated - a.updated)[0] ?? null;
let timer = null, dirty = false, range = null;

// A note's text, a line for each paragraph, heading or item (a detached element has no layout, so no innerText).
const textOf = (html) => { const d = document.createElement("div"); d.innerHTML = html.replace(/<br\s*\/?>|<\/?(p|div|h[1-6]|li|blockquote|ul|ol)\b[^>]*>/gi, "\n$&"); return d.textContent ?? ""; };
const titleOf = (n) => textOf(n.html).split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 80) || "Untitled note";
const lineOf = (n) => textOf(n.html).split("\n").map((l) => l.trim()).filter(Boolean)[1] ?? "";
const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
const when = (at) => {
  const d = new Date(at), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
};

/* Saving: "Saving…" while a change waits, "Saved" once it's kept, or what went wrong. */
function status(state, say) { saved.dataset.state = state; saved.textContent = say; }
function save() {
  dirty = true;
  status("saving", "Saving…");
  clearTimeout(timer);
  timer = setTimeout(flush, 500);
}
async function flush() {
  clearTimeout(timer);
  if (!dirty) return;
  dirty = false;
  try {
    await liner.storage.set("notes", notes);
    await liner.storage.set("current", current?.id ?? null);
    status("saved", "Saved");
  } catch (e) {
    dirty = true;
    status("error", `Not saved: ${e.message}`);
  }
}
addEventListener("pagehide", () => void flush());
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void flush());

/* The library: newest first, the search's words marked, an empty state for each case. */
function mark(el, text, q) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return void (el.textContent = text);
  el.append(text.slice(0, i), Object.assign(document.createElement("mark"), { textContent: text.slice(i, i + q.length) }), text.slice(i + q.length));
}
function drawList() {
  const q = search.value.trim().toLowerCase();
  const shown = [...notes].sort((a, b) => b.updated - a.updated).filter((n) => !q || textOf(n.html).toLowerCase().includes(q));
  list.replaceChildren(...shown.map((n) => {
    const li = document.createElement("li"), b = document.createElement("button"), t = document.createElement("b"), s = document.createElement("small");
    b.type = "button";
    b.setAttribute("aria-current", String(n === current));
    mark(t, titleOf(n), q);
    s.textContent = [when(n.updated), lineOf(n)].filter(Boolean).join(" · ");
    b.append(t, s);
    b.onclick = () => open(n, true);
    li.append(b);
    return li;
  }));
  const none = $("none");
  none.hidden = shown.length > 0 || !notes.length;
  none.textContent = q ? `No notes match “${search.value.trim()}”.` : "";
  $("count").textContent = String(notes.length);
  $("lib-say").textContent = `${notes.length ? plural(notes.length, "note") : "No notes"} · Saved on this device`;
}

/* The desk: the open note on its page, or the empty state. */
function drawDesk() {
  const has = Boolean(current);
  $("empty").hidden = has;
  page.hidden = !has;
  document.querySelector(".ruler").hidden = !has;
  for (const el of document.querySelectorAll(".tools button, .tools select")) el.disabled = !has;
  if (!has) {
    $("empty-title").textContent = notes.length ? "No note open" : "No notes yet";
    $("empty-say").textContent = notes.length ? "Pick one from the library, or start a new one." : "Notes you write here are kept on this device, in Liner Code.";
  }
  page.className = `page ${current?.font ?? "serif"}`;
  $("font").value = current?.font ?? "serif";
  stats();
}
function stats() {
  // From its HTML, not innerText, which needs the frame laid out and runs lines together before it is.
  const text = current ? textOf(page.innerHTML) : "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  $("stats").innerHTML = `${plural(words, "word")} <i>•</i> ${plural(text.replace(/\n/g, "").length, "character")}`;
}
function open(n, focus) {
  const moved = current !== n;
  if (current && moved) void flush();
  current = n;
  page.innerHTML = n?.html ?? "";
  drawDesk();
  drawList();
  if (n && focus) {
    page.focus();
    const r = document.createRange();
    r.selectNodeContents(page);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }
  // Which note is open is kept too, so it opens where you left off.
  if (moved) {
    dirty = true;
    void flush();
  }
}
function create() {
  const n = { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, html: "", font: current?.font ?? "serif", created: Date.now(), updated: Date.now() };
  notes.unshift(n);
  search.value = "";
  open(n, true);
  // Its first line goes in a paragraph too, so the style menu and the title read it as one.
  document.execCommand("formatBlock", false, "p");
}

page.addEventListener("input", () => {
  if (!current) return;
  current.html = page.innerHTML === "<p><br></p>" || page.innerHTML === "<br>" ? "" : page.innerHTML;
  current.updated = Date.now();
  stats();
  drawList();
  save();
});

/* The toolbar: each button keeps the selection (it takes no focus), each choice puts it back first. */
const pressed = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight"];
function refresh() {
  for (const cmd of pressed) document.querySelector(`[data-cmd="${cmd}"]`)?.setAttribute("aria-pressed", String(document.queryCommandState(cmd)));
  const block = String(document.queryCommandValue("formatBlock") || "p").toLowerCase();
  $("block").value = ["h1", "h2", "h3", "blockquote"].includes(block) ? block : "p";
}
document.addEventListener("selectionchange", () => {
  const s = getSelection();
  if (s.rangeCount && page.contains(s.anchorNode)) {
    range = s.getRangeAt(0).cloneRange();
    refresh();
  }
});
function restore() {
  page.focus();
  if (range) {
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }
}
function run(cmd, value) {
  restore();
  document.execCommand(cmd, false, value);
  if (cmd === "removeFormat") document.execCommand("formatBlock", false, "p");
  refresh();
}
for (const b of document.querySelectorAll("[data-cmd]")) {
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => run(b.dataset.cmd));
}
$("block").addEventListener("change", (e) => run("formatBlock", e.target.value));
$("font").addEventListener("change", (e) => {
  if (!current) return;
  current.font = e.target.value;
  page.className = `page ${current.font}`;
  restore();
  save();
});

/* New, delete (twice to be sure), search. */
$("new").onclick = create;
$("empty-new").onclick = create;
let sure = null;
$("delete").onclick = () => {
  if (!current) return;
  if (!sure) {
    $("delete").dataset.sure = "";
    $("delete-say").textContent = "Delete? Click again";
    sure = setTimeout(() => { delete $("delete").dataset.sure; $("delete-say").textContent = ""; sure = null; }, 3000);
    return;
  }
  clearTimeout(sure);
  sure = null;
  delete $("delete").dataset.sure;
  $("delete-say").textContent = "";
  notes = notes.filter((n) => n !== current);
  open([...notes].sort((a, b) => b.updated - a.updated)[0] ?? null, false);
};
search.addEventListener("input", drawList);
search.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { search.value = ""; drawList(); page.focus(); }
  if (e.key === "Enter") list.querySelector("button")?.click();
});

/* Keys: the editor's own (⌘B, ⌘I, ⌘U, ⌘Z, ⇧⌘Z) work as they are; these add the rest. */
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  const go = (fn) => { e.preventDefault(); fn(); };
  if (e.altKey && (k === "n" || e.code === "KeyN")) return go(create);
  if (!current || !page.contains(document.activeElement) && document.activeElement !== page) return;
  if (e.altKey && /^Digit[0-3]$/.test(e.code)) return go(() => run("formatBlock", ["p", "h1", "h2", "h3"][Number(e.code.slice(5))]));
  if (e.shiftKey && (k === "x" || e.code === "KeyX")) return go(() => run("strikeThrough"));
  if (e.shiftKey && e.code === "Digit8") return go(() => run("insertUnorderedList"));
  if (e.shiftKey && e.code === "Digit7") return go(() => run("insertOrderedList"));
  if (e.shiftKey && e.code === "KeyL") return go(() => run("justifyLeft"));
  if (e.shiftKey && e.code === "KeyE") return go(() => run("justifyCenter"));
  if (e.shiftKey && e.code === "KeyR") return go(() => run("justifyRight"));
  if (e.altKey && e.code === "Backslash") return go(() => run("removeFormat"));
});

open(current, false);
status("saved", "Saved");
