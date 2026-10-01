(() => {
  "use strict";

  const API = "/api/v1";
  const LS_MASTER_KEY = "b1tm4p_selected_master";
  const state = {
    me: null,
    masters: [],
    currentMaster: null,
    currentTags: [],
    feedOffset: 0,
    feedLimit: 20,
    feedTotal: 0,
    feedLoading: false,
    search: "",
    masterSlug: "",
    feedMode: "home",
    selectedMasterSlug: localStorage.getItem(LS_MASTER_KEY) || "",
    composerOpen: false
  };

  // The main feed always shows exactly one master tag's posts, picked from
  // the header dropdown and remembered across visits/reloads.
  function setSelectedMaster(slug) {
    state.selectedMasterSlug = slug || "";
    if (state.selectedMasterSlug) localStorage.setItem(LS_MASTER_KEY, state.selectedMasterSlug);
    else localStorage.removeItem(LS_MASTER_KEY);
  }

  function ensureSelectedMaster() {
    const slugs = state.masters.map(m => m.slug);
    if (!state.selectedMasterSlug || !slugs.includes(state.selectedMasterSlug)) {
      setSelectedMaster(slugs[0] || "");
    }
  }

  const $ = (s, root = document) => root.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const now = () => Math.floor(Date.now() / 1000);

  function apiErrorMessage(data, status) {
    if (data?.error) return data.error;
    return status >= 500 ? "server_error" : "request_failed";
  }

  async function api(path, options = {}) {
    const opts = {...options, credentials: "include"};
    opts.headers = {...(options.headers || {})};
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(API + path, opts);
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(apiErrorMessage(data, res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function showToast(message, kind = "") {
    $("#toast-root").innerHTML = `<div class="toast ${kind}">${esc(message)}</div>`;
    setTimeout(() => $("#toast-root").innerHTML = "", 3500);
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("b1tm4p_theme", theme);
    const checkbox = $("#theme-switch");
    if (checkbox) checkbox.checked = theme === "light";
  }

  function luminance(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return 1;
    const rgb = [0,2,4].map(i => parseInt(m[1].slice(i,i+2),16)/255);
    const lin = rgb.map(c => c <= .03928 ? c/12.92 : Math.pow((c+.055)/1.055,2.4));
    return .2126*lin[0] + .7152*lin[1] + .0722*lin[2];
  }

  function avatarHTML(user, cls = "") {
    if (!user) return "";
    const shape = user.avatar_shape === "square" ? "square" : "circle";
    if (user.avatar_type === "image") {
      return `<div class="avatar ${shape} ${cls}"><img src="${esc(user.avatar_value)}" alt="${esc(user.username || "avatar")}"></div>`;
    }
    const bg = /^#[0-9A-Fa-f]{6}$/.test(user.avatar_color || "") ? user.avatar_color : "#FF7A00";
    const fg = luminance(bg) > .52 ? "#000" : "#fff";
    return `<div class="avatar ${shape} ${cls}" style="background:${esc(bg)};color:${fg}">${esc(user.avatar_value || "US")}</div>`;
  }

  function relativeTime(ts) {
    const diff = Math.max(0, now() - Number(ts || 0));
    if (diff < 60) return `${diff}s ago`;
    const m = Math.floor(diff/60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h/24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d/30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo/12)}y ago`;
  }

  function route() {
    const p = location.pathname;
    if (p === "/") return renderHome();
    if (p.startsWith("/tag/")) return renderTag(decodeURIComponent(p.slice(5)));
    if (p.startsWith("/post/")) return renderPost(p.slice(6));
    if (p === "/reports") return renderReports();
    if (p === "/account") return renderAccount();
    if (p === "/login") return renderLogin();
    if (p === "/register") return renderRegister();
    if (p === "/verify-email") return renderVerify();
    if (p === "/reset-password") return renderResetPassword();
    if (p === "/legal") return renderLegal();
    if (p === "/search") return renderSearch();
    return renderNotFound();
  }

  function navigate(url) {
    history.pushState({}, "", url);
    route();
    window.scrollTo(0,0);
  }

  function renderHeader() {
    const brand = `<span>B1tm4p</span>`;
    const masterSelectHTML = state.masters.length ? `
      <select id="master-select" class="master-select" aria-label="Master tag">
        ${state.masters.map(m => `<option value="${esc(m.slug)}" ${m.slug === state.selectedMasterSlug ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
      </select>` : "";
    // Header report button is only ever for the master tag itself (the whole
    // category) — reporting individual posts/replies happens next to that
    // content instead, see reportLinkHTML().
    const reportHref = state.currentMaster
      ? `/reports?content_type=master_tag&content_id=${encodeURIComponent(state.currentMaster.id)}`
      : `/reports`;

    $("#site-header").className = "site-header";
    $("#site-header").innerHTML = `
      <div class="header-inner">
        <a class="icon-btn" href="/" aria-label="Home">⌂</a>
        <button class="icon-btn" id="search-btn" aria-label="Search">⌕</button>
        ${state.searchOpen ? `
          <form class="search-inline" id="search-form">
            <input id="search-input" value="${esc(state.search || "")}" placeholder="Search posts" aria-label="Search posts">
          </form>` : ""}
        <a class="brand" href="/">${brand}</a>
        ${masterSelectHTML}
        <a class="icon-btn" href="${reportHref}" aria-label="${state.currentMaster ? `Report ${esc(state.currentMaster.name)}` : "Report"}" title="${state.currentMaster ? `Report ${esc(state.currentMaster.name)}` : "Report"}">⚑</a>
        <div class="header-spacer"></div>
        ${state.me && state.currentMaster ? `
          <button class="icon-btn" id="composer-toggle-btn" aria-label="New post" aria-expanded="${state.composerOpen ? "true":"false"}">+</button>` : ""}
        ${state.me ? `
          <div class="account-wrap">
            <button class="avatar-button" id="avatar-menu-btn" aria-label="Account">
              ${avatarHTML(state.me)}
            </button>
            ${state.accountMenu ? `
              <div class="account-menu">
                <a href="/account">Account</a>
                ${["manager","admin"].includes(state.me.role) ? `<a href="/account#admin">Admin Console</a>` : ""}
                <button id="logout-btn">Log out</button>
              </div>` : ""}
          </div>` : `<a href="/login">Log in</a>`}
      </div>`;

    $("#composer-toggle-btn")?.addEventListener("click", () => {
      setComposerOpen(!state.composerOpen);
    });
    $("#master-select")?.addEventListener("change", e => {
      setSelectedMaster(e.target.value);
      if (location.pathname === "/") renderHome();
      else navigate("/");
    });
    $("#search-btn").onclick = () => {
      state.searchOpen = !state.searchOpen;
      renderHeader();
      if (state.searchOpen) $("#search-input")?.focus();
    };
    $("#search-form")?.addEventListener("submit", e => {
      e.preventDefault();
      const q = $("#search-input").value.trim();
      navigate(`/search?q=${encodeURIComponent(q)}`);
    });
    $("#avatar-menu-btn")?.addEventListener("click", () => {
      state.accountMenu = !state.accountMenu;
      renderHeader();
    });
    $("#logout-btn")?.addEventListener("click", async () => {
      try { await api("/auth/logout", {method:"POST"}); }
      catch {}
      state.me = null; state.accountMenu = false;
      navigate("/login");
    });
  }

  function renderFooter() {
    $("#site-footer").className = "footer";
    $("#site-footer").innerHTML = `
      <div class="footer-inner">
        <span>B1tm4p</span>
        <span><a href="/legal">Legal / Cookies</a> · © ${new Date().getFullYear()} B1tm4p</span>
      </div>`;
  }

  function loading() { return `<div class="loading"><div class="spinner" aria-label="Loading"></div></div>`; }
  function errorBox(e) {
    if (e?.status === 401) {
      const ret = encodeURIComponent(location.pathname + location.search);
      return `<div class="notice error">Session required. <a href="/login?return_to=${ret}">Log in</a></div>`;
    }
    return `<div class="notice error">Could not load this section: ${esc(e?.message || "request_failed")}</div>`;
  }

  async function loadMe() {
    try { state.me = await api("/me"); }
    catch (e) { if (e.status === 401) state.me = null; else throw e; }
  }

  async function loadMasters() {
    const d = await api("/tags/master?limit=100&offset=0");
    state.masters = d.items || [];
  }

  function chipsHTML(items, activeSlug = "") {
    return `<div class="chips">
      ${items.map(x => `<a class="chip ${x.slug === activeSlug ? "active":""}" href="/tag/${encodeURIComponent(x.slug)}">${esc(x.name)}</a>`).join("")}
    </div>`;
  }

  async function fetchPosts(params = {}, limit = state.feedLimit, offset = 0) {
    const q = new URLSearchParams();
    if (params.master_slug) q.set("master_slug", params.master_slug);
    if (params.tag_slug) q.set("tag_slug", params.tag_slug);
    if (params.search) q.set("search", params.search);
    q.set("limit", limit); q.set("offset", offset);
    return api(`/posts?${q.toString()}`);
  }

  function mediaHTML(body_type, file_path) {
    if (!file_path) return "";
    if (body_type === "image") return `<img class="media" src="${esc(file_path)}" alt="" data-lightbox="${esc(file_path)}">`;
    if (body_type === "sound") return `<audio controls src="${esc(file_path)}"></audio>`;
    if (body_type === "video") return `<video class="media" controls src="${esc(file_path)}"></video>`;
    return "";
  }

  // A grey, non-interactive "#id" badge next to content, so people can
  // quote the right content_id when filing a report.
  function contentIdHTML(contentId) {
    return `<span class="content-id" title="Content ID">#${esc(contentId)}</span>`;
  }

  function postHTML(post) {
    const author = post.author || {};
    const body = post.body_type === "text"
      ? `<div class="body-text">${esc(post.body_text || "")}</div>`
      : mediaHTML(post.body_type, post.file_path);
    return `<article class="feed-item" data-post-id="${esc(post.id)}">
      <aside class="feed-author">
        ${avatarHTML(author)}
        <div class="row">
          <a class="author-name" href="/search?q=${encodeURIComponent(author.username || "")}">${esc(author.username || "unknown")}</a>
          <span class="timestamp">${relativeTime(post.created_at)}</span>
          ${contentIdHTML(post.id)}
          <button class="like ${post.liked ? "liked":""}" data-like-type="post" data-like-id="${esc(post.id)}" title="Like">
            <span class="heart">${post.liked ? "♥" : "♡"}</span> <span class="like-count">${Number(post.likes_count || 0)}</span>
          </button>
          ${shareButtonHTML(post)}
          ${reportLinkHTML("post", post.id)}
        </div>
      </aside>
      <div class="content-body">
        ${post.header_title ? `<div class="header-title">${esc(post.header_title)}</div>` : ""}
        ${body}
        <div class="content-actions">
          <a class="thread-link" href="/post/${encodeURIComponent(post.id)}">View thread · ${Number(post.reply_count || 0)} replies</a>
        </div>
      </div>
    </article>`;
  }

  // A report link for one piece of content (a post or reply), distinct from
  // the header's report button which only ever reports the master tag.
  function reportLinkHTML(contentType, contentId) {
    return `<a class="icon-btn report-link" href="/reports?content_type=${encodeURIComponent(contentType)}&content_id=${encodeURIComponent(contentId)}" title="Report this ${contentType}" aria-label="Report this ${contentType}">⚑</a>`;
  }

  function wireLikeButtons(root) {
    root.querySelectorAll("[data-like-id]").forEach(btn => {
      btn.onclick = async () => {
        if (!state.me) { navigate(`/login?return_to=${encodeURIComponent(location.pathname)}`); return; }
        const type = btn.dataset.likeType, id = btn.dataset.likeId;
        try {
          const d = await api(`/${type === "post" ? "posts" : "replies"}/${encodeURIComponent(id)}/like`, {method:"POST"});
          btn.classList.toggle("liked", d.liked);
          btn.querySelector(".heart").textContent = d.liked ? "♥" : "♡";
          btn.querySelector(".like-count").textContent = d.likes_count;
        } catch (e) {
          if (e.status === 401) navigate(`/login?return_to=${encodeURIComponent(location.pathname)}`);
          else showToast(e.message, "error");
        }
      };
    });
  }

  // A share button for one post: it only ever shares that single post's own
  // link/text/image, never the feed or page it's sitting in.
  function shareButtonHTML(post) {
    const text = post.body_type === "text" ? (post.body_text || "") : "";
    return `<button class="icon-btn share-btn" data-share-id="${esc(post.id)}"
      data-share-title="${esc(post.header_title || "")}"
      data-share-text="${esc(text)}"
      data-share-type="${esc(post.body_type || "")}"
      data-share-file="${esc(post.file_path || "")}"
      title="Share this post" aria-label="Share this post">⤴</button>`;
  }

  function wireShareButtons(root) {
    root.querySelectorAll("[data-share-id]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.shareId;
        const url = `${location.origin}/post/${encodeURIComponent(id)}`;
        const title = btn.dataset.shareTitle || "B1tm4p post";
        const text = btn.dataset.shareText || "";
        const bodyType = btn.dataset.shareType;
        const filePath = btn.dataset.shareFile;

        const copyFallback = async () => {
          try {
            await navigator.clipboard.writeText(url);
            showToast("Link copied to clipboard.", "success");
          } catch {
            showToast("Couldn't share this post.", "error");
          }
        };

        if (!navigator.share) { await copyFallback(); return; }

        const payload = {title, text, url};
        if (bodyType === "image" && filePath && navigator.canShare) {
          try {
            const res = await fetch(filePath);
            const blob = await res.blob();
            const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
            const file = new File([blob], `post-${id}.${ext}`, {type: blob.type});
            if (navigator.canShare({files: [file]})) payload.files = [file];
          } catch { /* fall back to link-only share below */ }
        }

        try {
          await navigator.share(payload);
        } catch (e) {
          if (e?.name === "AbortError") return;
          await copyFallback();
        }
      };
    });
  }

  async function loadFeed(container, params = {}) {
    container.innerHTML = loading();
    state.feedParams = params; state.feedOffset = 0;
    try {
      const d = await fetchPosts(params, state.feedLimit, 0);
      state.feedTotal = d.total;
      if (!d.items.length) { container.innerHTML = `<div class="notice">No posts yet.</div>`; return; }
      container.innerHTML = d.items.map(postHTML).join("") +
        (d.items.length < d.total ? `<button class="secondary" id="load-more">Load more</button>` : "");
      wireLikeButtons(container);
      wireShareButtons(container);
      $("#load-more")?.addEventListener("click", () => loadMoreFeed(container));
    } catch (e) { container.innerHTML = errorBox(e); }
  }

  async function loadMoreFeed(container) {
    const btn = $("#load-more"); if (btn) btn.disabled = true;
    try {
      state.feedOffset += state.feedLimit;
      const d = await fetchPosts(state.feedParams, state.feedLimit, state.feedOffset);
      btn?.remove();
      container.insertAdjacentHTML("beforeend", d.items.map(postHTML).join(""));
      wireLikeButtons(container);
      wireShareButtons(container);
      if (state.feedOffset + state.feedLimit < d.total) {
        container.insertAdjacentHTML("beforeend", `<button class="secondary" id="load-more">Load more</button>`);
        $("#load-more")?.addEventListener("click", () => loadMoreFeed(container));
      }
    } catch (e) { showToast(e.message, "error"); if (btn) btn.disabled = false; }
  }

  function composerHTML(master) {
    if (!state.me || !master) return "";
    return `<section class="card" id="composer" hidden>
      <h2>New post in ${esc(master.name)}</h2>
      <form id="new-post-form" class="form-grid">
        <input type="hidden" id="post-master" value="${esc(master.id)}">
        <label>Tag
          <select id="post-tag" required disabled><option value="">Loading…</option></select>
        </label>
        <label>Header title <input id="post-title" maxlength="200"></label>
        <label>Body type
          <select id="post-body-type">
            <option value="text">Text</option><option value="image">Image</option>
            <option value="sound">Sound</option><option value="video">Video</option>
          </select>
        </label>
        <div id="post-body-input"></div>
        <button class="primary" type="submit">Publish</button>
        <div id="composer-status"></div>
      </form>
    </section>`;
  }

  async function wireComposer(master) {
    const form = $("#new-post-form");
    if (!form || !master) return;
    const type = $("#post-body-type"), input = $("#post-body-input");
    const updateInput = () => {
      const t = type.value;
      input.innerHTML = t === "text"
        ? `<label>Body <textarea id="post-body" required></textarea></label>`
        : `<label>File <input id="post-file" type="file" required accept="${t === "image" ? "image/jpeg,image/png,image/webp,image/gif" : t === "sound" ? "audio/*" : "video/*"}"></label>`;
    };
    updateInput();
    type.onchange = updateInput;

    const tagSelect = $("#post-tag");
    tagSelect.disabled = true;
    tagSelect.innerHTML = `<option>Loading…</option>`;
    try {
      const d = await api(`/tags?master_slug=${encodeURIComponent(master.slug)}&limit=100&offset=0`);
      tagSelect.innerHTML = d.items.length
        ? d.items.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")
        : `<option value="">No tags under ${esc(master.name)}</option>`;
      tagSelect.disabled = d.items.length === 0;
    } catch (err) {
      tagSelect.innerHTML = `<option value="">${esc(err.message)}</option>`;
    }

    form.onsubmit = async e => {
      e.preventDefault();
      const status = $("#composer-status");
      status.innerHTML = "";
      const masterId = $("#post-master").value, tagId = $("#post-tag").value, bodyType = $("#post-body-type").value;
      if (!masterId || !tagId) { status.innerHTML = `<span class="error">Select a tag.</span>`; return; }
      const fd = new FormData();
      fd.append("master_tag_id", masterId);
      fd.append("tag_id", tagId);
      fd.append("body_type", bodyType);
      const title = $("#post-title").value.trim();
      if (title) fd.append("header_title", title);
      if (bodyType === "text") {
        fd.append("body_text", $("#post-body").value);
      } else {
        const file = $("#post-file")?.files?.[0];
        if (!file) { status.innerHTML = `<span class="error">Choose a file.</span>`; return; }
        fd.append("file", file);
      }
      const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        await api("/posts", {method:"POST", body:fd});
        form.reset(); updateInput();
        showToast("Posted.", "success");
        setComposerOpen(false);
        await loadFeed($("#feed"), state.feedParams || {});
      } catch (err) {
        if (err.status === 401) navigate(`/login?return_to=${encodeURIComponent(location.pathname)}`);
        else status.innerHTML = `<span class="error">${esc(err.message)}</span>`;
      } finally { btn.disabled = false; }
    };
  }

  function setComposerOpen(open) {
    state.composerOpen = open;
    const section = $("#composer");
    if (section) {
      section.hidden = !open;
      if (open) { section.scrollIntoView({behavior:"smooth", block:"start"}); $("#post-title")?.focus(); }
    }
    const btn = $("#composer-toggle-btn");
    if (btn) btn.setAttribute("aria-expanded", String(open));
  }

  async function renderHome() {
    state.feedMode = "home"; state.search = "";
    renderHeader(); renderFooter();
    const app = $("#app"); app.innerHTML = loading();
    try {
      await Promise.all([loadMe(), loadMasters()]);
      ensureSelectedMaster();
      if (!state.selectedMasterSlug) {
        state.currentMaster = null;
        renderHeader();
        app.innerHTML = `<div class="empty"><h1 class="page-title">No master tags yet</h1><p class="muted">Ask a manager/admin to create one.</p></div>`;
        return;
      }
      const d = await api(`/tags/master/${encodeURIComponent(state.selectedMasterSlug)}`);
      state.currentMaster = d;
      state.currentTags = d.tags || [];
      state.composerOpen = false;
      renderHeader();
      app.innerHTML = `
        ${d.header_image_path
          ? `<img class="banner" src="${esc(d.header_image_path)}" alt="${esc(d.name)} header">`
          : `<div class="banner-placeholder">No header image</div>`}
        <div class="row" style="justify-content:space-between;margin-top:16px">
          <div><h1 class="page-title">${esc(d.name)}</h1><p class="muted">${esc(d.description || "")}</p></div>
          ${["manager","admin"].includes(state.me?.role) ? `<label class="primary" style="cursor:pointer">Upload header <input id="header-upload" type="file" accept="image/*" hidden></label>` : ""}
        </div>
        ${chipsHTML(state.currentTags)}
        ${composerHTML(d)}
        <section id="feed" class="feed">${loading()}</section>`;
      $("#header-upload")?.addEventListener("change", uploadHeader);
      await wireComposer(d);
      await loadFeed($("#feed"), {master_slug: state.selectedMasterSlug});
    } catch (e) { app.innerHTML = errorBox(e); }
  }

  async function renderTag(slug) {
    state.feedMode = "tag"; state.masterSlug = slug;
    renderHeader(); renderFooter();
    const app = $("#app"); app.innerHTML = loading();
    try {
      await Promise.all([loadMe(), loadMasters()]);
      const d = await api(`/tags/master/${encodeURIComponent(slug)}`);
      state.currentMaster = d;
      state.currentTags = d.tags || [];
      state.composerOpen = false;
      renderHeader();
      app.innerHTML = `
        ${d.header_image_path
          ? `<img class="banner" src="${esc(d.header_image_path)}" alt="${esc(d.name)} header">`
          : `<div class="banner-placeholder">No header image</div>`}
        <div class="row" style="justify-content:space-between;margin-top:16px">
          <div><h1 class="page-title">${esc(d.name)}</h1><p class="muted">${esc(d.description || "")}</p></div>
          ${["manager","admin"].includes(state.me?.role) ? `<label class="primary" style="cursor:pointer">Upload header <input id="header-upload" type="file" accept="image/*" hidden></label>` : ""}
        </div>
        ${chipsHTML(state.currentTags)}
        ${composerHTML(d)}
        <section id="feed" class="feed">${loading()}</section>`;
      $("#header-upload")?.addEventListener("change", uploadHeader);
      await wireComposer(d);
      await loadFeed($("#feed"), {master_slug: slug});
    } catch (e) { app.innerHTML = errorBox(e); }
  }

  async function uploadHeader(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData(); fd.append("header", file);
    try {
      await api(`/tags/master/${encodeURIComponent(state.currentMaster.id)}/header`, {method:"POST", body:fd});
      await route();
    } catch (err) {
      if (err.status === 401) navigate(`/login?return_to=${encodeURIComponent(location.pathname)}`);
      else showToast(err.message, "error");
    }
  }

  function replyFormHTML(postId, parentReplyId) {
    const target = parentReplyId ? `reply-${parentReplyId}` : `post-${postId}`;
    return `<form class="reply-form" data-reply-form="${target}" data-post-id="${esc(postId)}" ${parentReplyId ? `data-parent-reply-id="${esc(parentReplyId)}"` : ""}>
      <textarea placeholder="Write a reply…" required></textarea>
      <button class="secondary" type="submit">Reply</button>
    </form>`;
  }

  function replyNodeHTML(node, postId, depth, rootPostId) {
    const author = node.author || {};
    const children = node.replies || [];
    const body = node.deleted
      ? `<div class="body-text muted">[deleted]</div>`
      : (node.body_type === "text" ? `<div class="body-text">${esc(node.body_text || "")}</div>` : mediaHTML(node.body_type, node.file_path));
    // backlink to parent
    const backlink = node.parent_reply_id
      ? `<a class="reply-backlink" data-target-reply="${esc(node.parent_reply_id)}">&gt;&gt;${esc(node.parent_reply_id)}</a>`
      : "";
    // "reply to OP" button for nested replies
    const replyOpBtn = depth > 0 && !node.deleted
      ? `<button class="link-btn reply-op-btn" data-open-reply-op="${esc(postId)}">↩OP</button>`
      : "";
    const childrenHTML = children.length === 0 ? "" : `
      <div class="reply-children" id="children-${esc(node.id)}" hidden>
        ${children.map(c => replyNodeHTML(c, postId, depth+1, rootPostId)).join("")}
      </div>
      <button class="link-btn reply-expand-btn" data-expand="${esc(node.id)}">
        ▸ ${children.length} ${children.length === 1 ? "reply" : "replies"}
      </button>`;
    return `<div class="reply-node" data-reply-id="${esc(node.id)}" data-depth="${Math.min(depth,6)}">
      <div class="reply-meta">
        ${avatarHTML(author, "small")}
        <span class="author-name">${esc(author.username || "unknown")}</span>
        <span class="timestamp">${relativeTime(node.created_at)}</span>
        ${contentIdHTML(node.id)}
        ${backlink}
        ${!node.deleted ? `<button class="like ${node.liked?"liked":""}" data-like-type="reply" data-like-id="${esc(node.id)}">
          <span class="heart">${node.liked?"♥":"♡"}</span> <span class="like-count">${Number(node.likes_count||0)}</span>
        </button>` : ""}
        ${!node.deleted ? `<button class="link-btn" data-open-reply="${esc(node.id)}">Reply</button>` : ""}
        ${replyOpBtn}
        ${!node.deleted ? reportLinkHTML("reply", node.id) : ""}
      </div>
      ${node.header_title ? `<div class="header-title">${esc(node.header_title)}</div>` : ""}
      ${body}
      <div class="reply-inline-form" id="reply-inline-${esc(node.id)}"></div>
      ${childrenHTML}
    </div>`;
  }

  function wireReplyForm(form, container, postId) {
    form.onsubmit = async e => {
      e.preventDefault();
      if (!state.me) { navigate(`/login?return_to=${encodeURIComponent(location.pathname)}`); return; }
      const textarea = form.querySelector("textarea");
      const fd = new FormData();
      fd.append("body_type", "text");
      fd.append("body_text", textarea.value);
      const parentId = form.dataset.parentReplyId;
      if (parentId) fd.append("parent_reply_id", parentId);
      try {
        await api(`/posts/${encodeURIComponent(postId)}/reply`, {method:"POST", body:fd});
        await renderPost(postId);
      } catch (err) {
        if (err.status === 401) navigate(`/login?return_to=${encodeURIComponent(location.pathname)}`);
        else showToast(err.message, "error");
      }
    };
  }

  async function renderPost(id) {
    state.currentMaster = null; renderHeader(); renderFooter();
    const app = $("#app"); app.innerHTML = loading();
    try {
      await loadMe();
      const d = await api(`/posts/${encodeURIComponent(id)}`);
      const post = d.post;
      const body = post.body_type === "text"
        ? `<div class="body-text">${esc(post.body_text || "")}</div>`
        : mediaHTML(post.body_type, post.file_path);
      app.innerHTML = `
        <article class="card">
          <div class="feed-author">
            ${avatarHTML(post.author)}
            <div class="row">
              <span class="author-name">${esc(post.author?.username || "unknown")}</span>
              <span class="timestamp">${relativeTime(post.created_at)}</span>
              ${contentIdHTML(post.id)}
              <button class="like ${post.liked?"liked":""}" data-like-type="post" data-like-id="${esc(post.id)}">
                <span class="heart">${post.liked?"♥":"♡"}</span> <span class="like-count">${Number(post.likes_count||0)}</span>
              </button>
              ${shareButtonHTML(post)}
              ${reportLinkHTML("post", post.id)}
            </div>
          </div>
          ${post.header_title ? `<div class="header-title">${esc(post.header_title)}</div>` : ""}
          ${body}
        </article>
        <section class="card">
          <h2>Replies (${d.replies.length})</h2>
          ${state.me ? replyFormHTML(post.id) : `<p class="muted"><a href="/login?return_to=${encodeURIComponent(location.pathname)}">Log in</a> to reply.</p>`}
          <div id="reply-tree">${d.replies.map(n => replyNodeHTML(n, post.id, 0)).join("") || `<p class="muted">No replies yet.</p>`}</div>
        </section>`;
      wireLikeButtons(app);
      wireShareButtons(app);
      wireReplyForm($(`[data-reply-form="post-${post.id}"]`), app, post.id);
      // Reply to a specific reply
      app.querySelectorAll("[data-open-reply]").forEach(btn => {
        btn.onclick = () => {
          const replyId = btn.dataset.openReply;
          const slot = $(`#reply-inline-${replyId}`);
          if (slot.innerHTML) { slot.innerHTML = ""; return; }
          slot.innerHTML = replyFormHTML(post.id, replyId);
          wireReplyForm(slot.querySelector("form"), app, post.id);
        };
      });

      // Reply to OP (parent post) from inside a nested reply
      app.querySelectorAll("[data-open-reply-op]").forEach(btn => {
        btn.onclick = () => {
          const topForm = $(`[data-reply-form="post-${post.id}"]`);
          if (topForm) { topForm.querySelector("textarea").focus(); topForm.scrollIntoView({behavior:"smooth", block:"center"}); }
        };
      });

      // Expand/collapse child replies
      app.querySelectorAll("[data-expand]").forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.expand;
          const box = $(`#children-${id}`);
          const collapsed = box.hidden;
          box.hidden = !collapsed;
          btn.textContent = collapsed
            ? `▾ ${box.querySelectorAll(":scope > .reply-node").length} ${box.querySelectorAll(":scope > .reply-node").length === 1 ? "reply" : "replies"}`
            : `▸ ${box.querySelectorAll(":scope > .reply-node").length} ${box.querySelectorAll(":scope > .reply-node").length === 1 ? "reply" : "replies"}`;
          if (collapsed) wireLikeButtons(box);
        };
      });

      // Backlink hover: highlight target reply, click: scroll to it
      app.querySelectorAll("[data-target-reply]").forEach(a => {
        const targetId = a.dataset.targetReply;
        a.onclick = e => {
          e.preventDefault();
          const target = app.querySelector(`[data-reply-id="${targetId}"]`);
          if (!target) return;
          // expand parents if hidden
          let el = target;
          while (el) {
            if (el.hidden) el.hidden = false;
            el = el.parentElement;
          }
          target.scrollIntoView({behavior:"smooth", block:"center"});
          target.classList.add("reply-highlight");
          setTimeout(() => target.classList.remove("reply-highlight"), 1500);
        };
      });

      return;
    } catch (e) { app.innerHTML = errorBox(e); return; }
  }

  async function renderReports() {
    state.currentMaster = null; renderHeader(); renderFooter();
    const app = $("#app"); app.innerHTML = loading();
    try {
      await loadMe();
      if (!state.me) {
        app.innerHTML = `<div class="auth-page"><div class="card">${errorBox({status:401})}</div></div>`;
        return;
      }
      const q = new URLSearchParams(location.search);
      const isStaff = ["manager","admin"].includes(state.me.role);
      app.innerHTML = `
        <h1 class="page-title">Reports</h1>
        <section class="card">
          <h2>Submit a report</h2>
          <form id="report-form" class="form-grid">
            <label>Content type
              <select id="report-type">
                <option value="post" ${q.get("content_type")==="post"?"selected":""}>Post</option>
                <option value="reply" ${q.get("content_type")==="reply"?"selected":""}>Reply</option>
                <option value="master_tag" ${q.get("content_type")==="master_tag"?"selected":""}>Master tag</option>
                <option value="tag" ${q.get("content_type")==="tag"?"selected":""}>Tag</option>
              </select>
            </label>
            <label>Content ID <input id="report-id" value="${esc(q.get("content_id") || "")}" required></label>
            <label>Reason <textarea id="report-reason" required></textarea></label>
            <button class="primary">Submit report</button>
            <div id="report-status"></div>
          </form>
        </section>
        ${isStaff ? `<section class="card"><h2>Pending reports</h2><div id="pending-reports">${loading()}</div></section>` : ""}`;
      $("#report-form").onsubmit = async e => {
        e.preventDefault();
        const status = $("#report-status");
        const contentId = Number.parseInt($("#report-id").value, 10);
        if (!Number.isInteger(contentId)) { status.innerHTML = `<span class="error">Enter a valid content ID.</span>`; return; }
        try {
          await api("/reports", {method:"POST", body:{
            content_type: $("#report-type").value,
            content_id: contentId,
            reason: $("#report-reason").value
          }});
          status.innerHTML = `<span class="success">Report submitted.</span>`;
          e.target.reset();
        } catch (err) {
          if (err.status === 401) navigate(`/login?return_to=${encodeURIComponent(location.pathname)}`);
          else status.innerHTML = `<span class="error">${esc(err.message)}</span>`;
        }
      };
      if (isStaff) await loadPendingReports();
    } catch (e) { app.innerHTML = errorBox(e); }
  }

  async function loadPendingReports() {
    const container = $("#pending-reports");
    try {
      const d = await api("/reports?status=pending&limit=50&offset=0");
      if (!d.items.length) { container.innerHTML = `<p class="muted">No pending reports.</p>`; return; }
      container.innerHTML = `<table class="data-table"><thead><tr>
        <th>ID</th><th>Type</th><th>Content</th><th>Reporter</th><th>Reason</th><th>Actions</th>
      </tr></thead><tbody>${d.items.map(r => `<tr data-report-id="${esc(r.id)}">
        <td>${esc(r.id)}</td>
        <td>${esc(r.content_type)} #${esc(r.content_id)}</td>
        <td>${esc(r.content?.snippet || "")}</td>
        <td>${esc(r.reporter?.username || "unknown")}</td>
        <td>${esc(r.reason)}</td>
        <td>
          <button class="secondary" data-review="reviewed">Approve</button>
          <button class="secondary" data-review="dismissed">Dismiss</button>
        </td>
      </tr>`).join("")}</tbody></table>`;
      container.querySelectorAll("[data-review]").forEach(btn => {
        btn.onclick = async () => {
          const row = btn.closest("tr");
          const id = row.dataset.reportId;
          try {
            await api(`/reports/${encodeURIComponent(id)}`, {method:"PATCH", body:{status: btn.dataset.review}});
            row.remove();
          } catch (err) { showToast(err.message, "error"); }
        };
      });
    } catch (e) { container.innerHTML = errorBox(e); }
  }

  async function renderAccount() {
    state.currentMaster = null; renderHeader(); renderFooter();
    const app = $("#app"); app.innerHTML = loading();
    try {
      await loadMe();
      if (!state.me) { app.innerHTML = `<div class="auth-page"><div class="card">${errorBox({status:401})}</div></div>`; return; }
      const m = state.me;
      app.innerHTML = `
        <h1 class="page-title">Account</h1>
        <div class="two-col">
          <section class="card">
            <h2>Profile</h2>
            <form id="profile-form" class="form-grid">
              <label>Username <input id="username" value="${esc(m.username)}"></label>
              <label>Email <input id="email" type="email" value="${esc(m.email)}"></label>
              <button class="primary">Save profile</button>
              <div id="profile-status"></div>
            </form>
          </section>
          <section class="card">
            <h2>Avatar</h2>
            <div id="avatar-preview" class="profile-avatar-preview">${avatarHTML(m)}</div>
            <hr>
            <form id="avatar-form" class="form-grid">
              <label>Mode
                <select id="avatar-type"><option value="initials">Initials</option><option value="image">Image</option></select>
              </label>
              <div id="initials-controls">
                <label>Initials <input id="avatar-value" maxlength="2" value="${esc(m.avatar_value)}"></label>
                <label>Color <input id="avatar-color" type="color" value="${esc(m.avatar_color)}"></label>
                <label>Shape
                  <select id="avatar-shape" ${["manager","admin"].includes(m.role) ? "" : "disabled"}>
                    <option value="circle">Circle</option><option value="square">Square</option>
                  </select>
                </label>
                ${!["manager","admin"].includes(m.role) ? `<span class="muted">Square avatars are reserved for staff.</span>` : ""}
              </div>
              <div id="image-controls" hidden>
                <label>Image <input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
                <button type="button" id="upload-avatar">Upload image</button>
              </div>
              <button class="primary" id="save-avatar">Save avatar settings</button>
              <div id="avatar-status"></div>
            </form>
          </section>
        </div>
        <section class="card" style="margin-top:16px">
          <h2>Password</h2>
          <form id="password-form" class="form-grid">
            <label>Current password <input id="current-password" type="password" required></label>
            <label>New password <input id="new-password" type="password" required minlength="8"></label>
            <button class="primary">Change password</button>
            <div id="password-status"></div>
          </form>
        </section>
        ${["support","manager","admin"].includes(m.role) ? `
          <section class="card" style="margin-top:16px">
            <h2>Tag Requests</h2>
            <form id="tag-request-form" class="form-grid">
              <label>Request type <select id="request-type"><option value="master_tag">Master tag</option><option value="tag">Tag</option></select></label>
              <label>Proposed name <input id="proposed-name" required></label>
              <label>Parent master tag ID (tag only) <input id="parent-master-id" type="number"></label>
              <button class="primary">Submit request</button>
              <div id="tag-request-status"></div>
            </form>
            <div id="my-requests">${loading()}</div>
          </section>` : ""}
        ${["manager","admin"].includes(m.role) ? `
          <section class="card" style="margin-top:16px">
            <h2>Approvals</h2><div id="approvals">${loading()}</div>
          </section>` : ""}
        ${m.role === "admin" ? `<p><a href="/admin-raw">Admin Console</a></p>` : ""}`;
      wireAccount();
    } catch (e) { app.innerHTML = errorBox(e); }
  }

  function wireAccount() {
    $("#profile-form").onsubmit = async e => {
      e.preventDefault();
      const out = $("#profile-status"); out.textContent = "Saving…";
      try {
        state.me = await api("/account", {method:"PATCH", body:{username:$("#username").value, email:$("#email").value}});
        out.innerHTML = `<span class="success">Saved.</span>`; renderHeader();
      } catch (err) { out.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    };

    $("#avatar-type").onchange = e => {
      $("#initials-controls").hidden = e.target.value !== "initials";
      $("#image-controls").hidden = e.target.value !== "image";
      $("#save-avatar").hidden = e.target.value === "image";
    };
    $("#save-avatar").onclick = async e => {
      e.preventDefault();
      const out = $("#avatar-status");
      try {
        const shape = $("#avatar-shape").value;
        state.me = await api("/account/avatar", {method:"PATCH", body:{
          avatar_type:"initials",
          avatar_value:$("#avatar-value").value,
          avatar_shape:shape,
          avatar_color:$("#avatar-color").value
        }});
        out.innerHTML = `<span class="success">Avatar saved.</span>`;
        $("#avatar-preview").innerHTML = avatarHTML(state.me);
        renderHeader();
      } catch (err) { out.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    };
    $("#upload-avatar").onclick = async () => {
      const file = $("#avatar-file").files?.[0];
      if (!file) return;
      const fd = new FormData(); fd.append("avatar", file);
      try {
        state.me = await api("/account/avatar/upload", {method:"POST", body:fd});
        $("#avatar-status").innerHTML = `<span class="success">Image uploaded.</span>`;
        $("#avatar-preview").innerHTML = avatarHTML(state.me);
        renderHeader();
      } catch (err) { $("#avatar-status").innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    };
    $("#password-form").onsubmit = async e => {
      e.preventDefault();
      const out = $("#password-status"); out.textContent = "Saving…";
      try {
        await api("/account/password", {method:"PATCH", body:{
          current_password:$("#current-password").value,
          new_password:$("#new-password").value
        }});
        out.innerHTML = `<span class="success">Password changed.</span>`;
        e.target.reset();
      } catch (err) { out.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    };

    $("#tag-request-form")?.addEventListener("submit", async e => {
      e.preventDefault();
      const body = {request_type:$("#request-type").value, proposed_name:$("#proposed-name").value};
      if (body.request_type === "tag") body.parent_master_tag_id = Number($("#parent-master-id").value);
      try {
        await api("/tag-requests", {method:"POST", body});
        $("#tag-request-status").innerHTML = `<span class="success">Request submitted.</span>`;
        loadMyRequests();
      } catch (err) { $("#tag-request-status").innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    });
    loadMyRequests();
    loadApprovals();
  }

  async function loadMyRequests() {
    if (!$("#my-requests")) return;
    /*
     * TODO(API contract gap): There is no documented endpoint for a support
     * user to list their own requests. GET /tag-requests requires manager/admin.
     */
    $("#my-requests").innerHTML = `<p class="muted">Past-request list is unavailable: the contract documents only manager/admin GET /api/v1/tag-requests?status=….</p>`;
  }

  async function loadApprovals() {
    if (!$("#approvals")) return;
    try {
      const d = await api("/tag-requests?status=pending&limit=100&offset=0");
      $("#approvals").innerHTML = d.items?.length ? d.items.map(r => `
        <div class="card">
          <strong>${esc(r.proposed_name)}</strong> <span class="muted">#${r.id} · ${esc(r.request_type)}</span>
          <p>${r.parent_master_tag_id ? `Parent master #${r.parent_master_tag_id}` : ""}</p>
          <div class="row">
            <button data-approve="${r.id}">Approve</button>
            <button data-reject="${r.id}">Reject</button>
          </div>
        </div>`).join("") : `<div class="empty">No pending requests.</div>`;
      $("#approvals").querySelectorAll("[data-approve]").forEach(b => b.onclick = () => reviewRequest(b.dataset.approve, "approve"));
      $("#approvals").querySelectorAll("[data-reject]").forEach(b => b.onclick = () => reviewRequest(b.dataset.reject, "reject"));
    } catch (e) { $("#approvals").innerHTML = errorBox(e); }
  }

  async function reviewRequest(id, action) {
    try {
      await api(`/tag-requests/${encodeURIComponent(id)}/${action}`, {method:"POST", body:{}});
      loadApprovals();
    } catch (e) { showToast(e.message, "error"); }
  }

  function authLayout(title, body) {
    state.currentMaster = null; renderHeader(); renderFooter();
    $("#app").innerHTML = `<div class="auth-page"><div class="card"><h1 class="page-title">${title}</h1>${body}</div></div>`;
  }

  // Google OAuth is a full-page redirect (not an API fetch), so this just
  // builds the link; the backend owns the whole flow (state, token exchange,
  // user lookup/creation, session cookie) and redirects back to return_to.
  function googleButtonHTML() {
    const ret = new URLSearchParams(location.search).get("return_to") || "/";
    return `<a class="google-btn" href="/api/v1/auth/google?return_to=${encodeURIComponent(ret)}">
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z"/>
        <path fill="#FBBC05" d="M3.97 10.71A5.4 5.4 0 013.68 9c0-.59.1-1.17.29-1.71V4.96H.96A8.96 8.96 0 000 9c0 1.45.35 2.82.96 4.04l3.01-2.33z"/>
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
      </svg>
      Continue with Google
    </a>`;
  }

  function oauthErrorNotice() {
    const err = new URLSearchParams(location.search).get("error");
    if (err === "google_oauth_failed") return `<div class="notice error">Google sign-in failed. Please try again or use your email and password.</div>`;
    return "";
  }

  async function renderLogin() {
    authLayout("Log in", `
      ${oauthErrorNotice()}
      ${googleButtonHTML()}
      <div class="auth-divider"><span>or</span></div>
      <form id="login-form" class="form-grid">
        <label>Email <input id="email" type="email" required autocomplete="email"></label>
        <label>Password <input id="password" type="password" required autocomplete="current-password"></label>
        <button class="primary">Log in</button>
        <div id="login-status"></div>
      </form>
      <p><a href="/reset-password">Forgot password?</a></p>
      <p>New here? <a href="/register">Create an account</a></p>`);
    $("#login-form").onsubmit = async e => {
      e.preventDefault();
      const out = $("#login-status"); out.textContent = "Signing in…";
      try {
        const user = await api("/auth/login", {method:"POST", body:{email:$("#email").value,password:$("#password").value}});
        state.me = user;
        await postLoginNotices(user);
        const ret = new URLSearchParams(location.search).get("return_to") || "/";
        navigate(ret);
      } catch (err) {
        out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
      }
    };
  }

  async function renderRegister() {
    authLayout("Register", `
      <form id="register-form" class="form-grid">
        <label>Email <input id="email" type="email" required></label>
        <label>Username <input id="username" required></label>
        <label>Password <input id="password" type="password" minlength="8" required></label>
        <button class="primary">Register</button>
        <div id="register-status"></div>
      </form>
      <p>Already registered? <a href="/login">Log in</a></p>`);
    $("#register-form").onsubmit = async e => {
      e.preventDefault();
      const out = $("#register-status"); out.textContent = "Creating account…";
      try {
        const d = await api("/auth/register", {method:"POST", body:{
          email:$("#email").value, username:$("#username").value, password:$("#password").value
        }});
        out.innerHTML = `<span class="success">Account created. Check your email to verify it.</span>`;
        e.target.reset();
      } catch (err) { out.innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    };
  }

  async function renderVerify() {
    const token = new URLSearchParams(location.search).get("token") || "";
    authLayout("Verify email", `<div id="verify-status">${loading()}</div>`);
    try {
      await api(`/auth/verify?token=${encodeURIComponent(token)}`);
      $("#verify-status").innerHTML = `<p class="success">Email verified. <a href="/login">Log in</a>.</p>`;
    } catch (e) { $("#verify-status").innerHTML = errorBox(e); }
  }

  async function renderResetPassword() {
    const token = new URLSearchParams(location.search).get("token") || "";
    authLayout("Reset password", `
      <form id="reset-form" class="form-grid">
        <label>New password <input id="new-password" type="password" minlength="8" required></label>
        <button class="primary">Reset password</button>
        <div id="reset-status"></div>
      </form>
      <hr>
      <form id="reset-request-form" class="form-grid">
        <label>Request reset email <input id="reset-email" type="email" required></label>
        <button>Send reset email</button>
        <div id="request-status"></div>
      </form>`);
    $("#reset-form").onsubmit = async e => {
      e.preventDefault();
      try {
        await api("/auth/password-reset", {method:"POST", body:{token,new_password:$("#new-password").value}});
        $("#reset-status").innerHTML = `<span class="success">Password reset. <a href="/login">Log in</a>.</span>`;
      } catch (err) { $("#reset-status").innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    };
    $("#reset-request-form").onsubmit = async e => {
      e.preventDefault();
      try {
        await api("/auth/password-reset-request", {method:"POST", body:{email:$("#reset-email").value}});
        $("#request-status").innerHTML = `<span class="success">If the account exists, a reset email was sent.</span>`;
      } catch (err) { $("#request-status").innerHTML = `<span class="error">${esc(err.message)}</span>`; }
    };
  }

  async function renderSearch() {
    state.currentMaster = null; state.search = new URLSearchParams(location.search).get("q") || "";
    renderHeader(); renderFooter();
    const app = $("#app");
    app.innerHTML = `<h1 class="page-title">Search</h1><p class="muted">Query: ${esc(state.search)}</p><section id="feed" class="feed">${loading()}</section>`;
    await loadFeed($("#feed"), {search:state.search});
  }

  function renderLegal() {
    state.currentMaster = null; renderHeader(); renderFooter();
    $("#app").innerHTML = `<div class="auth-page"><div class="card">
      <h1 class="page-title">Legal / Cookies</h1>
      <p>This frontend uses the essential B1tm4p session cookie for authentication. No optional analytics cookie is introduced by this frontend.</p>
      <p>User-submitted content remains the responsibility of the submitting user. The administrator/operator does not assume responsibility for user-submitted content.</p>
      <p><a href="/">Back to B1tm4p</a></p>
    </div></div>`;
  }

  function renderNotFound() {
    renderHeader(); renderFooter();
    $("#app").innerHTML = `<div class="empty"><h1>404</h1><p>Page not found.</p><a href="/">Back home</a></div>`;
  }

  async function postLoginNotices(user) {
    const key = `b1tm4p_login_notice_${user.id}`;
    const dismissed = localStorage.getItem(key);
    if (dismissed) return;
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-backdrop"><section class="modal">
      <h2>Before you continue</h2>
      <p><strong>Essential session cookie:</strong> B1tm4p uses its session cookie to keep you signed in. It is required for authentication and is not an optional analytics cookie.</p>
      <p><strong>Legal notice:</strong> User-submitted content is the responsibility of the user who submits it. The administrator/operator does not assume responsibility for user-submitted content.</p>
      <button class="primary" id="notice-dismiss">Continue</button>
    </section></div>`;
    $("#notice-dismiss").onclick = () => {
      localStorage.setItem(key, String(Date.now()));
      root.innerHTML = "";
    };
  }

  window.addEventListener("popstate", route);
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("/admin-raw") || href === "/legal" || href.startsWith("/api/")) return;
    if (href.startsWith("/")) { e.preventDefault(); navigate(href); }
  });

  renderFooter();
  // Load master tags once up front so the header's master-tag select is
  // populated on every page, not just the ones that already fetch it.
  loadMasters().then(route, route);
})();