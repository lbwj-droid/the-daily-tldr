// Renders one edition: the published JSON plus the editor's live changes from the Google Sheet.
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var reader = (params.get("r") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
  try {
    if (reader) localStorage.setItem("reader", reader);
    else reader = localStorage.getItem("reader") || "";
  } catch (e) {}

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };
  var safeUrl = function (u) { return /^https?:\/\//i.test(u || "") ? u : null; };
  var linkTo = function (date) {
    var q = new URLSearchParams();
    if (date) q.set("d", date);
    if (reader) q.set("r", reader);
    var s = q.toString();
    return "/" + (s ? "?" + s : "");
  };
  var getJson = function (url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  };
  var longDate = function (d) {
    return new Date(d + "T12:00:00+05:30").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  };
  var shortDate = function (d, latest) {
    if (d === latest) return "Today";
    return new Date(d + "T12:00:00+05:30").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  };

  function track(item, date) {
    try {
      var body = JSON.stringify({ r: reader, date: date, section: item.section, headline: item.headline, url: item.url });
      navigator.sendBeacon("/api/click", new Blob([body], { type: "application/json" }));
    } catch (e) {}
  }

  // Applies the Sheet: my_headline replaces the AI headline, status hides or promotes, typed-in rows are added.
  function merge(edition, ov) {
    var all = [];
    if (edition.lead) all.push(edition.lead);
    edition.sections.forEach(function (s) { s.items.forEach(function (i) { all.push(i); }); });
    var o = (ov && ov.overrides) || {};
    var promoted = null;
    all.forEach(function (i) {
      var c = o[i.id];
      if (!c) return;
      if (c.headline) i.headline = c.headline;
      if (c.status === "hide") i.hidden = true;
      if (c.status === "lead") promoted = i;
    });
    ((ov && ov.added) || []).forEach(function (a) {
      if (a.section === "lead") { promoted = a; return; }
      var s = edition.sections.filter(function (x) { return x.key === a.section; })[0] || edition.sections[0];
      a.section = s.key;
      s.items.push(a);
    });
    if (promoted) {
      if (edition.lead && edition.lead !== promoted) {
        var old = edition.lead;
        var home = edition.sections.filter(function (x) { return x.items.indexOf(promoted) >= 0; })[0];
        if (home) home.items.splice(home.items.indexOf(promoted), 1, Object.assign(old, { section: home.key }));
        else edition.sections[0].items.unshift(Object.assign(old, { section: edition.sections[0].key }));
      } else if (!edition.lead) {
        edition.sections.forEach(function (s) { var k = s.items.indexOf(promoted); if (k >= 0) s.items.splice(k, 1); });
      }
      promoted.section = "lead";
      edition.lead = promoted;
    }
    // Pinned links go to the top of their section, every day, ahead of the day's picks.
    ((ov && ov.pinned) || []).slice().reverse().forEach(function (p) {
      var s = edition.sections.filter(function (x) { return x.key === p.section; })[0];
      if (!s || (edition.lead && edition.lead.url === p.url)) return;
      edition.sections.forEach(function (x) { x.items = x.items.filter(function (i) { return i.url !== p.url; }); });
      s.items.unshift(p);
    });
    if (edition.lead && edition.lead.hidden) edition.lead = null;
    edition.sections.forEach(function (s) { s.items = s.items.filter(function (i) { return !i.hidden; }); });
    return edition;
  }

  function itemNode(item, date, withImage, isLead) {
    var wrap = el(isLead ? "div" : "li");
    var url = safeUrl(item.url);
    if (withImage && safeUrl(item.thumbnail)) {
      var img = el("img", { src: item.thumbnail, alt: "", loading: isLead ? "eager" : "lazy", referrerpolicy: "no-referrer" });
      img.onerror = function () { img.remove(); };
      wrap.appendChild(img);
    }
    var a = el("a", { class: "headline", href: url || "#", target: "_blank", rel: "noopener" }, item.headline);
    a.addEventListener("click", function () { track(item, date); });
    wrap.appendChild(a);

    var meta = el("div", { class: "meta" });
    if (item.pinned) meta.appendChild(el("span", { class: "pin" }, "Start here"));
    if (item.tag) meta.appendChild(el("span", { class: "tag" }, "[" + item.tag + "]"));
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

  function render(edition, index) {
    var page = $("page");
    page.textContent = "";
    $("dateline").textContent = longDate(edition.date);

    if (edition.lead) {
      var lead = el("section", { class: "lead", "aria-label": "Top story" });
      lead.appendChild(itemNode(edition.lead, edition.date, true, true));
      page.appendChild(lead);
    }
    var band = el("div", { class: "focus-band" });
    var grid = el("div", { class: "sections" });
    edition.sections.forEach(function (s) {
      if (!s.items.length) return;
      var sec = el("section", { class: s.focus ? "section focus" : "section", "aria-labelledby": "h-" + s.key });
      var h = el("h2", { id: "h-" + s.key }, s.title);
      if (s.focus && s.day) h.appendChild(el("span", { class: "day" }, "Day " + s.day + " of " + s.days));
      sec.appendChild(h);
      var ul = el("ul");
      s.items.forEach(function (item, n) { ul.appendChild(itemNode(item, edition.date, n === 0, false)); });
      sec.appendChild(ul);
      (s.focus ? band : grid).appendChild(sec);
    });
    if (band.childNodes.length) page.appendChild(band);
    page.appendChild(grid);

    var all = [edition.lead].concat.apply([], edition.sections.map(function (s) { return s.items; }));
    var needsHelp = all.some(function (i) { return i && i.helpline; });
    $("helpline").hidden = !needsHelp;
    $("helpline").textContent = index.helpline || "";
    $("footnote").textContent = index.footerNote || "";
    document.title = (index.siteName || "The Daily TL;DR") + " · " + shortDate(edition.date, index.latest);
  }

  function renderDays(index, current) {
    var nav = $("days");
    nav.textContent = "";
    index.dates.forEach(function (d) {
      var a = el("a", { href: linkTo(d === index.latest ? "" : d) }, shortDate(d, index.latest));
      if (d === current) a.setAttribute("aria-current", "page");
      nav.appendChild(a);
    });
  }

  $("home").setAttribute("href", linkTo(""));
  var standalone = window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
  if (/iPhone|iPad/.test(navigator.userAgent) && !standalone) $("install-hint").hidden = false;

  getJson("/data/index.json")
    .then(function (index) {
      var wanted = params.get("d");
      var date = index.dates.indexOf(wanted) >= 0 ? wanted : index.latest;
      renderDays(index, date);
      return Promise.all([
        getJson("/data/editions/" + date + ".json"),
        getJson("/api/overrides?date=" + date).catch(function () { return null; }),
      ]).then(function (r) { render(merge(r[0], r[1]), index); });
    })
    .catch(function () {
      $("status").textContent = "Couldn't load the page. Pull down to try again.";
    });
})();
