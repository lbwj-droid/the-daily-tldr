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
  // Links to the editor's "TL;DR uploads" Drive folder: a Google Doc opens as a page on this site, and any other Drive
  // file (an image) is served by /api/media, so it also works as a thumbnail.
  var driveId = function (u) {
    var m = String(u || "").match(/^https:\/\/(?:drive|docs)\.google\.com\/(?:.*?\/d\/([\w-]{20,})|.*?[?&]id=([\w-]{20,}))/);
    return m ? m[1] || m[2] : "";
  };
  var siteLink = function (u) {
    var id = driveId(u);
    if (!id) return safeUrl(u);
    return /docs\.google\.com\/document\//.test(u) ? "/p/" + id : "/api/media?id=" + id;
  };
  var imageSrc = function (u) { return driveId(u) ? "/api/media?id=" + driveId(u) : safeUrl(u); };
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
  // The arc as the issue spells it, "new" for a possible new storyline, or undefined.
  function arcName(edition, value) {
    var v = String(value || "").trim().toLowerCase();
    if (!v || v === "none" || v === "-") return undefined;
    if (v === "new" || v === "new story to watch") return "new";
    var hit = (edition.arcs || []).filter(function (a) { return a.name.toLowerCase() === v; })[0];
    return hit ? hit.name : undefined;
  }

  function merge(edition, ov) {
    var sections = edition.sections;
    var keys = sections.map(function (s) { return s.key; });
    // A section typed in the Sheet matches a section key or title ("World", "editor's picks"); anything else, such as a
    // section that is switched off, goes to Editor's Picks.
    var sectionKey = function (v) {
      var want = String(v || "").toLowerCase().replace(/[^a-z]/g, "");
      if (!want) return "";
      if (want === "lead") return "lead";
      if (want.indexOf("editor") === 0 || want === "picks" || want === "pick") return "picks";
      var hit = sections.filter(function (s) { return s.key === want || s.title.toLowerCase().replace(/[^a-z]/g, "") === want; })[0];
      return hit ? hit.key : "picks";
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
        item = { added: true, id: row.id || "add-" + ++added, url: row.url, headline: row.my_headline, source: row.source || new URL(row.url).hostname.replace(/^www\./, ""), section: "picks", rank: 99 };
        all.push(item);
      }
      if (row.my_headline) item.headline = row.my_headline;
      // The build copies each link's own image into the Sheet; only an image the editor typed in shows on any link.
      if (safeUrl(row.thumbnail)) {
        if (row.thumbnail !== item.thumbnail) item.sheetImage = true;
        item.thumbnail = row.thumbnail;
      }
      if (row.status === "hide") item.hidden = true;
      var target = sectionKey(row.section);
      if ((row.status === "lead" || target === "lead") && !item.isLead) promoted = item;
      else if (item.isLead && target && target !== "lead") demoteLead = target;
      else if (target && target !== "lead") item.section = target;
      if (row.rank !== "" && !isNaN(Number(row.rank))) item.rank = Number(row.rank);
      item.important = yes(row.important);
      item.for = slug(row.for) || undefined;
      // The arc column: a name from the Arcs tab, "new", or blank (no label).
      if (row.arc !== undefined) item.arc = arcName(edition, row.arc);
    });

    // The lead: a promoted link replaces it, and the replaced lead leaves the page (to keep it, give it a section in the
    // Sheet).
    var lead = edition.lead;
    if (lead && lead.hidden) lead = null;
    if (demoteLead && lead) { lead.isLead = false; lead.section = demoteLead; lead = null; }
    if (promoted) {
      if (lead) { lead.isLead = false; lead.hidden = true; }
      promoted.isLead = true;
      lead = promoted;
    }

    // Rebuild the sections from the merged links: pinned first, then by rank. An image set in the Sheet shows on any link.
    var bucket = {};
    all.forEach(function (i) {
      if (i.isLead || i.hidden) return;
      var key = keys.indexOf(i.section) < 0 ? "picks" : i.section;
      if (key === "picks" && keys.indexOf("picks") < 0) {
        sections.unshift({ key: "picks", title: "Editor's Picks", editor: true, items: [] });
        keys.unshift("picks");
      }
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

  // NEW marks links the editor added in the Sheet after the issue was built, until this phone has shown them once.
  // The seen list is read once per page load, so a link stays NEW while it is on screen. Preview always shows it.
  var seenAtLoad = {};
  var readSeen = function (date) {
    try { return JSON.parse(localStorage.getItem("seen-" + date) || "[]"); } catch (e) { return []; }
  };
  var isNew = function (item, date) {
    if (!item.added) return false;
    if (preview) return true;
    if (!seenAtLoad[date]) seenAtLoad[date] = readSeen(date);
    return seenAtLoad[date].indexOf(item.url) < 0;
  };
  var markSeen = function (items, date) {
    if (preview) return;
    var seen = readSeen(date);
    items.forEach(function (i) { if (i.added && seen.indexOf(i.url) < 0) seen.push(i.url); });
    try { localStorage.setItem("seen-" + date, JSON.stringify(seen)); } catch (e) {}
  };

  // Personal links (the "for" column) show only on that reader's page; preview shows them all.
  var visible = function (i) { return i && (!i.for || preview || i.for === reader); };

  // The arc label under a link: tapping it shows the arc's "story so far" line.
  function arcNode(item, edition, wrap) {
    if (item.arc === "new") return el("span", { class: "arc new-arc" }, "New story to watch");
    var arc = (edition.arcs || []).filter(function (a) { return a.name === item.arc; })[0];
    if (!arc) return null;
    // The primer link itself carries no "Start here" line under its label.
    var primer = arc.primer && safeUrl(arc.primer.url) && arc.primer.url !== item.url ? arc.primer : null;
    if (!arc.so_far && !primer) return el("span", { class: "arc" }, arc.name);
    var btn = el("button", { class: "arc", type: "button", "aria-expanded": "false" }, arc.name);
    var line = el("div", { class: "so-far", hidden: "" });
    if (arc.so_far) {
      var p = el("p");
      p.appendChild(el("b", null, "The story so far: "));
      p.appendChild(document.createTextNode(arc.so_far));
      line.appendChild(p);
    }
    if (primer) {
      var sp = el("p", { class: "primer" });
      sp.appendChild(el("b", null, "Start here: "));
      var purl = siteLink(primer.url);
      var pa = el("a", { href: purl, target: purl.charAt(0) === "/" ? null : "_blank", rel: "noopener" }, primer.headline);
      pa.addEventListener("click", function () { track({ section: "primer", headline: primer.headline, url: primer.url }, edition.date); });
      sp.appendChild(pa);
      if (primer.kind === "video" || primer.source) sp.appendChild(document.createTextNode(" (" + (primer.kind === "video" ? "video, " : "") + (primer.source || "") + ")"));
      line.appendChild(sp);
    }
    btn.addEventListener("click", function () {
      line.hidden = !line.hidden;
      btn.setAttribute("aria-expanded", String(!line.hidden));
    });
    wrap.soFar = line;
    return btn;
  }

  // The "?" button: a one-line question about this link, stored in the Questions tab for Uncle Lester.
  function askNode(item, date, wrap) {
    var btn = el("button", { class: "ask", type: "button", "aria-expanded": "false", "aria-label": "Ask a question about this story" }, "? Ask");
    var form = el("form", { class: "ask-form", hidden: "" });
    var box = el("textarea", { rows: "2", maxlength: "500", placeholder: "What would you like Uncle Lester to explain?", "aria-label": "Your question" });
    var send = el("button", { type: "submit" }, "Send");
    var note = el("p", { class: "ask-note", "aria-live": "polite" });
    form.appendChild(box);
    form.appendChild(send);
    form.appendChild(note);
    btn.addEventListener("click", function () {
      form.hidden = !form.hidden;
      btn.setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) box.focus();
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var q = box.value.trim();
      if (q.length < 2) return;
      send.disabled = true;
      note.textContent = "Sending…";
      fetch("/api/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ r: reader, date: date, section: item.section, headline: item.headline, url: item.url, question: q }),
      })
        .then(function (r) { if (!r.ok) throw new Error(r.status); })
        .then(function () {
          box.value = "";
          box.hidden = true;
          send.hidden = true;
          note.textContent = "Sent. Uncle Lester answers questions in the next issues.";
        })
        .catch(function () {
          send.disabled = false;
          note.textContent = "Couldn't send. Try again in a minute.";
        });
    });
    wrap.askForm = form;
    return btn;
  }

  function itemNode(item, date, withImage, isLead, edition) {
    var wrap = el(isLead ? "div" : "li");
    var url = siteLink(item.url);
    if (withImage && imageSrc(item.thumbnail)) {
      var img = el("img", { src: imageSrc(item.thumbnail), alt: "", loading: isLead ? "eager" : "lazy", referrerpolicy: "no-referrer" });
      img.onerror = function () { img.remove(); };
      wrap.appendChild(img);
    }
    var internal = url && url.charAt(0) === "/";
    var a = el("a", { class: "headline" + (item.important && !isLead ? " important" : ""), href: url || "#", target: internal ? null : "_blank", rel: internal ? null : "noopener" }, item.headline);
    a.addEventListener("click", function () { track(item, date); });
    wrap.appendChild(a);

    var meta = el("div", { class: "meta" });
    if (isNew(item, date)) meta.appendChild(el("span", { class: "new" }, "New"));
    if (item.pinned) meta.appendChild(el("span", { class: "pin" }, "Start here"));
    if (item.important && !isLead) meta.appendChild(el("span", { class: "imp" }, "Important"));
    if (item.for) meta.appendChild(el("span", { class: "for" }, preview ? "For " + item.for : "Just for you"));
    // Preview only: Claude's must-not-miss picks beyond the issue's room, for the editor to keep or hide.
    if (item.extra && preview) meta.appendChild(el("span", { class: "for" }, "Extra pick"));
    if (item.tag) meta.appendChild(el("span", { class: "tag" }, "[" + item.tag + "]"));
    if (item.subscriber) meta.appendChild(el("span", { class: "tag sub" }, "[subscriber]"));
    var arc = item.arc ? arcNode(item, edition, wrap) : null;
    if (arc) meta.appendChild(arc);
    meta.appendChild(el("span", null, (item.kind === "video" ? "▶ Video · " : "") + (item.source || "")));
    var ask = (edition.arcs || []).length ? askNode(item, date, wrap) : null;
    if (item.original_headline && item.original_headline !== item.headline) {
      var btn = el("button", { class: "orig", type: "button", "aria-expanded": "false" }, "orig");
      var orig = el("p", { class: "original", hidden: "" }, "Original: “" + item.original_headline + "”");
      btn.addEventListener("click", function () {
        var open = orig.hidden;
        orig.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
      });
      meta.appendChild(btn);
      if (ask) meta.appendChild(ask);
      wrap.appendChild(meta);
      wrap.appendChild(orig);
    } else {
      if (ask) meta.appendChild(ask);
      wrap.appendChild(meta);
    }
    if (wrap.soFar) wrap.appendChild(wrap.soFar);
    if (wrap.askForm) wrap.appendChild(wrap.askForm);
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
        var deskUrl = siteLink(desk.url);
        var dl = el("a", { href: deskUrl, target: deskUrl.charAt(0) === "/" ? null : "_blank", rel: "noopener" }, desk.teaser || "Read this issue's notes");
        dl.addEventListener("click", function () { track({ section: "desk", headline: desk.teaser, url: desk.url }, edition.date); });
        box.appendChild(dl);
      } else {
        box.appendChild(el("p", null, desk.teaser));
      }
      // The optional note column: a plain explanatory line under the teaser.
      if (desk.note) box.appendChild(el("p", { class: "desk-note" }, desk.note));
      page.appendChild(box);
    }

    // The fortnightly recap: what changed on each story arc, and one question to test yourself (tap for the answer).
    if (edition.recap && edition.recap.arcs && edition.recap.arcs.length) {
      var rc = el("section", { class: "recap", "aria-labelledby": "h-recap" });
      rc.appendChild(el("h2", { id: "h-recap" }, "The last two weeks, in brief"));
      edition.recap.arcs.forEach(function (r) {
        var block = el("div", { class: "recap-arc" });
        block.appendChild(el("h3", null, r.arc));
        block.appendChild(el("p", null, r.changed));
        var q = el("p", { class: "recap-q" });
        q.appendChild(el("b", null, "Test yourself: "));
        q.appendChild(document.createTextNode(r.question + " "));
        var reveal = el("button", { class: "reveal", type: "button", "aria-expanded": "false" }, "Show answer");
        var answer = el("span", { class: "recap-a", hidden: "" }, r.answer);
        reveal.addEventListener("click", function () {
          answer.hidden = false;
          reveal.hidden = true;
          reveal.setAttribute("aria-expanded", "true");
        });
        q.appendChild(reveal);
        q.appendChild(answer);
        block.appendChild(q);
        rc.appendChild(block);
      });
      page.appendChild(rc);
    }

    if (visible(edition.lead)) {
      var lead = el("section", { class: "lead", "aria-label": "Top story" });
      lead.appendChild(itemNode(edition.lead, edition.date, true, true, edition));
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
      items.forEach(function (item, n) { ul.appendChild(itemNode(item, edition.date, n === 0 || item.sheetImage, false, edition)); });
      sec.appendChild(ul);
      (s.focus || s.editor ? top : grid).appendChild(sec);
    });
    if (top.childNodes.length) page.appendChild(top);
    page.appendChild(grid);

    var all = [edition.lead].concat.apply([], edition.sections.map(function (s) { return s.items; })).filter(visible);
    markSeen(all, edition.date);
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
