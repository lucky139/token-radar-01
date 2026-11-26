// Token Launch Radar page. No network: all data comes from data.js beside
// the output. The value model below is the same formula as lib/model.ts, so
// the page recomputes every row and must agree with board.json exactly:
//   implied = TVL x 0.35 x growth(7d) x age(no-token years) x chains
// growth is the 7-day change clamped to -50..+100% at half weight; age adds
// 8% a year capped at 5 years; chains add 2% each capped at 10 chains.
(function () {
  "use strict";
  var D = window.RADAR_DATA;
  var root = document.getElementById("rows");
  if (!D || !D.rows) {
    root.innerHTML = "<tr><td colspan=8>Data not loaded. Open the built output dashboard.</td></tr>";
    return;
  }
  var AS_OF = D.as_of;

  function ageYears(listedAt) {
    if (!listedAt) return 0;
    var s = Date.parse(listedAt + "T00:00:00Z"), e = Date.parse(AS_OF + "T00:00:00Z");
    if (!isFinite(s) || !isFinite(e) || e <= s) return 0;
    return (e - s) / 86400000 / 365.25;
  }
  function growthFactor(c) {
    if (c === null || c === undefined || !isFinite(c)) return 1;
    var x = Math.max(-50, Math.min(100, c));
    return 1 + (x / 100) * 0.5;
  }
  function chainFactor(chains) {
    return 1 + 0.02 * Math.min(new Set(chains).size, 10);
  }
  function ageFactor(age) {
    return 1 + 0.08 * Math.min(Math.max(age, 0), 5);
  }
  function impliedValue(r) {
    return Math.max(1, Math.round(
      r.tvl_usd * 0.35 * growthFactor(r.change_7d) *
      ageFactor(ageYears(r.listed_at)) * chainFactor(r.chains)));
  }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Recompute check: same ranking + strict-decrease rule as the builder.
  // window.RADAR_DEVIATION must be 0; the page shows recomputed values.
  var rescored = D.rows.map(function (r) { return { slug: r.slug, v: impliedValue(r) }; });
  rescored.sort(function (a, b) { return b.v - a.v || (a.slug < b.slug ? -1 : 1); });
  var prev = Infinity, dev = 0, recomputed = {};
  rescored.forEach(function (s) {
    var v = Math.min(s.v, prev - 1); prev = v; recomputed[s.slug] = v;
  });
  D.rows.forEach(function (r) {
    dev = Math.max(dev, Math.abs(recomputed[r.slug] - r.implied_value_usd));
  });
  window.RADAR_DEVIATION = dev;
  window.RADAR_READY = true;

  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });

  // Chain filter options, most common first.
  var chainCount = {};
  D.rows.forEach(function (r) {
    r.chains.forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; });
  });
  var chainSel = document.getElementById("chain");
  Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a]; })
    .forEach(function (c) {
      var o = document.createElement("option");
      o.value = c; o.textContent = c + " (" + chainCount[c] + ")"; chainSel.appendChild(o);
    });

  function hash() {
    var out = {};
    location.hash.slice(1).split("&").forEach(function (p) {
      var kv = p.split("="); if (kv[0]) out[kv[0]] = decodeURIComponent(kv[1] || "");
    });
    return out;
  }
  var h = hash();
  var selected = bySlug[h.detail] ? h.detail : D.rows[0].slug;
  if (h.chain) chainSel.value = h.chain;
  if (h.watchlist === "1") document.getElementById("watchOnly").checked = true;

  document.getElementById("asOf").textContent = "— snapshot " + AS_OF + " — " + D.rows.length + " rows";

  // Top-three spotlight.
  var spot = document.getElementById("spot");
  D.rows.slice(0, 3).forEach(function (r, i) {
    var d = document.createElement("div");
    d.className = "card"; d.dataset.slug = r.slug;
    d.innerHTML = "<div class=pos>#" + (i + 1) + " spotlight</div><h3>" + esc(r.name) + "</h3>" +
      "<div class=val>" + fmt(recomputed[r.slug]) + "</div>" +
      "<div class=meta>" + fmt(r.tvl_usd) + " TVL &middot; " + esc(r.chains.join(", ")) +
      " &middot; " + r.age_years.toFixed(1) + " yrs no token</div>";
    d.onclick = function () { select(r.slug); };
    spot.appendChild(d);
  });

  function filtered() {
    var q = document.getElementById("q").value.trim().toLowerCase();
    var chain = chainSel.value;
    var watch = document.getElementById("watchOnly").checked;
    var list = D.rows.filter(function (r) {
      if (watch && !r.watchlist) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (q && (r.name + " " + (r.category || "") + " " + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var sort = document.getElementById("sort").value;
    if (sort === "tvl") list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (sort === "growth") list.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (sort === "age") list.sort(function (a, b) { return b.age_years - a.age_years; });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function renderTable() {
    var list = filtered();
    document.getElementById("count").textContent = list.length + " of " + D.rows.length + " shown";
    root.innerHTML = list.map(function (r) {
      var g = r.change_7d === null ? "—" :
        "<span class=" + (r.change_7d >= 0 ? "up" : "down") + ">" +
        (r.change_7d >= 0 ? "+" : "") + r.change_7d.toFixed(1) + "%</span>";
      return "<tr class='row" + (r.slug === selected ? " sel" : "") + "' data-slug='" + esc(r.slug) + "'>" +
        "<td>" + r.rank + "</td><td><strong>" + esc(r.name) + "</strong>" +
        (r.watchlist ? "<span class=badge>Watchlist</span>" : "") + "</td>" +
        "<td>" + esc(r.category || "—") + "</td><td>" + esc(r.chains.join(", ")) + "</td>" +
        "<td class=num>" + fmt(r.tvl_usd) + "</td><td class=num>" + g + "</td>" +
        "<td class=num>" + r.age_years.toFixed(1) + "y</td>" +
        "<td class=num><strong>" + fmt(recomputed[r.slug]) + "</strong></td></tr>";
    }).join("");
    root.querySelectorAll("tr.row").forEach(function (tr) {
      tr.onclick = function () { select(tr.dataset.slug); };
    });
  }

  function renderDetail() {
    var r = bySlug[selected];
    var steps = r.farm_steps.map(function (s, i) {
      return "<li><b>Step " + (i + 1) + ".</b> " + esc(s) + "</li>";
    }).join("");
    document.getElementById("detail").innerHTML =
      "<h2>" + esc(r.name) + "</h2><div class=val>" + fmt(recomputed[r.slug]) + "</div>" +
      "<div class=facts><div><b>Rank</b>#" + r.rank + (r.watchlist ? " &middot; Watchlist" : "") + "</div>" +
      "<div><b>Category</b>" + esc(r.category || "—") + "</div>" +
      "<div><b>TVL</b>" + fmt(r.tvl_usd) + "</div>" +
      "<div><b>7-day change</b>" + (r.change_7d === null ? "—" : r.change_7d.toFixed(1) + "%") + "</div>" +
      "<div><b>Chains</b>" + esc(r.chains.join(", ")) + "</div>" +
      "<div><b>Years, no token</b>" + r.age_years.toFixed(1) + " (listed " + esc(r.listed_at || "unknown") + ")</div></div>" +
      "<h3>Farm plan — 7 steps</h3><ol>" + steps + "</ol>" +
      "<p class=note>Implied value recomputed on this page from TVL, 7-day growth, " +
      "no-token age and chain count. It is the radar's own claim, not a prediction.</p>";
  }

  function select(slug) {
    selected = slug; renderTable(); renderDetail();
    history.replaceState(null, "", "#detail=" + encodeURIComponent(slug));
  }

  ["q", "chain", "sort", "watchOnly"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", renderTable);
    document.getElementById(id).addEventListener("change", renderTable);
  });
  renderTable();
  renderDetail();
})();
