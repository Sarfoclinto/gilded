/* Fills the page from content.js (window.SITE). Anything left empty there is hidden here, so the page never shows a blank or a TODO. */
(function () {
  var S = window.SITE || {};
  var digits = function (v) {
    return String(v || "").replace(/\D/g, "");
  };
  var real = function (v) {
    return typeof v === "string"
      ? v.trim() !== "" && !/^TODO/i.test(v.trim())
      : !!v;
  };

  // values the page can use, including ones made from the facts
  var phoneDigits = digits(S.phone);
  var tel = function (d) {
    return d
      ? "tel:" + (d.charAt(0) === "0" ? "+233" + d.slice(1) : "+" + d)
      : "";
  };
  var V = {
    company: S.company,
    phone: S.phone,
    phone2: S.phone2,
    phone2Url: tel(digits(S.phone2)),
    email: S.email,
    hours: S.hours,
    licence: S.licence,
    about: S.about,
    whatsapp: S.whatsapp,
    appUrl: S.appUrl,
    phoneUrl: phoneDigits
      ? "tel:" +
        (phoneDigits.charAt(0) === "0"
          ? "+233" + phoneDigits.slice(1)
          : "+" + phoneDigits)
      : "",
    whatsappUrl: digits(S.whatsapp)
      ? "https://wa.me/" + digits(S.whatsapp)
      : "",
    whatsappLabel: digits(S.whatsapp)
      ? "+" +
        digits(S.whatsapp).replace(
          /^(\d{3})(\d{2})(\d{3})(\d+)$/,
          "$1 $2 $3 $4",
        )
      : "",
    emailUrl: real(S.email) ? "mailto:" + S.email : "",
  };

  document.querySelectorAll("[data-needs]").forEach(function (el) {
    if (!real(V[el.getAttribute("data-needs")])) el.hidden = true;
  });
  document.querySelectorAll("[data-needs-not]").forEach(function (el) {
    if (real(V[el.getAttribute("data-needs-not")])) el.hidden = true;
  });
  document.querySelectorAll("[data-text]").forEach(function (el) {
    var v = V[el.getAttribute("data-text")];
    if (real(v)) el.textContent = (el.getAttribute("data-prefix") || "") + v;
    else if (el.getAttribute("data-prefix") !== null || el.tagName === "SPAN")
      el.hidden = true;
  });
  document.querySelectorAll("[data-href]").forEach(function (el) {
    var v = V[el.getAttribute("data-href")];
    if (real(v)) el.setAttribute("href", v);
    if (/^https?:/.test(v || "") && el.getAttribute("data-href") !== "appUrl") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener");
    }
  });

  // about: paragraphs from blank lines
  var about = document.getElementById("about-text");
  if (about && real(S.about))
    S.about.split(/\n\s*\n/).forEach(function (p) {
      var e = document.createElement("p");
      e.textContent = p.trim();
      about.appendChild(e);
    });

  // branches
  var list = document.getElementById("branch-list");
  var branches = (S.branches || []).filter(function (b) {
    return real(b.name);
  });
  if (list) {
    if (!branches.length) {
      var li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Call or message us for the branch nearest to you.";
      list.appendChild(li);
    }
    branches.forEach(function (b) {
      var li = document.createElement("li");
      var h = document.createElement("h3");
      h.textContent = b.name;
      li.appendChild(h);
      if (real(b.area)) {
        var a = document.createElement("p");
        a.className = "area";
        a.textContent = b.area;
        li.appendChild(a);
      }
      if (real(b.address)) {
        var ad = document.createElement("p");
        ad.textContent = b.address;
        li.appendChild(ad);
      }
      if (real(b.hours)) {
        var ho = document.createElement("p");
        ho.className = "muted";
        ho.textContent = b.hours;
        li.appendChild(ho);
      }
      var links = document.createElement("p");
      links.className = "links";
      if (real(b.phone)) {
        var t = document.createElement("a");
        var d = digits(b.phone);
        t.href = "tel:" + (d.charAt(0) === "0" ? "+233" + d.slice(1) : "+" + d);
        t.textContent = b.phone;
        links.appendChild(t);
      }
      if (real(b.mapUrl)) {
        var m = document.createElement("a");
        m.href = b.mapUrl;
        m.target = "_blank";
        m.rel = "noopener";
        m.textContent = "Directions";
        links.appendChild(m);
      }
      if (links.childNodes.length) li.appendChild(links);
      list.appendChild(li);
    });
  }

  var y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
  if (real(S.description)) {
    var md = document.querySelector("meta[name=description]");
    if (md) md.setAttribute("content", S.description);
  }

  // phone menu
  var btn = document.querySelector(".menu-btn");
  var nav = document.getElementById("nav");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Close" : "Menu";
    });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "Menu";
      });
    });
  }
})();
