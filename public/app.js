// Renders one issue: the published JSON plus the editor's live changes from the Google Sheet.
// ?r=name identifies the reader (personal links, click log). ?d=YYYY-MM-DD opens an older issue.
// ?preview=1 shows an issue before its 07:30 release, with every reader's personal links.
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var preview = params.has("preview");
  var reader = (params.get("r") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
  try {
    if (reader) localStorage.setItem("reader", reader);
    else reader = localStorage.getItem("reader") || "";
  } catch (e) {}

  var tz = "Asia/Dubai";
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };
  var yes = function (v) { return /^(y|yes|true|1|x)$/i.test(String(v || "").trim()); };
  var slug = function (v) { return String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, ""); };
  var safeUrl = function (u) { return /^https?:\/\//i.test(u || "") ? u : null; };
  var linkTo = function (date) {
    var q = new URLSearchParams();
    if (date) q.set("d", date);
    if (reader) q.set("r", reader);
    if (preview) q.set("preview", "1");
    var s = q.toString();
    return "/" + (s ? "?" + s : "");
  };
  var getJson = function (url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  };
  var noon = function (d) { return new Date(d + "T12:00:00Z"); };
  var longDate = function (d) {
    return noon(d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  };
  var shortDate = function (d, latest) {
    if (d === latest) return "Latest";
    return noon(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  };
  var released = function (e) { return preview || !e.publish_at || Date.parse(e.publish_at) <= Date.now(); };

  function track(item, date) {
    try {
      var body = JSON.stringify({ r: reader, date: date, section: item.section, headline: item.headline, url: item.url });
      navigator.sendBeacon("/api/click", new Blob([body], { type: "application/json" }));
    } catch (e) {}
  }

  // Applies the Sheet on top of the published issue: headlines, hide, lead, section and rank moves, important, for,
  // rows typed in by hand, and pinned rows.
  function merge(edition, ov) {
    var sections = edition.sections;
    var keys = sections.map(function (s) { return s.key; });
    var homeOf = function (item) {
      if (item.home && keys.indexOf(item.home) >= 0) return item.home;
      var regular = sections.filter(function (s) { return !s.focus && !s.editor; })[0] || sections[0];
      return regular ? regular.key : null;
    };
    var all = [];
    if (edition.lead) { edition.lead.isLead = true; all.push(edition.lead); }
    sections.forEach(function (s) { s.items.forEach(function (i) { i.section = s.key; all.push(i); }); });

    var promoted = null;
    var demoteLead = null;
    var added = 0;
    ((ov && ov.rows) || []).forEach(function (row) {
      var item = all.filter(function (i) { return (row.id && i.id === row.id) || (row.url && i.url === row.url); })[0];
      if (!item) {
        if (!safeUrl(row.url) || !row.my_headline || row.status === "hide") return;
        item = { id: row.id || "add-" + ++added, url: row.url, headline: row.my_headline, source: row.source || new URL(row.url).hostname.replace(/^www\./, ""), section: "picks", rank: 99 };
        all.push(item);
      }
      if (row.my_headline) item.headline = row.my_headline;
      if (safeUrl(row.thumbnail)) item.thumbnail = row.thumbnail;
      if (row.status === "hide") item.hidden = true;
      var target = row.section === "editors" || row.section === "editorspicks" ? "picks" : row.section;
      if ((row.status === "lead" || target === "lead") && !item.isLead) promoted = item;
      else if (item.isLead && target && target !== "lead") demoteLead = target;
      else if (target && target !== "lead") item.section = target;
      if (row.rank !== "" && !isNaN(Number(row.rank))) item.rank = Number(row.rank);
      item.important = yes(row.important);
      item.for = slug(row.for) || undefined;
    });

    // The lead: a promoted link replaces it, and the old lead goes back to its own section.
    var lead = edition.lead;
    if (lead && lead.hidden) lead = null;
    if (demoteLead && lead) { lead.isLead = false; lead.section = demoteLead; lead = null; }
    if (promoted) {
      if (lead) { lead.isLead = false; lead.section = homeOf(lead); }
      promoted.isLead = true;
      lead = promoted;
    }

    // Rebuild the sections from the merged links: pinned first, then by rank.
    var bucket = {};
    all.forEach(function (i) {
      if (i.isLead || i.hidden) return;
      var key = i.section;
      if (key === "picks" && keys.indexOf("picks") < 0) {
        sections.unshift({ key: "picks", title: "Editor's Picks", editor: true, items: [] });
        keys.unshift("picks");
      }
      if (keys.indexOf(key) < 0) key = homeOf(i);
      (bucket[key] = bucket[key] || []).push(i);
    });
    ((ov && ov.pinned) || []).forEach(function (p) {
      if (keys.indexOf(p.section) < 0 || (lead && lead.url === p.url)) return;
      var list = bucket[p.section] = bucket[p.section] || [];
      for (var k = list.length - 1; k >= 0; k--) if (list[k].url === p.url) list.splice(k, 1);
      list.push(p);
    });
    sections.forEach(function (s) {
      s.items = (bucket[s.key] || []).map(function (i, n) { return { i: i, n: n }; }).sort(function (a, b) {
        var pa = a.i.pinned ? 0 : 1, pb = b.i.pinned ? 0 : 1;
        if (pa !== pb) return pa - pb;
        var ra = a.i.rank == null ? 99 : a.i.rank, rb = b.i.rank == null ? 99 : b.i.rank;
        return ra - rb || a.n - b.n;
      }).map(function (x) { return x.i; });
    });
    edition.lead = lead;
    return edition;
  }

  // Personal links (the "for" column) show only on that reader's page; preview shows them all.
  var visible = function (i) { return i && (!i.for || preview || i.for === reader); };

  function itemNode(item, date, withImage, isLead) {
    var wrap = el(isLead ? "div" : "li");
    var url = safeUrl(item.url);
    if (withImage && safeUrl(item.thumbnail)) {
      var img = el("img", { src: item.thumbnail, alt: "", loading: isLead ? "eager" : "lazy", referrerpolicy: "no-referrer" });
      img.onerror = function () { img.remove(); };
      wrap.appendChild(img);
    }
    var a = el("a", { class: "headline" + (item.important && !isLead ? " important" : ""), href: url || "#", target: "_blank", rel: "noopener" }, item.headline);
    a.addEventListener("click", function () { track(item, date); });
    wrap.appendChild(a);

    var meta = el("div", { class: "meta" });
    if (item.pinned) meta.appendChild(el("span", { class: "pin" }, "Start here"));
    if (item.important && !isLead) meta.appendChild(el("span", { class: "imp" }, "Important"));
    if (item.for) meta.appendChild(el("span", { class: "for" }, preview ? "For " + item.for : "Just for you"));
    if (item.tag) meta.appendChild(el("span", { class: "tag" }, "[" + item.tag + "]"));
    if (item.subscriber) meta.appendChild(el("span", { class: "tag sub" }, "[subscriber]"));
    meta.appendChild(el("span", null, (item.kind === "video" ? "▶ Video · " : "") + (item.source || "")));
    if (item.original_headline && item.original_headline !== item.headline) {
      var btn = el("button", { class: "orig", type: "button", "aria-expanded": "false" }, "orig");
      var orig = el("p", { class: "original", hidden: "" }, "Original: “" + item.original_headline + "”");
      btn.addEventListener("click", function () {
        var open = orig.hidden;
        orig.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
      });
      meta.appendChild(btn);
      wrap.appendChild(meta);
      wrap.appendChild(orig);
    } else {
      wrap.appendChild(meta);
    }
    return wrap;
  }

  function render(edition, index, entry, ov) {
    var page = $("page");
    page.textContent = "";
    $("dateline").textContent = longDate(edition.date) + (edition.issue ? " · Issue " + edition.issue : "");

    if (preview && entry.publish_at && Date.parse(entry.publish_at) > Date.now()) {
      var when = new Date(entry.publish_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
      page.appendChild(el("p", { class: "preview" }, "PREVIEW: readers see this issue from " + when + " Dubai time."));
    }

    var desk = (ov && ov.desk) || edition.desk;
    if (desk && (safeUrl(desk.url) || desk.teaser)) {
      var box = el("section", { class: "desk", "aria-label": "Notes from the news desk" });
      box.appendChild(el("h2", null, "Notes from the news desk"));
      if (safeUrl(desk.url)) {
        var dl = el("a", { href: desk.url, target: "_blank", rel: "noopener" }, desk.teaser || "Read this issue's notes");
        dl.addEventListener("click", function () { track({ section: "desk", headline: desk.teaser, url: desk.url }, edition.date); });
        box.appendChild(dl);
      } else {
        box.appendChild(el("p", null, desk.teaser));
      }
      page.appendChild(box);
    }

    if (visible(edition.lead)) {
      var lead = el("section", { class: "lead", "aria-label": "Top story" });
      lead.appendChild(itemNode(edition.lead, edition.date, true, true));
      page.appendChild(lead);
    }

    var top = el("div", { class: "focus-band" });
    var grid = el("div", { class: "sections" });
    edition.sections.forEach(function (s) {
      var items = s.items.filter(visible);
      if (!items.length) return;
      var cls = "section" + (s.focus ? " focus" : "") + (s.editor ? " editor" : "");
      var sec = el("section", { class: cls, "aria-labelledby": "h-" + s.key });
      var h = el("h2", { id: "h-" + s.key }, s.title);
      if (s.focus && s.day) h.appendChild(el("span", { class: "day" }, "Week " + Math.ceil(s.day / 7) + " of " + Math.ceil(s.days / 7)));
      sec.appendChild(h);
      var ul = el("ul");
      items.forEach(function (item, n) { ul.appendChild(itemNode(item, edition.date, n === 0, false)); });
      sec.appendChild(ul);
      (s.focus || s.editor ? top : grid).appendChild(sec);
    });
    if (top.childNodes.length) page.appendChild(top);
    page.appendChild(grid);

    var all = [edition.lead].concat.apply([], edition.sections.map(function (s) { return s.items; })).filter(visible);
    $("helpline").hidden = !all.some(function (i) { return i.helpline; });
    $("helpline").textContent = index.helpline || "";
    $("footnote").textContent = index.footerNote || "";
    document.title = (index.siteName || "The Daily TL;DR") + (edition.issue ? " · Issue " + edition.issue : "");
  }

  function renderDays(list, current) {
    var nav = $("days");
    nav.textContent = "";
    list.forEach(function (e, n) {
      var a = el("a", { href: linkTo(n === 0 ? "" : e.date) }, shortDate(e.date, list[0].date));
      if (e.date === current) a.setAttribute("aria-current", "page");
      nav.appendChild(a);
    });
  }

  $("home").setAttribute("href", linkTo(""));
  var standalone = window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
  if (/iPhone|iPad/.test(navigator.userAgent) && !standalone) $("install-hint").hidden = false;

  getJson("/data/index.json")
    .then(function (index) {
      tz = index.timezone || tz;
      var list = (index.editions || (index.dates || []).map(function (d) { return { date: d }; })).filter(released);
      if (!list.length) throw new Error("no released issue");
      var wanted = params.get("d");
      var entry = list.filter(function (e) { return e.date === wanted; })[0] || list[0];
      renderDays(list, entry.date);
      return Promise.all([
        getJson("/data/editions/" + entry.date + ".json"),
        getJson("/api/overrides?date=" + entry.date).catch(function () { return null; }),
      ]).then(function (r) { render(merge(r[0], r[1]), index, entry, r[1]); });
    })
    .catch(function () {
      $("status").textContent = "Couldn't load the page. Pull down to try again.";
    });
})();
